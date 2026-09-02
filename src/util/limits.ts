/**
 * Bounded work per request. See architecture.md §12.3 / §12.4.
 *
 * Every user-controllable dimension is capped here, in one place, so the
 * bounds are auditable rather than scattered through the tools.
 */

export const LIMITS = {
  /** `search.query` length, in characters. */
  QUERY_MAX_LENGTH: 200,
  /** `search.limit` bounds. */
  RESULT_LIMIT_MIN: 1,
  RESULT_LIMIT_MAX: 50,
  RESULT_LIMIT_DEFAULT: 10,
  /** `compare_feature_support.environments` cardinality. */
  ENVIRONMENTS_MAX: 32,
  /** A single environment identifier. */
  ENVIRONMENT_MAX_LENGTH: 60,
  /** `search.category`. */
  CATEGORY_MAX_LENGTH: 80,
  /** Feature id / slug. */
  ID_MAX_LENGTH: 64,
  /** Suggestions returned alongside an empty result or unknown id. */
  SUGGESTION_COUNT: 5,
} as const;

/**
 * Feature id grammar. This is the path-traversal control (T2): ids are
 * validated against this before any lookup, and are only ever used as map
 * keys — never to construct a path or a URL from user input.
 */
export const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidFeatureId(id: string): boolean {
  return FEATURE_ID_PATTERN.test(id);
}
