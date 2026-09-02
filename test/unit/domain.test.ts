import { describe, expect, it } from 'vitest';
import { releaseGrid, statusFor, introducedIn } from '../../src/domain/dataset.js';
import { resolveEnvironment } from '../../src/domain/environments.js';
import { editionStatuses, expectedRowLength, groupRuns, statusAt } from '../../src/domain/matrix.js';
import { aggregateEditions, statusLabel } from '../../src/domain/status.js';
import { loadFixture } from '../helpers.js';

const { dataset, indexed } = loadFixture();
const editionNames = { standard: 'Standard', enterprise: 'Enterprise', developer: 'Developer', express: 'Express' };

function feature(id: string) {
  const found = indexed.featureById.get(id);
  if (!found) throw new Error(`fixture is missing feature '${id}'`);
  return found;
}

function env(id: string) {
  const found = resolveEnvironment(indexed.environments, id);
  if (!found) throw new Error(`could not resolve environment '${id}'`);
  return found;
}

describe('matrix decoding', () => {
  it('computes the expected row length from the declared orders', () => {
    expect(expectedRowLength(dataset.support_matrix)).toBe(8 * 4);
  });

  it('decodes a known cell', () => {
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'widget-agg', 'mssql-2017', 'standard')).toBe(
      'available',
    );
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'widget-agg', 'mssql-2016', 'standard')).toBe(
      'unavailable',
    );
  });

  it('resolves every kind of gap to unknown rather than unavailable', () => {
    // Missing feature row.
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'no-such-feature', 'mssql-2019', 'standard')).toBe(
      'unknown',
    );
    // Release not in the matrix.
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'widget-agg', 'mssql-1066', 'standard')).toBe(
      'unknown',
    );
  });

  it('preserves not_applicable distinctly from unavailable', () => {
    // Express did not exist in SQL Server 2000.
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'widget-agg', 'mssql-2000', 'express')).toBe(
      'not_applicable',
    );
    expect(statusAt(dataset.support_matrix, indexed.matrixIndex, 'widget-agg', 'mssql-2000', 'standard')).toBe(
      'unavailable',
    );
  });

  it('reads all four editions in declared order', () => {
    const cells = editionStatuses(dataset.support_matrix, indexed.matrixIndex, 'sparkle-compression', 'mssql-2019');
    expect(cells.map((c) => c.edition)).toEqual(['standard', 'enterprise', 'developer', 'express']);
    expect(cells.map((c) => c.status)).toEqual(['unavailable', 'available', 'available', 'unavailable']);
  });
});

describe('groupRuns', () => {
  it('collapses consecutive identical signatures and keeps transitions', () => {
    const runs = groupRuns(['a', 'a', 'b', 'a'], (x) => x);
    expect(runs.map((r) => r.items.length)).toEqual([2, 1, 1]);
    expect(runs.map((r) => r.signature)).toEqual(['a', 'b', 'a']);
  });

  it('returns nothing for an empty input', () => {
    expect(groupRuns([], (x) => String(x))).toEqual([]);
  });
});

describe('edition aggregation lattice', () => {
  it('returns the uniform status when every edition agrees', () => {
    const result = aggregateEditions(
      [
        { edition: 'standard', status: 'available' },
        { edition: 'enterprise', status: 'available' },
      ],
      editionNames,
    );
    expect(result.status).toBe('available');
    expect(result.condition).toBeNull();
  });

  it('returns conditional — never available or unavailable — when editions split', () => {
    const result = aggregateEditions(
      [
        { edition: 'standard', status: 'unavailable' },
        { edition: 'enterprise', status: 'available' },
        { edition: 'developer', status: 'available' },
        { edition: 'express', status: 'unavailable' },
      ],
      editionNames,
    );
    expect(result.status).toBe('conditional');
    expect(result.condition).toBe(
      'Available in Enterprise and Developer; not available in Standard and Express.',
    );
  });

  it('lets unknown absorb — it is never masked by known editions', () => {
    const result = aggregateEditions(
      [
        { edition: 'standard', status: 'available' },
        { edition: 'enterprise', status: 'available' },
        { edition: 'developer', status: 'available' },
        { edition: 'express', status: 'unknown' },
      ],
      editionNames,
    );
    expect(result.status).toBe('unknown');
    expect(result.unknownEditions).toEqual(['express']);
  });

  it('excludes not_applicable editions from the comparison instead of counting them as negatives', () => {
    const result = aggregateEditions(
      [
        { edition: 'standard', status: 'available' },
        { edition: 'express', status: 'not_applicable' },
      ],
      editionNames,
    );
    expect(result.status).toBe('available');
  });

  it('returns not_applicable only when every edition is', () => {
    const result = aggregateEditions(
      [
        { edition: 'standard', status: 'not_applicable' },
        { edition: 'express', status: 'not_applicable' },
      ],
      editionNames,
    );
    expect(result.status).toBe('not_applicable');
  });

  it('treats an empty cell list as unknown, not unavailable', () => {
    expect(aggregateEditions([], editionNames).status).toBe('unknown');
  });
});

describe('environment registry', () => {
  it('derives an aggregate plus a per-edition id for every release, and one per cloud target', () => {
    // 8 releases x (1 aggregate + 4 editions) + 2 cloud targets
    expect(indexed.environments.all).toHaveLength(8 * 5 + 2);
  });

  it('resolves canonical ids', () => {
    expect(env('mssql-2019').id).toBe('mssql-2019');
    expect(env('mssql-2019-standard').id).toBe('mssql-2019-standard');
    expect(env('azure-sql-db').id).toBe('azure-sql-db');
  });

  it('resolves the phrasings a model or a person actually types', () => {
    expect(env('SQL Server 2019').id).toBe('mssql-2019');
    expect(env('SQL Server 2019 Standard').id).toBe('mssql-2019-standard');
    expect(env('2019 std').id).toBe('mssql-2019-standard');
    expect(env('Azure SQL Database').id).toBe('azure-sql-db');
    expect(env('managed instance').id).toBe('azure-sql-mi');
    expect(env('azuresqldb').id).toBe('azure-sql-db');
    expect(env('15.0').id).toBe('mssql-2019');
  });

  it('returns null for anything it cannot resolve', () => {
    expect(resolveEnvironment(indexed.environments, 'mssql-1999')).toBeNull();
    expect(resolveEnvironment(indexed.environments, 'postgres-16')).toBeNull();
  });
});

describe('statusFor', () => {
  it('reports an edition-specific answer, not a release-level one', () => {
    expect(statusFor(indexed, feature('sparkle-compression'), env('mssql-2019-standard')).status).toBe(
      'unavailable',
    );
    expect(statusFor(indexed, feature('sparkle-compression'), env('mssql-2019-enterprise')).status).toBe(
      'available',
    );
  });

  it('aggregates a split release to conditional with an explanatory condition', () => {
    const resolved = statusFor(indexed, feature('sparkle-compression'), env('mssql-2019'));
    expect(resolved.status).toBe('conditional');
    expect(resolved.conditions.join(' ')).toContain('Enterprise');
    expect(resolved.conditions.join(' ')).toContain('Standard');
  });

  it('reads cloud status from cloud_support and surfaces its note as a condition', () => {
    const resolved = statusFor(indexed, feature('flux-capacitor-index'), env('azure-sql-mi'));
    expect(resolved.status).toBe('conditional');
    expect(resolved.conditions[0]).toContain('maintenance windows');
  });

  it('treats an absent cloud entry as unknown, not unavailable', () => {
    // quantum-replication deliberately has no azure-sql-mi record.
    const resolved = statusFor(indexed, feature('quantum-replication'), env('azure-sql-mi'));
    expect(resolved.status).toBe('unknown');
  });
});

describe('releaseGrid and introducedIn', () => {
  it('produces one row per release in matrix order', () => {
    const grid = releaseGrid(indexed, feature('widget-agg'));
    expect(grid.map((r) => r.release.id)).toEqual(dataset.support_matrix.release_order);
  });

  it('reports the recorded introduction release', () => {
    expect(introducedIn(indexed, feature('widget-agg'))?.release.id).toBe('mssql-2017');
    expect(introducedIn(indexed, feature('glyph-parse'))?.release.id).toBe('mssql-2022');
  });

  it('falls back to the first available release when no event is recorded', () => {
    expect(introducedIn(indexed, feature('nimbus-cache'))?.release.id).toBe('mssql-2025');
  });
});

describe('status labels', () => {
  it('never labels a gap as unsupported', () => {
    expect(statusLabel('unknown')).toBe('Not recorded');
    expect(statusLabel('not_applicable')).toBe('Not applicable');
    expect(statusLabel('unavailable')).toBe('Not available');
  });
});
