/**
 * Fuzzy matching for misspelled feature names.
 *
 * Damerau-Levenshtein rather than plain Levenshtein because transposition is
 * the dominant typo in identifiers ("STIRNG_AGG" for "STRING_AGG"), and plain
 * edit distance charges that two operations instead of one.
 *
 * A trigram Jaccard pre-filter keeps the quadratic edit-distance pass off the
 * bulk of the corpus.
 */

export function trigrams(input: string): Set<string> {
  const padded = `  ${input} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Optimal string alignment distance, capped for early exit. */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1); // transposition
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = current;
    current = new Array<number>(b.length + 1);
  }

  return prev[b.length]!;
}

/**
 * Edit-distance budget for a target of the given length.
 * Short identifiers get a tight budget so "MIN" does not fuzzy-match "MAX".
 */
export function fuzzyThreshold(targetLength: number): number {
  if (targetLength <= 4) return 1;
  if (targetLength <= 8) return 2;
  return 3;
}

/** Minimum trigram similarity to be worth an edit-distance comparison. */
export const TRIGRAM_PREFILTER = 0.3;
