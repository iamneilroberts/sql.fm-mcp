import { describe, expect, it, vi } from 'vitest';
import { assertAllowedUrl, createHttpProvider, HttpProviderConfigError } from '../../src/providers/http.js';
import { createLocalProvider } from '../../src/providers/local.js';
import { contentHash, DatasetValidationError, validateDataset } from '../../src/providers/validate.js';
import { silentLogger } from '../../src/util/log.js';
import { rawFixture, synonymMap } from '../helpers.js';

const ORIGIN = 'https://sql.fm';
const URL_OK = 'https://sql.fm/data/features.json';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('dataset validation', () => {
  it('accepts the fixture', () => {
    expect(() => validateDataset(rawFixture())).not.toThrow();
  });

  it('rejects a dataset with a different schema major', () => {
    const raw = rawFixture();
    raw['schema_version'] = '2.0.0';
    expect(() => validateDataset(raw)).toThrow(/Unsupported dataset schema_version/);
  });

  it('rejects a matrix row of the wrong length', () => {
    const raw = rawFixture();
    (raw['support_matrix'] as { rows: Record<string, string> }).rows['widget-agg'] = 'aaa';
    expect(() => validateDataset(raw)).toThrow(/has length 3/);
  });

  it('rejects a code that is not in the legend', () => {
    const raw = rawFixture();
    const matrix = raw['support_matrix'] as { rows: Record<string, string> };
    matrix.rows['widget-agg'] = 'X'.repeat(matrix.rows['widget-agg']!.length);
    expect(() => validateDataset(raw)).toThrow(/not in the legend/);
  });

  it('rejects a status outside the closed vocabulary', () => {
    const raw = rawFixture();
    const features = raw['features'] as { cloud_support: Record<string, { status: string }> }[];
    features[0]!.cloud_support['azure-sql-db']!.status = 'probably';
    expect(() => validateDataset(raw)).toThrow(DatasetValidationError);
  });

  it('rejects duplicate feature ids', () => {
    const raw = rawFixture();
    const features = raw['features'] as unknown[];
    features.push(structuredClone(features[0]));
    expect(() => validateDataset(raw)).toThrow(/Duplicate feature id/);
  });

  it('rejects a release_order naming an unknown release', () => {
    const raw = rawFixture();
    (raw['support_matrix'] as { release_order: string[] }).release_order[0] = 'mssql-1900';
    expect(() => validateDataset(raw)).toThrow(/unknown release/);
  });

  it('drops non-https source URLs instead of passing them through', () => {
    const raw = rawFixture();
    const features = raw['features'] as { microsoft_docs: string[] }[];
    features[0]!.microsoft_docs = ['javascript:alert(1)', 'https://learn.microsoft.com/ok'];
    const dataset = validateDataset(raw);
    expect(dataset.features[0]!.microsoft_docs).toEqual(['https://learn.microsoft.com/ok']);
  });

  it('strips invisible characters from free text while keeping the words', () => {
    const raw = rawFixture();
    const features = raw['features'] as { summary: string }[];
    features[0]!.summary = `Aggregates${String.fromCharCode(0x200b)} widget values.`;
    const dataset = validateDataset(raw);
    expect(dataset.features[0]!.summary).toBe('Aggregates widget values.');
  });

  it('computes a stable content hash', async () => {
    const a = await contentHash(rawFixture());
    const b = await contentHash(rawFixture());
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('local provider', () => {
  it('resolves once and reuses the result', async () => {
    const provider = createLocalProvider(rawFixture(), { synonyms: synonymMap });
    const first = await provider.get();
    const second = await provider.get();
    expect(first).toBe(second);
    expect(first.meta.source_kind).toBe('local');
    expect(first.meta.stale).toBe(false);
    expect(first.meta.feature_count).toBe(12);
  });

  it('does not cache a failure permanently', async () => {
    const provider = createLocalProvider({ nonsense: true });
    await expect(provider.get()).rejects.toThrow();
    await expect(provider.get()).rejects.toThrow();
  });
});

describe('http provider configuration', () => {
  it('refuses a non-https URL', () => {
    expect(() => assertAllowedUrl('http://sql.fm/data.json', [ORIGIN])).toThrow(HttpProviderConfigError);
  });

  it('refuses when the allowlist is empty', () => {
    expect(() => assertAllowedUrl(URL_OK, [])).toThrow(/No dataset origins are allowlisted/);
  });

  it('refuses an origin that is not allowlisted', () => {
    expect(() => assertAllowedUrl('https://evil.example/data.json', [ORIGIN])).toThrow(
      /not allowlisted/,
    );
  });

  it('accepts an allowlisted https URL', () => {
    expect(assertAllowedUrl(URL_OK, [ORIGIN]).origin).toBe(ORIGIN);
  });
});

describe('http provider behaviour', () => {
  it('fetches, validates, and serves', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(rawFixture(), { headers: { etag: 'W/"v1"' } }));
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silentLogger,
    });
    const resolved = await provider.get();
    expect(resolved.meta.source_kind).toBe('http');
    expect(resolved.meta.stale).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends a conditional request and honours 304 without re-parsing', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (headers['if-none-match'] === 'W/"v1"') return new Response(null, { status: 304 });
      return jsonResponse(rawFixture(), { headers: { etag: 'W/"v1"' } });
    });
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      refreshSeconds: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      logger: silentLogger,
    });

    const first = await provider.get();
    now = 10_000;
    await provider.get();
    // The background refresh is fire-and-forget; let it settle.
    await new Promise((r) => setTimeout(r, 20));
    const third = await provider.get();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const conditionalCall = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(conditionalCall[1].headers).toMatchObject({ 'if-none-match': 'W/"v1"' });
    // Same resolved object: a 304 extends the TTL without rebuilding indexes.
    expect(third.dataset).toBe(first.dataset);
  });

  it('serves last-known-good and flags stale when a refresh fails', async () => {
    let now = 0;
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse(rawFixture());
      throw new Error('upstream down');
    });
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      refreshSeconds: 1,
      retries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      logger: silentLogger,
    });

    await provider.get();
    now = 10_000;
    await provider.get();
    await new Promise((r) => setTimeout(r, 20));

    const after = await provider.get();
    // Still serving data — a refresh failure must never error a tool call.
    expect(after.dataset.raw.features.length).toBe(12);
    expect(after.meta.stale).toBe(true);
  });

  it('falls back to the bundled dataset when the very first fetch fails', async () => {
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      retries: 0,
      fetchImpl: (async () => {
        throw new Error('cold start, upstream down');
      }) as unknown as typeof fetch,
      fallback: rawFixture(),
      logger: silentLogger,
    });
    const resolved = await provider.get();
    expect(resolved.meta.stale).toBe(true);
    expect(resolved.dataset.raw.features.length).toBe(12);
  });

  it('rejects an oversized response', async () => {
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      retries: 0,
      maxBytes: 10,
      fetchImpl: (async () => jsonResponse(rawFixture())) as unknown as typeof fetch,
      logger: silentLogger,
    });
    await expect(provider.get()).rejects.toThrow(/size cap/);
  });

  it('rejects malformed upstream JSON', async () => {
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      retries: 0,
      fetchImpl: (async () => new Response('{ not json', { status: 200 })) as unknown as typeof fetch,
      logger: silentLogger,
    });
    await expect(provider.get()).rejects.toThrow();
  });

  it('keeps the previous dataset when a refresh returns the wrong schema major', async () => {
    let now = 0;
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse(rawFixture());
      const bad = rawFixture();
      bad['schema_version'] = '2.0.0';
      return jsonResponse(bad);
    });
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      refreshSeconds: 1,
      retries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      logger: silentLogger,
    });

    const first = await provider.get();
    now = 10_000;
    await provider.get();
    await new Promise((r) => setTimeout(r, 20));
    const after = await provider.get();

    expect(after.dataset).toBe(first.dataset);
    expect(after.meta.stale).toBe(true);
  });

  it('collapses concurrent refreshes into a single upstream request', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(rawFixture())), 10)),
    );
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silentLogger,
    });
    await Promise.all([provider.get(), provider.get(), provider.get()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(rawFixture()));
    const provider = createHttpProvider({
      url: URL_OK,
      allowedOrigins: [ORIGIN],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silentLogger,
    });
    await provider.get();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
});
