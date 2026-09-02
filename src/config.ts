import { bundledDataset, bundledSynonyms } from './data/bundled.js';
import { createHttpProvider } from './providers/http.js';
import { createLocalProvider } from './providers/local.js';
import type { DatasetProvider } from './providers/types.js';
import { createLogger, type Logger } from './util/log.js';

/**
 * Configuration and provider selection.
 *
 * Reads a plain record so the same code serves Workers (`env`) and Node
 * (`process.env`) without a runtime branch.
 */
export interface Env {
  /** Enables the HTTP provider. Absent means bundled-only (the recommended mode). */
  SQLFM_DATASET_URL?: string;
  /** Comma-separated exact origins the HTTP provider may fetch from. */
  SQLFM_ALLOWED_ORIGINS?: string;
  SQLFM_REFRESH_SECONDS?: string;
  /** Local debugging only. Logs query text; unsuitable for production. */
  SQLFM_LOG_QUERIES?: string;
}

export interface Runtime {
  provider: DatasetProvider;
  logger: Logger;
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Build the runtime for a set of environment variables.
 *
 * The HTTP provider is opt-in and allowlisted: absent `SQLFM_DATASET_URL` the
 * server never makes an outbound request at all, which is both the
 * recommended configuration and the one with no SSRF surface.
 */
export function createRuntime(env: Env = {}): Runtime {
  const logger = createLogger({ logQueries: env.SQLFM_LOG_QUERIES === 'true' });

  if (env.SQLFM_DATASET_URL) {
    const refreshSeconds = Number.parseInt(env.SQLFM_REFRESH_SECONDS ?? '', 10);
    return {
      logger,
      provider: createHttpProvider({
        url: env.SQLFM_DATASET_URL,
        allowedOrigins: parseOrigins(env.SQLFM_ALLOWED_ORIGINS),
        refreshSeconds: Number.isFinite(refreshSeconds) ? refreshSeconds : undefined,
        synonyms: bundledSynonyms,
        // Bundled floor: a cold isolate never blocks on the network and an
        // upstream outage is a no-op rather than a failure.
        fallback: bundledDataset,
        logger,
      }),
    };
  }

  return {
    logger,
    provider: createLocalProvider(bundledDataset, { kind: 'local', synonyms: bundledSynonyms }),
  };
}

/**
 * A runtime backed by an explicit dataset. Used by tests and by the stdio
 * entry's `--fixture` mode.
 */
export function createFixtureRuntime(
  raw: unknown = bundledDataset,
  logger?: Logger,
): Runtime {
  const resolvedLogger = logger ?? createLogger({ logQueries: false });
  return {
    logger: resolvedLogger,
    provider: createLocalProvider(raw, { kind: 'fixture', synonyms: bundledSynonyms }),
  };
}
