import { describe, expect, it } from 'vitest';
import { damerauLevenshtein, fuzzyThreshold, jaccard, trigrams } from '../../src/search/fuzzy.js';
import { search, suggest } from '../../src/search/index.js';
import {
  coversAllTokens,
  normalize,
  stemText,
  stemToken,
  tokenCoverage,
} from '../../src/search/normalize.js';
import { compareResults, SCORE } from '../../src/search/rank.js';
import { loadFixture, synonymMap } from '../helpers.js';

const { searchIndex } = loadFixture();

const ids = (query: string): string[] => search(searchIndex, query).hits.map((h) => h.feature.id);
const top = (query: string) => search(searchIndex, query).hits[0];

describe('normalization', () => {
  it('folds identifier punctuation to spaces', () => {
    expect(normalize('WIDGET_AGG').spaced).toBe('widget agg');
    expect(normalize('widget-agg').spaced).toBe('widget agg');
    expect(normalize('Widget Agg').spaced).toBe('widget agg');
  });

  it('produces a collapsed form so "widgetagg" matches too', () => {
    expect(normalize('WIDGET_AGG').collapsed).toBe('widgetagg');
    expect(normalize('widgetagg').collapsed).toBe('widgetagg');
  });

  it('strips diacritics', () => {
    expect(normalize('café').spaced).toBe('cafe');
  });

  it('drops stop words only once a query is long enough', () => {
    expect(normalize('is').tokens).toEqual(['is']);
    expect(normalize('does sql server support widget agg').tokens).toEqual(['widget', 'agg']);
  });

  it('keeps the raw tokens when stop-word removal would empty the query', () => {
    expect(normalize('what is sql').tokens.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(normalize('').tokens).toEqual([]);
    expect(normalize('   !!! ').tokens).toEqual([]);
  });

  it('converges inflected forms onto one stem', () => {
    // Each group must collapse to a single stem, or a question never meets a
    // description. The exact stem string does not matter; agreement does.
    const groups = [
      ['aggregate', 'aggregates', 'aggregation', 'aggregations'],
      ['index', 'indexes', 'indexing'],
      ['partition', 'partitions', 'partitioning'],
      ['compress', 'compresses', 'compression'],
      ['value', 'values'],
      ['query', 'queries'],
      ['function', 'functions'],
      ['restore', 'restores', 'restoring'],
    ];
    for (const group of groups) {
      const stems = new Set(group.map(stemToken));
      expect(stems, `expected one stem for ${group.join('/')}, got ${[...stems].join('/')}`).toHaveLength(1);
    }
  });

  it('is idempotent — stemming a stem changes nothing', () => {
    const words = [
      'aggregation',
      'partitioning',
      'compression',
      'indexes',
      'queries',
      'restoring',
      'values',
      'functions',
      'business',
      'status',
    ];
    for (const word of words) {
      const once = stemToken(word);
      expect(stemToken(once), `stemToken is not idempotent for '${word}'`).toBe(once);
    }
  });

  it('never strips a plural s off -ss or -us', () => {
    expect(stemToken('compress')).toBe('compress');
    expect(stemToken('business')).toBe('business');
    expect(stemToken('status')).toBe('status');
  });

  it('leaves short identifiers alone so precision is not lost', () => {
    expect(stemToken('agg')).toBe('agg');
    expect(stemToken('min')).toBe('min');
    expect(stemToken('sums')).toBe('sums');
  });

  it('stems every word of a phrase', () => {
    expect(stemText('aggregation functions')).toBe(
      `${stemToken('aggregation')} ${stemToken('functions')}`,
    );
    expect(stemText('')).toBe('');
  });

  it('measures token coverage', () => {
    expect(coversAllTokens(['a', 'b'], 'a b c')).toBe(true);
    expect(coversAllTokens(['a', 'z'], 'a b c')).toBe(false);
    expect(tokenCoverage(['a', 'z'], 'a b c')).toBe(0.5);
    expect(tokenCoverage([], 'anything')).toBe(0);
  });
});

describe('fuzzy primitives', () => {
  it('charges a transposition one edit, not two', () => {
    expect(damerauLevenshtein('widgetagg', 'wigdetagg')).toBe(1);
  });

  it('handles identical, empty, and far-apart inputs', () => {
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
  });

  it('exits early past the cap', () => {
    expect(damerauLevenshtein('abcdefghij', 'zzz', 2)).toBeGreaterThan(2);
  });

  it('scales the budget with target length', () => {
    expect(fuzzyThreshold(3)).toBe(1);
    expect(fuzzyThreshold(7)).toBe(2);
    expect(fuzzyThreshold(20)).toBe(3);
  });

  it('computes trigram similarity', () => {
    expect(jaccard(trigrams('abc'), trigrams('abc'))).toBe(1);
    expect(jaccard(trigrams('abc'), new Set())).toBe(0);
  });
});

describe('ranking tiers', () => {
  it('ranks an exact slug highest', () => {
    const hit = top('widget-agg');
    expect(hit?.feature.id).toBe('widget-agg');
    expect(hit?.reason).toBe('exact_slug');
    expect(hit?.score).toBe(SCORE.EXACT_SLUG);
  });

  it('ranks an exact name next', () => {
    const hit = top('WIDGET_AGG');
    expect(hit?.feature.id).toBe('widget-agg');
    // The normalized name and the normalized slug coincide for this feature,
    // so either identity tier is correct; what matters is it wins outright.
    expect(hit?.score).toBeGreaterThanOrEqual(SCORE.EXACT_NAME);
  });

  it('matches an upstream alias', () => {
    const hit = top('SC');
    expect(hit?.feature.id).toBe('sparkle-compression');
    expect(hit?.reason).toBe('alias');
  });

  it('matches a server-side synonym', () => {
    const outcome = search(searchIndex, 'sparkle rebuild');
    expect(outcome.hits[0]?.feature.id).toBe('sparkle-compression');
    expect(outcome.interpretation.synonymsApplied).toContain('sparkle rebuild');
  });

  it('matches a prefix', () => {
    const hit = top('sparkle comp');
    expect(hit?.feature.id).toBe('sparkle-compression');
    expect(hit?.reason).toBe('prefix');
  });

  it('falls through to description matching', () => {
    expect(ids('filegroups')).toContain('tessellate-partition');
  });

  it('orders deterministically and identically across repeated runs', () => {
    const once = ids('index');
    const twice = ids('index');
    expect(once).toEqual(twice);
  });

  it('breaks ties by tier, then coverage, then name length, then slug', () => {
    const a = { score: 100, tier: 5, coverage: 1, nameLength: 10, slug: 'b' };
    expect(compareResults(a, { ...a, score: 200 })).toBeGreaterThan(0);
    expect(compareResults(a, { ...a, tier: 6 })).toBeLessThan(0);
    expect(compareResults(a, { ...a, coverage: 0.5 })).toBeLessThan(0);
    expect(compareResults(a, { ...a, nameLength: 20 })).toBeLessThan(0);
    expect(compareResults(a, { ...a, slug: 'c' })).toBeLessThan(0);
    expect(compareResults(a, { ...a })).toBe(0);
  });
});

describe('fuzzy fallback', () => {
  it('recovers a transposed misspelling', () => {
    const hit = top('WIGDET_AGG');
    expect(hit?.feature.id).toBe('widget-agg');
    expect(hit?.reason).toBe('fuzzy');
  });

  it('does not fire when an exact match exists', () => {
    const outcome = search(searchIndex, 'widget-agg');
    expect(outcome.hits.every((h) => h.reason !== 'fuzzy')).toBe(true);
  });

  it('returns nothing for a query unlike anything in the dataset', () => {
    expect(ids('zzzzqqqqxxxx')).toEqual([]);
  });
});

describe('empty queries', () => {
  it('returns no hits rather than throwing', () => {
    expect(search(searchIndex, '   ').hits).toEqual([]);
  });
});

describe('suggestions', () => {
  it('offers nearby ids', () => {
    expect(suggest(searchIndex, 'wigdet-agg', 3)).toContain('widget-agg');
  });

  it('returns nothing for an empty query', () => {
    expect(suggest(searchIndex, '')).toEqual([]);
  });
});

describe('synonym integrity', () => {
  it('every synonym target resolves to a live feature id', () => {
    const known = new Set(searchIndex.features.map((f) => f.feature.id));
    for (const [phrase, targets] of Object.entries(synonymMap)) {
      for (const target of targets) {
        expect(known.has(target), `synonym '${phrase}' targets missing feature '${target}'`).toBe(true);
      }
    }
  });
});
