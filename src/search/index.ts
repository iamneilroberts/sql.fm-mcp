import type { IndexedDataset } from '../domain/dataset.js';
import type { Feature } from '../domain/types.js';
import { damerauLevenshtein, fuzzyThreshold, jaccard, TRIGRAM_PREFILTER, trigrams } from './fuzzy.js';
import { normalize, stemText, tokenCoverage, type NormalizedText } from './normalize.js';
import {
  compareResults,
  FUZZY_SUPPRESSION_THRESHOLD,
  PARTIAL_MIN_COVERAGE,
  SCORE,
  TIER,
  type MatchReason,
} from './rank.js';

interface IndexedFeature {
  feature: Feature;
  name: NormalizedText;
  slug: string;
  /** Exact-match keys from upstream aliases and the server's synonym file. */
  aliasKeys: Set<string>;
  /** Name (both forms) only. */
  haystackName: string;
  /** Name + aliases + category. */
  haystackNameAliasCategory: string;
  /** Summary + type. */
  haystackSummary: string;
  /**
   * Stemmed variants, used only by the token-coverage tiers so that
   * "aggregation" in a question matches "Aggregates" in a description.
   */
  stemmedName: string;
  stemmedNameAliasCategory: string;
  stemmedEverything: string;
  nameTrigrams: Set<string>;
  slugTrigrams: Set<string>;
}

export interface SearchIndex {
  features: IndexedFeature[];
  byId: Map<string, IndexedFeature>;
  /** Normalized synonym phrase -> feature ids. Server-owned, not SQL.FM data. */
  synonyms: Map<string, string[]>;
}

export interface SearchHit {
  feature: Feature;
  score: number;
  tier: number;
  coverage: number;
  reason: MatchReason;
}

export interface QueryInterpretation {
  normalizedQuery: string;
  tokens: string[];
  synonymsApplied: string[];
}

export interface SearchOutcome {
  hits: SearchHit[];
  interpretation: QueryInterpretation;
}

/**
 * Build the search index. Called once per isolate, lazily, on first search.
 * For a few hundred features this is single-digit milliseconds and is
 * amortized across every request the isolate serves.
 */
export function buildSearchIndex(
  indexed: IndexedDataset,
  synonymSource: Record<string, string[]> = {},
): SearchIndex {
  const features: IndexedFeature[] = indexed.raw.features.map((feature) => {
    const name = normalize(feature.name);
    const aliasKeys = new Set<string>();
    for (const alias of feature.aliases) {
      const n = normalize(alias);
      if (n.spaced) aliasKeys.add(n.spaced);
      if (n.collapsed) aliasKeys.add(n.collapsed);
    }

    const aliasText = feature.aliases.map((a) => normalize(a).spaced).join(' ');
    const categoryText = [feature.category.name, feature.category.parent_name ?? '']
      .map((t) => normalize(t).spaced)
      .join(' ');
    const summaryText = normalize(feature.summary).spaced;
    const typeText = normalize(feature.type).spaced;
    const slugText = normalize(feature.slug).spaced;

    const haystackName = `${name.spaced} ${name.collapsed} ${slugText}`;

    const haystackNameAliasCategory = `${haystackName} ${aliasText} ${categoryText}`;
    const haystackSummary = `${summaryText} ${typeText}`;

    return {
      feature,
      name,
      slug: feature.slug,
      aliasKeys,
      haystackName,
      haystackNameAliasCategory,
      haystackSummary,
      stemmedName: stemText(haystackName),
      stemmedNameAliasCategory: stemText(haystackNameAliasCategory),
      stemmedEverything: stemText(`${haystackNameAliasCategory} ${haystackSummary}`),
      nameTrigrams: trigrams(name.collapsed),
      slugTrigrams: trigrams(normalize(feature.slug).collapsed),
    };
  });

  const synonyms = new Map<string, string[]>();
  for (const [phrase, ids] of Object.entries(synonymSource)) {
    const n = normalize(phrase);
    if (n.spaced) synonyms.set(n.spaced, ids);
    if (n.collapsed && n.collapsed !== n.spaced) synonyms.set(n.collapsed, ids);
  }

  return {
    features,
    byId: new Map(features.map((f) => [f.feature.id, f])),
    synonyms,
  };
}

interface Candidate {
  entry: IndexedFeature;
  score: number;
  tier: number;
  coverage: number;
  reason: MatchReason;
}

function best(a: Candidate | undefined, b: Candidate): Candidate {
  if (!a) return b;
  return compareResults(
    { ...a, nameLength: a.entry.feature.name.length, slug: a.entry.slug },
    { ...b, nameLength: b.entry.feature.name.length, slug: b.entry.slug },
  ) <= 0
    ? a
    : b;
}

/**
 * Score every feature against a query and return hits in ranked order.
 *
 * This selects WHICH features to return. It never influences WHAT a feature's
 * support status is — status is read from the dataset verbatim, downstream of
 * this function, and no score reaches it.
 */
export function search(index: SearchIndex, rawQuery: string): SearchOutcome {
  const query = normalize(rawQuery);
  const interpretation: QueryInterpretation = {
    normalizedQuery: query.spaced,
    tokens: query.tokens,
    synonymsApplied: [],
  };

  if (query.spaced.length === 0) {
    return { hits: [], interpretation };
  }

  const synonymIds = new Set<string>();
  for (const key of [query.spaced, query.collapsed]) {
    const ids = index.synonyms.get(key);
    if (ids) {
      interpretation.synonymsApplied.push(key);
      for (const id of ids) synonymIds.add(id);
    }
  }

  const stemmedTokens = query.tokens.map((token) => stemText(token));

  const candidates = new Map<string, Candidate>();
  const record = (entry: IndexedFeature, candidate: Omit<Candidate, 'entry'>): void => {
    const merged = best(candidates.get(entry.feature.id), { entry, ...candidate });
    candidates.set(entry.feature.id, merged);
  };

  for (const entry of index.features) {
    // Tier 1-3: exact identity matches.
    if (query.spaced === normalize(entry.slug).spaced || query.collapsed === normalize(entry.slug).collapsed) {
      record(entry, { score: SCORE.EXACT_SLUG, tier: TIER.EXACT_SLUG, coverage: 1, reason: 'exact_slug' });
      continue;
    }
    if (query.spaced === entry.name.spaced || query.collapsed === entry.name.collapsed) {
      record(entry, { score: SCORE.EXACT_NAME, tier: TIER.EXACT_NAME, coverage: 1, reason: 'exact_name' });
      continue;
    }
    if (entry.aliasKeys.has(query.spaced) || entry.aliasKeys.has(query.collapsed) || synonymIds.has(entry.feature.id)) {
      record(entry, { score: SCORE.ALIAS, tier: TIER.ALIAS, coverage: 1, reason: 'alias' });
      continue;
    }

    // Tier 4: prefix.
    if (entry.name.spaced.startsWith(query.spaced) || entry.name.collapsed.startsWith(query.collapsed)) {
      record(entry, { score: SCORE.PREFIX, tier: TIER.PREFIX, coverage: 1, reason: 'prefix' });
      continue;
    }

    // Tiers 5-7: full token coverage over progressively weaker fields.
    const nameCoverage = tokenCoverage(stemmedTokens, entry.stemmedName);
    if (nameCoverage === 1) {
      record(entry, {
        score: SCORE.TOKENS_NAME + SCORE.COVERAGE_BONUS * nameCoverage,
        tier: TIER.TOKENS_NAME,
        coverage: nameCoverage,
        reason: 'tokens',
      });
      continue;
    }

    const wideCoverage = tokenCoverage(stemmedTokens, entry.stemmedNameAliasCategory);
    if (wideCoverage === 1) {
      record(entry, {
        score: SCORE.TOKENS_NAME_ALIAS_CATEGORY + SCORE.COVERAGE_BONUS * wideCoverage,
        tier: TIER.TOKENS_NAME_ALIAS_CATEGORY,
        coverage: wideCoverage,
        reason: 'tokens',
      });
      continue;
    }

    const summaryCoverage = tokenCoverage(stemmedTokens, entry.stemmedEverything);
    if (summaryCoverage === 1) {
      record(entry, {
        score: SCORE.TOKENS_SUMMARY + SCORE.COVERAGE_BONUS * summaryCoverage,
        tier: TIER.TOKENS_SUMMARY,
        coverage: summaryCoverage,
        reason: 'description',
      });
      continue;
    }

    // Tier 8: partial coverage.
    if (summaryCoverage >= PARTIAL_MIN_COVERAGE) {
      record(entry, {
        score: SCORE.PARTIAL_MAX * summaryCoverage,
        tier: TIER.PARTIAL,
        coverage: summaryCoverage,
        reason: 'tokens',
      });
    }
  }

  const strongest = [...candidates.values()].reduce((max, c) => Math.max(max, c.score), 0);

  // Tier 9: fuzzy, only as a fallback for an otherwise poor result set.
  if (strongest < FUZZY_SUPPRESSION_THRESHOLD) {
    const queryTrigrams = trigrams(query.collapsed);
    for (const entry of index.features) {
      const similarity = Math.max(
        jaccard(queryTrigrams, entry.nameTrigrams),
        jaccard(queryTrigrams, entry.slugTrigrams),
      );
      if (similarity < TRIGRAM_PREFILTER) continue;

      const threshold = fuzzyThreshold(entry.name.collapsed.length);
      const distance = Math.min(
        damerauLevenshtein(query.collapsed, entry.name.collapsed, threshold),
        damerauLevenshtein(query.collapsed, normalize(entry.slug).collapsed, threshold),
      );
      if (distance > threshold) continue;

      record(entry, {
        score: SCORE.FUZZY_BASE - SCORE.FUZZY_DISTANCE_PENALTY * distance,
        tier: TIER.FUZZY,
        coverage: 0,
        reason: 'fuzzy',
      });
    }
  }

  const hits: SearchHit[] = [...candidates.values()]
    .sort((a, b) =>
      compareResults(
        { ...a, nameLength: a.entry.feature.name.length, slug: a.entry.slug },
        { ...b, nameLength: b.entry.feature.name.length, slug: b.entry.slug },
      ),
    )
    .map((c) => ({
      feature: c.entry.feature,
      score: Math.round(c.score),
      tier: c.tier,
      coverage: c.coverage,
      reason: c.reason,
    }));

  return { hits, interpretation };
}

/**
 * Nearest feature ids by edit distance. Used to make empty searches and
 * unknown ids self-correcting rather than dead ends.
 */
export function suggest(index: SearchIndex, rawQuery: string, limit = 5): string[] {
  const query = normalize(rawQuery);
  if (query.collapsed.length === 0) return [];

  const queryTrigrams = trigrams(query.collapsed);
  return index.features
    .map((entry) => ({
      id: entry.feature.id,
      distance: Math.min(
        damerauLevenshtein(query.collapsed, entry.name.collapsed),
        damerauLevenshtein(query.collapsed, normalize(entry.slug).collapsed),
      ),
      similarity: Math.max(
        jaccard(queryTrigrams, entry.nameTrigrams),
        jaccard(queryTrigrams, entry.slugTrigrams),
      ),
    }))
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((c) => c.id);
}
