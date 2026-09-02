import type { Dataset, EditionSlug, SupportMatrix, SupportStatus } from './types.js';

/**
 * Decoding for the compact on-premises matrix.
 *
 * A row is `release_order.length * edition_order.length` characters. Cell
 * `(r, e)` lives at `r * edition_order.length + e`. Anything we cannot decode —
 * a missing row, a short row, an unrecognized code — resolves to `unknown`,
 * never to `unavailable`. Absence of data is not a negative.
 */

export interface DecodedMatrix {
  releaseOrder: string[];
  editionOrder: EditionSlug[];
  releaseIndex: Map<string, number>;
  editionIndex: Map<EditionSlug, number>;
}

export function indexMatrix(matrix: SupportMatrix): DecodedMatrix {
  return {
    releaseOrder: matrix.release_order,
    editionOrder: matrix.edition_order,
    releaseIndex: new Map(matrix.release_order.map((id, i) => [id, i])),
    editionIndex: new Map(matrix.edition_order.map((id, i) => [id, i])),
  };
}

/** Look up one cell. Returns `unknown` for any gap in the data. */
export function statusAt(
  matrix: SupportMatrix,
  index: DecodedMatrix,
  featureId: string,
  releaseId: string,
  edition: EditionSlug,
): SupportStatus {
  const row = matrix.rows[featureId];
  if (row === undefined) return 'unknown';

  const r = index.releaseIndex.get(releaseId);
  const e = index.editionIndex.get(edition);
  if (r === undefined || e === undefined) return 'unknown';

  const code = row[r * index.editionOrder.length + e];
  if (code === undefined) return 'unknown';

  return matrix.legend[code] ?? 'unknown';
}

export interface EditionCell {
  edition: EditionSlug;
  status: SupportStatus;
}

/** All edition statuses for one feature in one release, in matrix order. */
export function editionStatuses(
  matrix: SupportMatrix,
  index: DecodedMatrix,
  featureId: string,
  releaseId: string,
): EditionCell[] {
  return index.editionOrder.map((edition) => ({
    edition,
    status: statusAt(matrix, index, featureId, releaseId, edition),
  }));
}

/**
 * Validate a matrix row's length against the declared order arrays.
 * Used by dataset validation so a malformed row is rejected at load time
 * rather than silently decoding to `unknown` on every read.
 */
export function expectedRowLength(matrix: SupportMatrix): number {
  return matrix.release_order.length * matrix.edition_order.length;
}

export interface StatusRun<T> {
  /** Items sharing an identical status signature, in order. */
  items: T[];
  first: T;
  last: T;
  signature: string;
}

/**
 * Collapse consecutive items with an identical status signature into runs.
 *
 * Used both by `compare_feature_support`'s `include_unchanged: false` and by
 * `text` composition, where enumerating 19 releases x 4 editions as prose
 * would bury the reader in noise. Runs are only collapsed when the signature
 * matches exactly — any edition divergence starts a new run, because that is
 * precisely the case the reader must not miss.
 */
export function groupRuns<T>(items: T[], signature: (item: T) => string): StatusRun<T>[] {
  const runs: StatusRun<T>[] = [];
  for (const item of items) {
    const sig = signature(item);
    const current = runs[runs.length - 1];
    if (current && current.signature === sig) {
      current.items.push(item);
      current.last = item;
    } else {
      runs.push({ items: [item], first: item, last: item, signature: sig });
    }
  }
  return runs;
}

/** Releases in matrix order, filtered to those the dataset declares. */
export function orderedReleases(dataset: Dataset): Dataset['releases'] {
  const bySort = [...dataset.releases].sort((a, b) => a.sort - b.sort);
  const declared = new Set(dataset.support_matrix.release_order);
  return bySort.filter((r) => declared.has(r.id));
}
