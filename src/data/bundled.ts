import syntheticDataset from '../../fixtures/synthetic/dataset.v1.json' with { type: 'json' };
import synonyms from '../../data/synonyms.json' with { type: 'json' };

/**
 * The dataset compiled into the build.
 *
 * V1 bundles SYNTHETIC FIXTURES. No SQL.FM data is present in this repository
 * and none may be added until data-use permission is explicit and in writing
 * (architecture.md §4.2).
 *
 * Adopting real data is a two-line change here — point the import at the
 * generated `data/dataset.v1.json` and set `bundledIsSynthetic` to false.
 * Nothing else in the codebase knows or cares which it is, because the
 * provider abstraction means the two follow identical code paths.
 */
export const bundledDataset: unknown = syntheticDataset;

/** Surfaced in /health so a deployment can never quietly pretend to be real. */
export const bundledIsSynthetic = true;

/**
 * Search synonyms. SERVER-OWNED CONFIGURATION, NOT SQL.FM DATA.
 *
 * Upstream carries very few aliases, which is not enough for natural-language
 * recall, so the server maintains its own mapping. Every entry is test-guarded
 * against the live dataset, so a renamed slug fails CI rather than silently
 * degrading search. A natural candidate to upstream (architecture.md Q6).
 */
export const bundledSynonyms: Record<string, string[]> = synonyms;
