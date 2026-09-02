import { statusFor, type EnvironmentStatus, type IndexedDataset } from './dataset.js';
import { resolveEnvironment, type EnvironmentRef } from './environments.js';
import { groupRuns } from './matrix.js';
import { statusLabel } from './status.js';
import type { Feature, SupportStatus } from './types.js';

export interface ComparisonRow {
  environment: string;
  label: string;
  status: SupportStatus;
  statusLabel: string;
  conditions: string[];
  notes: string[];
  sources: string[];
  collapsedRange?: { from: string; to: string; count: number };
}

export interface StatusDifference {
  from_environment: string;
  to_environment: string;
  from_status: SupportStatus;
  to_status: SupportStatus;
}

export interface Comparison {
  rows: ComparisonRow[];
  differences: StatusDifference[];
  unknownEnvironments: string[];
  warnings: string[];
  summary: string;
  sources: string[];
}

/**
 * Resolve requested environment strings to canonical environments.
 *
 * Returns the first unresolvable input rather than dropping it. A silently
 * dropped row reads to a model as "not applicable" and produces a confident
 * wrong answer, so an unknown environment is always an error the caller must
 * surface (architecture.md §10.1).
 */
export function resolveRequestedEnvironments(
  indexed: IndexedDataset,
  requested: string[],
): { environments: EnvironmentRef[] } | { unresolved: string } {
  const environments: EnvironmentRef[] = [];
  for (const input of requested) {
    const resolved = resolveEnvironment(indexed.environments, input);
    if (!resolved) return { unresolved: input };
    environments.push(resolved);
  }
  return { environments };
}

function toRow(resolved: EnvironmentStatus): ComparisonRow {
  return {
    environment: resolved.environment.id,
    label: resolved.environment.label,
    status: resolved.status,
    statusLabel: statusLabel(resolved.status),
    conditions: resolved.conditions,
    notes: resolved.notes,
    sources: resolved.sources,
  };
}

function buildSummary(
  feature: Feature,
  rows: ComparisonRow[],
  unknownEnvironments: string[],
): string {
  const sentences: string[] = [];

  // Gaps lead. A reader must not have to reach the end to learn that part of
  // the answer is unrecorded.
  if (unknownEnvironments.length > 0) {
    sentences.push(
      `SQL.FM has not recorded ${feature.name} support for ${unknownEnvironments.join(', ')}; ` +
        `that is missing data, not an indication that the feature is unsupported.`,
    );
  }

  const known = rows.filter((r) => r.status !== 'unknown');
  const byStatus = new Map<SupportStatus, string[]>();
  for (const row of known) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row.label);
    byStatus.set(row.status, list);
  }

  for (const [status, labels] of byStatus) {
    sentences.push(`${statusLabel(status)} in ${labels.join(', ')}.`);
  }

  const conditions = [...new Set(known.flatMap((r) => r.conditions))];
  if (conditions.length > 0) sentences.push(conditions.join(' '));

  return sentences.join(' ');
}

/**
 * Compare one feature across a set of environments, preserving the caller's
 * requested order — a model that asked for 2016, 2019, 2022 gets them back in
 * that order, which is how it will narrate the answer.
 */
export function compareFeature(
  indexed: IndexedDataset,
  feature: Feature,
  environments: EnvironmentRef[],
  includeUnchanged: boolean,
): Comparison {
  const resolved = environments.map((environment) => statusFor(indexed, feature, environment));
  const allRows = resolved.map(toRow);

  const differences: StatusDifference[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const previous = allRows[i - 1]!;
    const current = allRows[i]!;
    if (previous.status !== current.status) {
      differences.push({
        from_environment: previous.environment,
        to_environment: current.environment,
        from_status: previous.status,
        to_status: current.status,
      });
    }
  }

  let rows = allRows;
  if (!includeUnchanged && allRows.length > 1) {
    // Collapse consecutive identical statuses into one row per run, keeping
    // every transition. `differences` is populated either way, so "when did
    // this change" is answerable without a second call.
    rows = groupRuns(allRows, (row) => `${row.status}|${row.conditions.join('~')}`).map((run) => {
      if (run.items.length === 1) return run.first;
      return {
        ...run.first,
        collapsedRange: {
          from: run.first.environment,
          to: run.last.environment,
          count: run.items.length,
        },
      };
    });
  }

  const unknownEnvironments = allRows.filter((r) => r.status === 'unknown').map((r) => r.label);
  const warnings: string[] = [];
  if (unknownEnvironments.length > 0) {
    warnings.push(
      `SQL.FM has no recorded support data for: ${unknownEnvironments.join(', ')}. ` +
        `Treat this as unknown, not as unsupported.`,
    );
  }

  const sources = [
    ...new Set([...feature.microsoft_docs, ...allRows.flatMap((r) => r.sources)]),
  ];

  return {
    rows,
    differences,
    unknownEnvironments,
    warnings,
    summary: buildSummary(feature, allRows, unknownEnvironments),
    sources,
  };
}
