/**
 * Ranking tiers. See architecture.md §9.2.
 *
 * The tier a match lands in dominates its score; the score orders results
 * within a tier. Every constant here is referenced by tests, so a change to
 * ranking is a visible diff rather than a behavioural surprise.
 */

export type MatchReason =
  | 'exact_slug'
  | 'exact_name'
  | 'alias'
  | 'prefix'
  | 'tokens'
  | 'description'
  | 'fuzzy';

export const TIER = {
  EXACT_SLUG: 1,
  EXACT_NAME: 2,
  ALIAS: 3,
  PREFIX: 4,
  TOKENS_NAME: 5,
  TOKENS_NAME_ALIAS_CATEGORY: 6,
  TOKENS_SUMMARY: 7,
  PARTIAL: 8,
  FUZZY: 9,
} as const;

export const SCORE = {
  EXACT_SLUG: 1000,
  EXACT_NAME: 950,
  ALIAS: 900,
  PREFIX: 700,
  TOKENS_NAME: 600,
  TOKENS_NAME_ALIAS_CATEGORY: 450,
  TOKENS_SUMMARY: 300,
  /** Coverage bonus added to the three token tiers: `base + COVERAGE_BONUS * coverage`. */
  COVERAGE_BONUS: 50,
  /** Partial-coverage tier: `PARTIAL_MAX * ratio`. */
  PARTIAL_MAX: 200,
  FUZZY_BASE: 150,
  FUZZY_DISTANCE_PENALTY: 20,
} as const;

/** Minimum token coverage to qualify for the partial tier at all. */
export const PARTIAL_MIN_COVERAGE = 0.5;

/**
 * Fuzzy matching is a fallback, never an augmentation. It runs only when
 * nothing reached this score — otherwise good exact matches get diluted by
 * near-miss noise, which is how search results become untrustworthy.
 */
export const FUZZY_SUPPRESSION_THRESHOLD = SCORE.TOKENS_SUMMARY;

export interface Scored {
  score: number;
  tier: number;
  coverage: number;
  nameLength: number;
  slug: string;
}

/**
 * Total order over results. Fully deterministic — no reliance on the input
 * order or on sort stability, so the same query always yields the same
 * ordering regardless of dataset iteration order.
 */
export function compareResults(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  if (a.nameLength !== b.nameLength) return a.nameLength - b.nameLength;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}
