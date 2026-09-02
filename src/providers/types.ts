import type { IndexedDataset } from '../domain/dataset.js';
import type { DatasetMeta } from '../domain/types.js';
import type { SearchIndex } from '../search/index.js';

/**
 * Everything a tool needs, resolved once and shared.
 *
 * The search index is built alongside the dataset so a provider swap can
 * never leave them out of step.
 */
export interface ResolvedDataset {
  dataset: IndexedDataset;
  searchIndex: SearchIndex;
  meta: DatasetMeta;
}

/**
 * The provider interface. Deliberately tiny: everything above it is pure, so
 * swapping providers cannot change an answer, only where the bytes came from.
 * That is what makes fixture-driven acceptance tests evidence about
 * production behaviour.
 */
export interface DatasetProvider {
  readonly kind: 'fixture' | 'local' | 'http';
  /** Resolved dataset. Implementations cache; callers may call freely. */
  get(): Promise<ResolvedDataset>;
}
