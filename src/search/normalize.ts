/**
 * Text normalization, applied identically to queries and to indexed text.
 *
 * Two forms are produced on purpose. Upstream feature names are SQL
 * identifiers, so "STRING_AGG", "string-agg", "string agg" and "stringagg"
 * are all things a user or a model will type for the same feature. The
 * `spaced` form handles the first three; `collapsed` handles the fourth.
 */

export interface NormalizedText {
  /** Lowercase, punctuation folded to single spaces. */
  spaced: string;
  /** `spaced` with all whitespace removed. */
  collapsed: string;
  tokens: string[];
}

/**
 * Words dropped from long queries so natural-language phrasing ("does SQL
 * Server 2019 support X") ranks like a keyword query. Only applied at 3+
 * tokens, so short queries such as "IS" or "IN" — which are real function
 * names — survive intact.
 */
const STOP_WORDS = new Set([
  'a',
  'added',
  'an',
  'and',
  'are',
  'be',
  'can',
  'do',
  'does',
  'for',
  'introduced',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'server',
  'sql',
  'support',
  'supported',
  'supports',
  'the',
  'to',
  'version',
  'versions',
  'what',
  'when',
  'which',
  'with',
]);

const MIN_TOKENS_FOR_STOPWORD_REMOVAL = 3;

export function normalize(input: string): NormalizedText {
  const spaced = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = spaced.length > 0 ? spaced.split(' ') : [];
  const tokens =
    rawTokens.length >= MIN_TOKENS_FOR_STOPWORD_REMOVAL
      ? (rawTokens.filter((t) => !STOP_WORDS.has(t)).length > 0
          ? rawTokens.filter((t) => !STOP_WORDS.has(t))
          : rawTokens)
      : rawTokens;

  return { spaced, collapsed: spaced.replace(/ /g, ''), tokens };
}

/**
 * Suffix stripping for the token-coverage tiers.
 *
 * Deliberately minimal — the common English inflections that separate a
 * question from a description ("which version added widget aggregation" vs
 * "Aggregates widget values"). Not a full stemmer: no irregular forms, no
 * vowel rules, no dictionary. Deterministic and cheap enough to reason about.
 *
 * The suffix order matters: "aggregation" -> "aggregat" via `ion`, and
 * "aggregates" -> "aggregat" via `es`, so both land on the same stem.
 *
 * Applied ONLY to the token tiers, never to exact-name, slug, alias, or
 * prefix matching, so identifier precision is unaffected: "MIN" is still an
 * exact match for MIN and nothing else.
 */
const SUFFIXES = ['ings', 'ing', 'ions', 'ion', 'ers', 'er', 'ied', 'es', 'ed', 's'] as const;
const MIN_STEM_LENGTH = 4;
const MAX_PASSES = 4;

function stripOnce(token: string): string {
  // "queries" -> "query" rather than "quer", so it converges with "query".
  if (token.endsWith('ies') && token.length - 3 >= MIN_STEM_LENGTH) {
    return `${token.slice(0, -3)}y`;
  }
  for (const suffix of SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    // Never strip a plural 's' off "-ss" or "-us": "compress" is not
    // "compres", and the runaway would eat the word.
    if (suffix === 's' && (token.endsWith('ss') || token.endsWith('us'))) continue;
    if (token.length - suffix.length >= MIN_STEM_LENGTH) return token.slice(0, -suffix.length);
  }
  return token;
}

/**
 * Reduce a token to a stem, iterating to a fixed point.
 *
 * Iteration is what makes the function idempotent, and idempotence is what
 * makes it usable: "partitioning" -> "partition" -> "partit" must land where
 * "partition" -> "partit" lands, or a query and a description never meet.
 * The trailing-"e" trim closes the last gap ("aggregate"/"aggregates"/
 * "aggregation" all reach "aggregat").
 */
export function stemToken(token: string): string {
  if (token.length <= MIN_STEM_LENGTH) return token;

  let current = token;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = stripOnce(current);
    if (next === current) break;
    current = next;
  }

  if (current.length >= MIN_STEM_LENGTH + 1 && current.endsWith('e')) {
    current = current.slice(0, -1);
  }
  return current;
}

/** Stem every word of a normalized (spaced) string. */
export function stemText(spaced: string): string {
  if (spaced.length === 0) return '';
  return spaced.split(' ').map(stemToken).join(' ');
}

/** True when every query token appears as a substring of any haystack token. */
export function coversAllTokens(tokens: string[], haystack: string): boolean {
  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}

/** Fraction of query tokens found in the haystack, 0..1. */
export function tokenCoverage(tokens: string[], haystack: string): number {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits / tokens.length;
}
