import type { Logger } from '../util/log.js';
import { resolveDataset } from './resolve.js';
import type { DatasetProvider, ResolvedDataset } from './types.js';

/**
 * Fetches a dataset from a single owner-approved URL.
 *
 * OPT-IN ONLY. Disabled unless a URL is configured, and the configured URL
 * must be on the origin allowlist. No user input contributes to the URL, no
 * redirects are followed, and no tool exposes a URL parameter — so there is
 * no user-reachable fetch at all (architecture.md §12.2).
 *
 * Availability rule: the dataset never becomes LESS available than it was a
 * moment ago. A failed refresh serves last-known-good with `stale: true`; it
 * never errors a tool call and never returns empty.
 */

export interface HttpProviderOptions {
  url: string;
  /** Exact origins permitted. Empty means "nothing is permitted". */
  allowedOrigins: string[];
  refreshSeconds?: number;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  synonyms?: Record<string, string[]>;
  /** Bundled dataset used when the very first fetch fails. */
  fallback?: unknown;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULTS = {
  refreshSeconds: 900,
  timeoutMs: 5_000,
  maxBytes: 2_000_000,
  retries: 2,
};

export class HttpProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpProviderConfigError';
  }
}

/** Validated at construction, so a misconfiguration fails loudly at startup. */
export function assertAllowedUrl(url: string, allowedOrigins: string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpProviderConfigError(`Dataset URL is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpProviderConfigError('Dataset URL must use https.');
  }
  if (allowedOrigins.length === 0) {
    throw new HttpProviderConfigError(
      'No dataset origins are allowlisted. Set SQLFM_ALLOWED_ORIGINS before enabling the HTTP provider.',
    );
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new HttpProviderConfigError(`Dataset URL origin is not allowlisted.`);
  }
  return parsed;
}

interface CacheEntry {
  resolved: ResolvedDataset;
  etag: string | null;
  lastModified: string | null;
  refreshedAtMs: number;
}

export function createHttpProvider(options: HttpProviderOptions): DatasetProvider {
  const url = assertAllowedUrl(options.url, options.allowedOrigins);
  const refreshMs = (options.refreshSeconds ?? DEFAULTS.refreshSeconds) * 1000;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const retries = options.retries ?? DEFAULTS.retries;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const log = options.logger;

  let cache: CacheEntry | null = null;
  let inFlight: Promise<void> | null = null;
  let lastFailureLoggedMs = 0;

  async function fetchOnce(): Promise<{ raw: unknown; etag: string | null; lastModified: string | null } | 'not-modified'> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (cache?.etag) headers['if-none-match'] = cache.etag;
    if (cache?.lastModified) headers['if-modified-since'] = cache.lastModified;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 304) return 'not-modified';
      if (!response.ok) throw new Error(`Upstream responded ${response.status}`);

      const declared = response.headers.get('content-length');
      if (declared !== null && Number(declared) > maxBytes) {
        throw new Error('Upstream response exceeds the size cap');
      }

      const text = await response.text();
      if (text.length > maxBytes) throw new Error('Upstream response exceeds the size cap');

      return {
        raw: JSON.parse(text) as unknown,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await fetchOnce();
        if (result === 'not-modified') {
          // Content unchanged: extend the TTL without re-parsing or
          // re-indexing, and clear any staleness flag.
          if (cache) {
            cache.refreshedAtMs = now();
            cache.resolved = { ...cache.resolved, meta: { ...cache.resolved.meta, stale: false } };
          }
          return;
        }
        const resolved = await resolveDataset(result.raw, {
          kind: 'http',
          synonyms: options.synonyms,
          stale: false,
        });
        cache = {
          resolved,
          etag: result.etag,
          lastModified: result.lastModified,
          refreshedAtMs: now(),
        };
        return;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          const backoff = 100 * 2 ** attempt + Math.floor(Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    // Every attempt failed. Keep serving what we have, flagged stale.
    if (cache) {
      cache.refreshedAtMs = now();
      cache.resolved = { ...cache.resolved, meta: { ...cache.resolved.meta, stale: true } };
      if (now() - lastFailureLoggedMs > refreshMs) {
        lastFailureLoggedMs = now();
        log?.warn('dataset refresh failed; serving last-known-good', {
          error: lastError instanceof Error ? lastError.message : 'unknown',
        });
      }
      return;
    }
    throw lastError instanceof Error ? lastError : new Error('Dataset fetch failed');
  }

  /** Single-flight: concurrent refreshes collapse into one upstream request. */
  function refreshOnce(): Promise<void> {
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    kind: 'http',
    async get(): Promise<ResolvedDataset> {
      if (cache === null) {
        try {
          await refreshOnce();
        } catch (error) {
          if (options.fallback === undefined) throw error;
          // Cold start with upstream down: fall back to the bundled dataset
          // rather than blocking or failing, and mark it stale so /health says so.
          log?.warn('initial dataset fetch failed; using bundled fallback');
          cache = {
            resolved: await resolveDataset(options.fallback, {
              kind: 'http',
              synonyms: options.synonyms,
              stale: true,
            }),
            etag: null,
            lastModified: null,
            refreshedAtMs: now(),
          };
        }
      }

      const entry = cache;
      /* c8 ignore next */
      if (!entry) throw new Error('Dataset unavailable');

      if (now() - entry.refreshedAtMs > refreshMs) {
        // Refresh behind the response, never on the request path.
        void refreshOnce().catch(() => {});
      }
      return entry.resolved;
    },
  };
}
