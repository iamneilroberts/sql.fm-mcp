import { describe, expect, it } from 'vitest';
import { compareFeature } from '../../src/domain/compare.js';
import { indexDataset, releaseGrid, statusFor } from '../../src/domain/dataset.js';
import { composeFeatureText } from '../../src/domain/text.js';
import { SUPPORT_STATUSES, type SupportStatus } from '../../src/domain/types.js';
import { validateDataset } from '../../src/providers/validate.js';
import { rawFixture } from '../helpers.js';

/**
 * THE CORE INVARIANT.
 *
 * For any dataset, a cell recorded as `unknown` or `not_applicable` must never
 * be reported as `unavailable` — through any tool, at any level of
 * aggregation. This is the failure mode that would make the server
 * confidently wrong, so it is asserted over generated inputs rather than a
 * handful of examples.
 */

/** Deterministic PRNG so a failure is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODES = ['a', 'u', 'n', '?', 'p'] as const;
const CODE_TO_STATUS: Record<string, SupportStatus> = {
  a: 'available',
  u: 'unavailable',
  n: 'not_applicable',
  '?': 'unknown',
  p: 'preview',
};

/** Replace every matrix row and cloud status with random values. */
function randomizeDataset(seed: number): Record<string, unknown> {
  const random = mulberry32(seed);
  const raw = rawFixture();

  const matrix = raw['support_matrix'] as { rows: Record<string, string> };
  const length = Object.values(matrix.rows)[0]?.length ?? 0;
  for (const key of Object.keys(matrix.rows)) {
    matrix.rows[key] = Array.from(
      { length },
      () => CODES[Math.floor(random() * CODES.length)] as string,
    ).join('');
  }

  const features = raw['features'] as {
    cloud_support: Record<string, { status: string; note: string | null; sources: string[] }>;
  }[];
  for (const feature of features) {
    for (const key of Object.keys(feature.cloud_support)) {
      const status = SUPPORT_STATUSES[Math.floor(random() * SUPPORT_STATUSES.length)] as string;
      // Randomly drop entries too, so absence is exercised alongside `unknown`.
      if (random() < 0.2) delete feature.cloud_support[key];
      else feature.cloud_support[key]!.status = status;
    }
  }

  return raw;
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('gaps are never reported as unavailable', () => {
  it.each(SEEDS)('holds for randomized dataset seed %i', (seed) => {
    const raw = randomizeDataset(seed);
    const matrix = raw['support_matrix'] as { rows: Record<string, string>; edition_order: string[]; release_order: string[] };
    const indexed = indexDataset(validateDataset(raw));

    for (const feature of indexed.raw.features) {
      const row = matrix.rows[feature.id]!;

      // 1. Per-edition reads reproduce the recorded code exactly.
      for (const [releaseIndex, releaseId] of matrix.release_order.entries()) {
        for (const [editionIndex, edition] of matrix.edition_order.entries()) {
          const code = row[releaseIndex * matrix.edition_order.length + editionIndex]!;
          const expected = CODE_TO_STATUS[code]!;
          const environment = indexed.environments.byId.get(`${releaseId}-${edition}`)!;
          expect(statusFor(indexed, feature, environment).status).toBe(expected);
        }
      }

      // 2. Aggregation never turns a gap into a negative.
      for (const rowResult of releaseGrid(indexed, feature)) {
        const statuses = Object.values(rowResult.editions);
        if (statuses.includes('unknown')) {
          expect(rowResult.aggregate).toBe('unknown');
        }
        if (statuses.every((s) => s === 'not_applicable')) {
          expect(rowResult.aggregate).toBe('not_applicable');
        }
        if (rowResult.aggregate === 'unavailable') {
          // The only way to report "unavailable" is for every applicable
          // edition to have actually recorded `unavailable`.
          expect(
            statuses.every((s) => s === 'unavailable' || s === 'not_applicable'),
          ).toBe(true);
        }
      }

      // 3. The comparison tool preserves the same guarantee, and always warns.
      const environments = indexed.environments.all.filter((e) => e.aggregate || e.kind === 'azure');
      const comparison = compareFeature(indexed, feature, environments, true);
      for (const comparisonRow of comparison.rows) {
        const source = statusFor(
          indexed,
          feature,
          indexed.environments.byId.get(comparisonRow.environment)!,
        );
        expect(comparisonRow.status).toBe(source.status);
      }
      if (comparison.rows.some((r) => r.status === 'unknown')) {
        expect(comparison.warnings.length).toBeGreaterThan(0);
        expect(comparison.unknownEnvironments.length).toBeGreaterThan(0);
        expect(comparison.summary).toContain('not recorded');
      }

      // 4. Composed prose never calls a gap unsupported.
      const composed = composeFeatureText(indexed, feature);
      expect(composed.text).not.toMatch(/unknown.*not available|not available.*\bunknown\b/i);
      if (comparison.rows.some((r) => r.status === 'unknown')) {
        expect(composed.dataGaps.length).toBeGreaterThan(0);
      }
    }
  });
});
