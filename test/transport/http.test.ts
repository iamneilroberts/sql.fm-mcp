import { describe, expect, it } from 'vitest';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createFetchHandler, HEALTH_ROUTE, MCP_ROUTE } from '../../src/handler.js';

/**
 * The revision this server targets. NOT `LATEST_PROTOCOL_VERSION` from the
 * SDK — that constant names the newest *2025-era* revision, and the modern
 * stateless revision is handled on its own track.
 */
const PROTOCOL_VERSION = '2026-07-28';

/**
 * Exercises the web-standard fetch handler directly — the same function the
 * Worker and the Pages Function delegate to, so routing, CORS, health, and
 * MCP-over-HTTP are covered for every hosted shape at once.
 */

const handler = createFetchHandler({ env: {} });
const BASE = 'https://sqlfm-mcp.test';

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handler(
    new Request(`${BASE}${MCP_ROUTE}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function rpc(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      // Every 2026-07-28 request carries its own protocol version and client
      // capabilities: there is no initialize handshake to negotiate them.
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [CLIENT_INFO_META_KEY]: { name: 'transport-test', version: '0.0.0' },
      },
    },
  };
}

/** Reads a JSON-RPC result from either a JSON body or an SSE upgrade. */
async function readResult(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const line = text
      .split('\n')
      .find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`no data frame in SSE response: ${text}`);
    return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('routing', () => {
  it('serves health without auth and without exposing internals', async () => {
    const response = await handler(new Request(`${BASE}${HEALTH_ROUTE}`));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      dataset: Record<string, unknown>;
      server: { name: string; version: string };
    };
    expect(body.status).toBe('ok');
    expect(body.dataset['schema_version']).toBe('1.0.0');
    expect(body.dataset['content_hash']).toMatch(/^sha256:/);
    expect(body.dataset['stale']).toBe(false);
    // The build ships synthetic data and must say so.
    expect(body.dataset['synthetic']).toBe(true);
    expect(body.server.name).toBe('sqlfm-mcp');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/SQLFM_|\/home\/|node_modules|http:\/\//);
  });

  it('answers CORS preflight', async () => {
    const response = await handler(new Request(`${BASE}${MCP_ROUTE}`, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('mcp-method');
  });

  it('404s an unknown path with a pointer to the real endpoints', async () => {
    const response = await handler(new Request(`${BASE}/nope`));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain(MCP_ROUTE);
  });

  it('sets CORS headers on MCP responses too', async () => {
    const response = await post(rpc('tools/list'), { 'mcp-method': 'tools/list' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('streamable HTTP', () => {
  it('serves tools/list with the required headers', async () => {
    const response = await post(rpc('tools/list'), { 'mcp-method': 'tools/list' });
    expect(response.status).toBe(200);

    const body = await readResult(response);
    const result = body['result'] as { tools: { name: string }[] };
    expect(result.tools.map((t) => t.name)).toEqual(['search', 'fetch', 'compare_feature_support']);
  });

  it('attaches cache hints to list results, per the 2026-07-28 CacheableResult contract', async () => {
    const response = await post(rpc('tools/list'), { 'mcp-method': 'tools/list' });
    const body = await readResult(response);
    const result = body['result'] as { ttlMs?: number; cacheScope?: string };
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe('public');
  });

  it('implements server/discover and advertises the modern revision', async () => {
    const response = await post(rpc('server/discover'), { 'mcp-method': 'server/discover' });
    const body = await readResult(response);
    const result = body['result'] as {
      supportedVersions: string[];
      capabilities: Record<string, unknown>;
      instructions: string;
    };
    expect(result.supportedVersions).toContain(PROTOCOL_VERSION);
    expect(result.capabilities).toHaveProperty('tools');
    expect(result.capabilities).toHaveProperty('resources');
    // The instructions are where the non-collapse rules reach the model.
    expect(result.instructions).toContain('does NOT mean unsupported');
    expect(result.instructions).toContain('not affiliated');
  });

  it('rejects a request whose Mcp-Method header disagrees with the body', async () => {
    const response = await post(rpc('tools/list'), { 'mcp-method': 'resources/list' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number; message: string } };
    // -32020 HeaderMismatch, per the 2026-07-28 error-code allocation.
    expect(body.error.code).toBe(-32020);
    expect(body.error.message).toContain('headers and body disagree');
  });

  it('calls a tool over HTTP and returns both content shapes', async () => {
    const response = await post(
      rpc('tools/call', { name: 'search', arguments: { query: 'widget-agg' } }),
      { 'mcp-method': 'tools/call', 'mcp-name': 'search' },
    );
    const body = await readResult(response);
    const result = body['result'] as {
      structuredContent: { results: { id: string }[] };
      content: { type: string; text: string }[];
    };
    expect(result.structuredContent.results[0]?.id).toBe('widget-agg');
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it('reads a resource over HTTP', async () => {
    const response = await post(
      rpc('resources/read', { uri: 'sqlfm://environments' }),
      { 'mcp-method': 'resources/read', 'mcp-name': 'sqlfm://environments' },
    );
    const body = await readResult(response);
    const result = body['result'] as { contents: { text: string }[] };
    const parsed = JSON.parse(result.contents[0]!.text) as { count: number };
    expect(parsed.count).toBe(42);
  });

  it('returns a tool error as a result, not a transport failure', async () => {
    const response = await post(
      rpc('tools/call', { name: 'fetch', arguments: { id: 'no-such-feature' } }),
      { 'mcp-method': 'tools/call', 'mcp-name': 'fetch' },
    );
    expect(response.status).toBe(200);
    const body = await readResult(response);
    const result = body['result'] as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      error: { code: 'feature_not_found' },
    });
  });

  it('rejects a malformed body without leaking internals', async () => {
    const response = await handler(
      new Request(`${BASE}${MCP_ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-method': 'tools/list' },
        body: '{ not json',
      }),
    );
    const text = await response.text();
    expect(text).not.toMatch(/\/home\/|node_modules|at Object\./);
  });
});
