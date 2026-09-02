import type { DatasetProvider, ResolvedDataset } from './types.js';
import { resolveDataset } from './resolve.js';

/**
 * Serves a dataset bundled into the build. The recommended provider
 * (architecture.md §6.3).
 *
 * There is no runtime I/O here at all: no timeouts, no retries, no cache
 * invalidation, no staleness logic, and — the security property that matters
 * most — no outbound request, so no SSRF surface whatsoever.
 *
 * Also backs `LocalFixtureProvider`: fixtures are just a bundled dataset that
 * happens to be synthetic, so tests exercise the same code path as production.
 */
export function createLocalProvider(
  raw: unknown,
  options: { kind?: 'local' | 'fixture'; synonyms?: Record<string, string[]> } = {},
): DatasetProvider {
  const kind = options.kind ?? 'local';
  let cached: Promise<ResolvedDataset> | null = null;

  return {
    kind,
    get() {
      // Resolved once per isolate. Failure is not cached, so a transient
      // problem at startup does not permanently poison the isolate.
      cached ??= resolveDataset(raw, { kind, synonyms: options.synonyms }).catch((error: unknown) => {
        cached = null;
        throw error;
      });
      return cached;
    },
  };
}

/** Explicit alias for tests and demos, so intent is visible at the call site. */
export function createFixtureProvider(
  raw: unknown,
  synonyms: Record<string, string[]> = {},
): DatasetProvider {
  return createLocalProvider(raw, { kind: 'fixture', synonyms });
}
