import { indexDataset } from '../domain/dataset.js';
import { buildSearchIndex } from '../search/index.js';
import type { DatasetMeta } from '../domain/types.js';
import { contentHash, validateDataset } from './validate.js';
import type { ResolvedDataset } from './types.js';

/**
 * Turn raw JSON into everything the tools need: a validated, sanitized
 * dataset, its derived indexes, and freshness metadata.
 *
 * Shared by every provider so validation, sanitization, and index
 * construction cannot diverge between them.
 */
export async function resolveDataset(
  raw: unknown,
  options: {
    kind: DatasetMeta['source_kind'];
    synonyms?: Record<string, string[]>;
    stale?: boolean;
    fetchedAt?: string;
  },
): Promise<ResolvedDataset> {
  const dataset = validateDataset(raw);
  const indexed = indexDataset(dataset);
  const searchIndex = buildSearchIndex(indexed, options.synonyms ?? {});

  const meta: DatasetMeta = {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    generated_at: dataset.generated_at,
    content_hash: await contentHash(raw),
    source_kind: options.kind,
    fetched_at: options.fetchedAt ?? new Date().toISOString(),
    stale: options.stale ?? false,
    feature_count: dataset.features.length,
    environment_count: indexed.environments.all.length,
  };

  return { dataset: indexed, searchIndex, meta };
}
