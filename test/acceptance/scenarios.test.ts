import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { callTool, connectClient, expectError, expectStructured } from '../mcp-harness.js';

/**
 * The acceptance suite from architecture.md §14.2, run end-to-end through the
 * MCP client against SYNTHETIC fixtures.
 *
 * The feature names are invented, but each fixture reproduces a semantic
 * shape actually observed in the upstream data (edition splits, Azure
 * divergence, conditional support with notes, unverified cells, editions that
 * did not exist yet). That is what makes these meaningful evidence about
 * production behaviour without embedding SQL.FM content.
 */

let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ client, close } = await connectClient());
});
afterAll(async () => {
  await close();
});

interface SearchOutput {
  results: { id: string; title: string; url: string; score: number; match_reason: string }[];
  total_matched: number;
  truncated: boolean;
  suggestions: string[];
  query_interpretation: {
    normalized_query: string;
    tokens: string[];
    synonyms_applied: string[];
    filters: { category: string | null; environment: string | null; status: string | null };
  };
  attribution: string;
  disclaimer: string;
  source: { name: string; url: string };
}

interface FetchOutput {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    support: {
      sql_server: {
        release: string;
        editions: Record<string, string>;
        aggregate: string;
        aggregate_condition: string | null;
      }[];
      azure: Record<string, { status: string; conditions: string[] }>;
    };
    requirements: { compatibility_level: string | null };
    data_gaps: string[];
    microsoft_docs: string[];
  };
}

interface CompareOutput {
  feature: { id: string; url: string };
  rows: {
    environment: string;
    label: string;
    status: string;
    status_label: string;
    conditions: string[];
    collapsed_range: { from: string; to: string; count: number } | null;
  }[];
  summary: string;
  differences: { from_environment: string; to_environment: string; from_status: string; to_status: string }[];
  unknown_environments: string[];
  warnings: string[];
  url: string;
  microsoft_docs: string[];
}

const doSearch = async (args: Record<string, unknown>): Promise<SearchOutput> =>
  expectStructured<SearchOutput>(await callTool(client, 'search', args));
const doFetch = async (id: string): Promise<FetchOutput> =>
  expectStructured<FetchOutput>(await callTool(client, 'fetch', { id }));
const doCompare = async (args: Record<string, unknown>): Promise<CompareOutput> =>
  expectStructured<CompareOutput>(await callTool(client, 'compare_feature_support', args));

describe('1. exact feature-name search', () => {
  it('ranks the exact name first with a top-tier score', async () => {
    const output = await doSearch({ query: 'WIDGET_AGG' });
    expect(output.results[0]?.id).toBe('widget-agg');
    expect(output.results[0]?.score).toBeGreaterThanOrEqual(950);
    expect(['exact_name', 'exact_slug']).toContain(output.results[0]?.match_reason);
  });
});

describe('2. natural-language search', () => {
  it('finds the feature from a question, dropping stop words', async () => {
    const output = await doSearch({ query: 'which version added widget aggregation' });
    expect(output.results.slice(0, 3).map((r) => r.id)).toContain('widget-agg');
    expect(output.query_interpretation.tokens).not.toContain('which');
  });

  it('resolves a phrasing that only the server-side synonym list covers', async () => {
    const output = await doSearch({ query: 'sparkle rebuild' });
    expect(output.results[0]?.id).toBe('sparkle-compression');
    expect(output.query_interpretation.synonyms_applied).toContain('sparkle rebuild');
  });
});

describe('3. misspelled feature search', () => {
  it('recovers a transposition via fuzzy matching', async () => {
    const output = await doSearch({ query: 'WIGDET_AGG' });
    expect(output.results[0]?.id).toBe('widget-agg');
    expect(output.results[0]?.match_reason).toBe('fuzzy');
  });

  it('does not fuzzy-match when an exact match exists', async () => {
    const output = await doSearch({ query: 'WIDGET_AGG' });
    expect(output.results.every((r) => r.match_reason !== 'fuzzy')).toBe(true);
  });
});

describe('4. comparison across SQL Server versions', () => {
  it('returns one row per environment, in the requested order, and finds the transition', async () => {
    const output = await doCompare({
      id: 'widget-agg',
      environments: ['mssql-2012', 'mssql-2016', 'mssql-2017', 'mssql-2019', 'mssql-2022'],
    });
    expect(output.rows).toHaveLength(5);
    expect(output.rows.map((r) => r.environment)).toEqual([
      'mssql-2012',
      'mssql-2016',
      'mssql-2017',
      'mssql-2019',
      'mssql-2022',
    ]);
    expect(output.differences).toEqual([
      {
        from_environment: 'mssql-2016',
        to_environment: 'mssql-2017',
        from_status: 'unavailable',
        to_status: 'available',
      },
    ]);
  });

  it('collapses unchanged runs when asked, keeping transitions', async () => {
    const output = await doCompare({
      id: 'widget-agg',
      environments: ['mssql-2012', 'mssql-2016', 'mssql-2017', 'mssql-2019', 'mssql-2022'],
      include_unchanged: false,
    });
    expect(output.rows).toHaveLength(2);
    expect(output.rows[0]?.collapsed_range).toMatchObject({ from: 'mssql-2012', count: 2 });
    expect(output.rows[1]?.collapsed_range).toMatchObject({ from: 'mssql-2017', count: 3 });
    // differences are populated regardless of the flag
    expect(output.differences).toHaveLength(1);
  });
});

describe('5. edition-specific restrictions', () => {
  it('answers Standard and Enterprise differently within the same release', async () => {
    const output = await doCompare({
      id: 'sparkle-compression',
      environments: ['mssql-2019-standard', 'mssql-2019-enterprise'],
    });
    expect(output.rows[0]?.status).toBe('unavailable');
    expect(output.rows[1]?.status).toBe('available');
  });

  it('aggregates a split release to conditional, never to a bare yes or no', async () => {
    const output = await doCompare({ id: 'sparkle-compression', environments: ['mssql-2019'] });
    expect(output.rows[0]?.status).toBe('conditional');
    expect(output.rows[0]?.conditions.join(' ')).toContain('Enterprise');
    expect(output.rows[0]?.conditions.join(' ')).toContain('Standard');
  });

  it('reports the same split in the full record', async () => {
    const record = await doFetch('sparkle-compression');
    const row2019 = record.metadata.support.sql_server.find((r) => r.release === 'mssql-2019')!;
    expect(row2019.editions['standard']).toBe('unavailable');
    expect(row2019.editions['enterprise']).toBe('available');
    expect(row2019.aggregate).toBe('conditional');
    expect(row2019.aggregate_condition).toContain('Enterprise');
  });
});

describe('6. Azure SQL Database vs Managed Instance', () => {
  it('returns differing statuses with per-target notes', async () => {
    const output = await doCompare({
      id: 'flux-capacitor-index',
      environments: ['azure-sql-db', 'azure-sql-mi'],
    });
    expect(output.rows[0]?.status).toBe('available');
    expect(output.rows[1]?.status).toBe('conditional');
    expect(output.rows[1]?.conditions[0]).toContain('maintenance windows');
    expect(output.differences).toHaveLength(1);
  });
});

describe('7. conditional support with explanatory notes', () => {
  it('carries the condition text into rows and summary', async () => {
    const output = await doCompare({ id: 'zephyr-audit', environments: ['azure-sql-db'] });
    expect(output.rows[0]?.status).toBe('conditional');
    expect(output.rows[0]?.conditions.length).toBeGreaterThan(0);
    expect(output.summary).toContain('blob storage');
  });
});

describe('8. unknown or incomplete data', () => {
  it('reports unknown as unknown, warns, and never says unavailable', async () => {
    const output = await doCompare({
      id: 'quantum-replication',
      environments: ['mssql-2022', 'mssql-2025'],
    });
    const row2025 = output.rows.find((r) => r.environment === 'mssql-2025')!;
    expect(row2025.status).toBe('unknown');
    expect(row2025.status_label).toBe('Not recorded');
    expect(output.unknown_environments).toContain('SQL Server 2025');
    expect(output.warnings.join(' ')).toContain('not as unsupported');
    expect(output.summary.startsWith('SQL.FM has not recorded')).toBe(true);
  });

  it('treats an absent Azure record as unknown, not unavailable', async () => {
    const output = await doCompare({ id: 'quantum-replication', environments: ['azure-sql-mi'] });
    expect(output.rows[0]?.status).toBe('unknown');
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it('reports compatibility level as not recorded rather than inventing it', async () => {
    const record = await doFetch('widget-agg');
    expect(record.metadata.requirements.compatibility_level).toBeNull();
    expect(record.text).toContain('Compatibility level: not recorded in SQL.FM.');
    expect(record.metadata.data_gaps.join(' ')).toContain('Compatibility-level');
  });
});

describe('9. invalid feature ids', () => {
  it('returns a structured error with suggestions and no internals', async () => {
    const error = expectError(await callTool(client, 'fetch', { id: 'wigdet-agg' }));
    expect(error.code).toBe('feature_not_found');
    expect(error.retryable).toBe(false);
    expect(error.suggestions).toContain('widget-agg');
    expect(JSON.stringify(error)).not.toMatch(/\/home\/|at Object\.|node_modules/);
  });

  it('rejects an id that violates the grammar before any lookup', async () => {
    const error = expectError(await callTool(client, 'fetch', { id: '../../etc/passwd' }));
    expect(error.code).toBe('invalid_input');
    expect(error.field).toBe('id');
  });

  it('rejects an unknown environment with the valid list attached', async () => {
    const error = expectError(
      await callTool(client, 'compare_feature_support', {
        id: 'widget-agg',
        environments: ['mssql-2019', 'postgres-16'],
      }),
    );
    expect(error.code).toBe('unknown_environment');
    expect(error.valid_environments).toContain('mssql-2019-standard');
  });
});

describe('10. empty searches', () => {
  it('returns an empty result set with suggestions, not an error', async () => {
    const output = await doSearch({ query: 'zzzzqqqqxxxx' });
    expect(output.results).toEqual([]);
    expect(output.total_matched).toBe(0);
    expect(output.suggestions.length).toBeGreaterThan(0);
  });

  it('rejects a blank query as invalid input rather than returning everything', async () => {
    const result = await callTool(client, 'search', { query: '' });
    expect(result.isError).toBe(true);
  });
});

describe('11. canonical citation URLs', () => {
  it('every search result URL is the canonical feature URL and round-trips through fetch', async () => {
    const output = await doSearch({ query: 'index', limit: 10 });
    expect(output.results.length).toBeGreaterThan(0);
    for (const result of output.results) {
      expect(result.url).toBe(`https://sql.fm/features/${result.id}/`);
      const record = await doFetch(result.id);
      expect(record.id).toBe(result.id);
      expect(record.url).toBe(result.url);
    }
  });

  it('carries attribution, disclaimer, and source on every tool result', async () => {
    const search = await doSearch({ query: 'widget-agg' });
    expect(search.attribution).toBeTruthy();
    expect(search.disclaimer).toBeTruthy();
    expect(search.source.name).toBe('SQL.FM');

    const compare = await doCompare({ id: 'widget-agg', environments: ['mssql-2019'] });
    expect(compare.url).toBe('https://sql.fm/features/widget-agg/');
    expect(compare.microsoft_docs.length).toBeGreaterThan(0);
  });
});

describe('12. filters', () => {
  it('filters by category', async () => {
    const output = await doSearch({ query: 'index', category: 'Indexing', limit: 10 });
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.query_interpretation.filters.category).toBe('Indexing');
  });

  it('filters by environment and status, defaulting status to available', async () => {
    const all = await doSearch({ query: 'sparkle', limit: 10 });
    expect(all.results.map((r) => r.id)).toContain('sparkle-compression');

    const standard = await doSearch({ query: 'sparkle', environment: 'mssql-2019-standard', limit: 10 });
    expect(standard.results.map((r) => r.id)).not.toContain('sparkle-compression');

    const enterprise = await doSearch({
      query: 'sparkle',
      environment: 'mssql-2019-enterprise',
      limit: 10,
    });
    expect(enterprise.results.map((r) => r.id)).toContain('sparkle-compression');
    expect(enterprise.query_interpretation.filters.status).toBe('available');
  });

  it('honours the result limit and reports truncation', async () => {
    const output = await doSearch({ query: 'a', limit: 2 });
    expect(output.results.length).toBeLessThanOrEqual(2);
    if (output.total_matched > 2) expect(output.truncated).toBe(true);
  });
});

describe('13. composed fetch text', () => {
  it('compresses agreeing releases into ranges and expands edition splits', async () => {
    const record = await doFetch('sparkle-compression');
    expect(record.text).toContain('Sparkle Compression');
    expect(record.text).toContain('Introduced: SQL Server 2016');
    // The edition split must be spelled out, not hidden behind a range.
    expect(record.text).toMatch(/available: Enterprise, Developer/);
    expect(record.text).toMatch(/not available: Standard, Express/);
    // Agreeing releases collapse.
    expect(record.text).toMatch(/2016-2025/);
    expect(record.text).toContain('https://sql.fm/features/sparkle-compression/');
  });

  it('marks the editions that did not exist yet as not applicable, not unavailable', async () => {
    const record = await doFetch('widget-agg');
    const row2000 = record.metadata.support.sql_server.find((r) => r.release === 'mssql-2000')!;
    expect(row2000.editions['express']).toBe('not_applicable');
    expect(row2000.editions['standard']).toBe('unavailable');
  });
});

describe('14. determinism', () => {
  it('produces byte-identical output for repeated identical calls', async () => {
    const a = await callTool(client, 'search', { query: 'index', limit: 10 });
    const b = await callTool(client, 'search', { query: 'index', limit: 10 });
    expect(JSON.stringify(a.structuredContent)).toBe(JSON.stringify(b.structuredContent));

    const c = await callTool(client, 'compare_feature_support', {
      id: 'sparkle-compression',
      environments: ['mssql-2016', 'mssql-2019-standard', 'azure-sql-db'],
    });
    const d = await callTool(client, 'compare_feature_support', {
      id: 'sparkle-compression',
      environments: ['mssql-2016', 'mssql-2019-standard', 'azure-sql-db'],
    });
    expect(JSON.stringify(c.structuredContent)).toBe(JSON.stringify(d.structuredContent));
  });

  it('returns both structuredContent and a JSON-encoded text block', async () => {
    const result = await callTool(client, 'search', { query: 'widget-agg' });
    expect(result.structuredContent).toBeDefined();
    expect(result.content?.[0]?.type).toBe('text');
    expect(JSON.parse(result.content![0]!.text!)).toEqual(result.structuredContent);
  });
});
