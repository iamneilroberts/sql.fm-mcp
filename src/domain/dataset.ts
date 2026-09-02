import {
  buildEnvironmentRegistry,
  type EnvironmentRef,
  type EnvironmentRegistry,
} from './environments.js';
import { editionStatuses, indexMatrix, orderedReleases, type DecodedMatrix } from './matrix.js';
import { aggregateEditions } from './status.js';
import type { Dataset, EditionSlug, Feature, Release, SupportStatus } from './types.js';

/** The status of one feature in one environment, with everything needed to explain it. */
export interface EnvironmentStatus {
  environment: EnvironmentRef;
  status: SupportStatus;
  /** Qualifications that narrow the status (edition splits, cloud limitations). */
  conditions: string[];
  /** Contextual notes that do not change the status (introduction history, etc). */
  notes: string[];
  sources: string[];
}

/** One release row of a feature's on-premises support. */
export interface ReleaseRow {
  release: Release;
  editions: Record<EditionSlug, SupportStatus>;
  aggregate: SupportStatus;
  aggregateCondition: string | null;
}

/**
 * A dataset plus the derived lookup structures every read needs.
 *
 * Built once per provider load and shared by every request in the isolate.
 * Pure: no I/O, no clock, no environment access — which is what makes the
 * ranking and comparison tests meaningful.
 */
export interface IndexedDataset {
  raw: Dataset;
  environments: EnvironmentRegistry;
  matrixIndex: DecodedMatrix;
  featureById: Map<string, Feature>;
  releases: Release[];
  editionNames: Record<string, string>;
}

export function indexDataset(dataset: Dataset): IndexedDataset {
  return {
    raw: dataset,
    environments: buildEnvironmentRegistry(dataset),
    matrixIndex: indexMatrix(dataset.support_matrix),
    featureById: new Map(dataset.features.map((f) => [f.id, f])),
    releases: orderedReleases(dataset),
    editionNames: Object.fromEntries(dataset.editions.map((e) => [e.id, e.name])),
  };
}

function matchingConditions(
  feature: Feature,
  environmentId: string | null,
  edition: EditionSlug | null,
): string[] {
  return feature.conditions
    .filter((c) => {
      if (c.environment !== null && c.environment !== environmentId) return false;
      // A condition scoped to one edition applies to that edition, and to the
      // release as a whole (where it explains part of the aggregate).
      if (c.edition !== null && edition !== null && c.edition !== edition) return false;
      return true;
    })
    .map((c) => c.note);
}

function conditionSources(
  feature: Feature,
  environmentId: string | null,
  edition: EditionSlug | null,
): string[] {
  return feature.conditions
    .filter((c) => {
      if (c.environment !== null && c.environment !== environmentId) return false;
      if (c.edition !== null && edition !== null && c.edition !== edition) return false;
      return true;
    })
    .flatMap((c) => (c.source ? [c.source] : []));
}

function matchingTimeline(feature: Feature, environmentId: string | null): string[] {
  if (environmentId === null) return [];
  return feature.timeline.filter((t) => t.environment === environmentId).map((t) => t.summary);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/**
 * Resolve one feature's status in one environment.
 *
 * Three shapes are handled: a cloud target (read from `cloud_support`), a
 * specific release/edition pair (read from the matrix), and a whole release
 * (aggregated across editions via the lattice in status.ts).
 */
export function statusFor(
  indexed: IndexedDataset,
  feature: Feature,
  environment: EnvironmentRef,
): EnvironmentStatus {
  if (environment.kind === 'azure') {
    const cell = feature.cloud_support[environment.id];
    if (!cell) {
      return {
        environment,
        status: 'unknown',
        conditions: [],
        notes: [],
        sources: [],
      };
    }
    const note = cell.note ?? '';
    // A note attached to a conditional status IS the condition; on any other
    // status it is context that does not narrow the answer.
    const isCondition = cell.status === 'conditional' && note.length > 0;
    return {
      environment,
      status: cell.status,
      conditions: unique([
        ...(isCondition ? [note] : []),
        ...matchingConditions(feature, environment.id, null),
      ]),
      notes: unique([...(isCondition ? [] : [note])]),
      sources: unique([...cell.sources, ...conditionSources(feature, environment.id, null)]),
    };
  }

  const releaseId = environment.release?.id ?? environment.id;

  if (!environment.aggregate && environment.edition !== null) {
    const cells = editionStatuses(
      indexed.raw.support_matrix,
      indexed.matrixIndex,
      feature.id,
      releaseId,
    );
    const cell = cells.find((c) => c.edition === environment.edition);
    return {
      environment,
      status: cell?.status ?? 'unknown',
      conditions: unique(matchingConditions(feature, releaseId, environment.edition)),
      notes: unique(matchingTimeline(feature, releaseId)),
      sources: unique(conditionSources(feature, releaseId, environment.edition)),
    };
  }

  const cells = editionStatuses(
    indexed.raw.support_matrix,
    indexed.matrixIndex,
    feature.id,
    releaseId,
  );
  const aggregate = aggregateEditions(cells, indexed.editionNames);
  return {
    environment,
    status: aggregate.status,
    conditions: unique([
      ...(aggregate.condition ? [aggregate.condition] : []),
      ...matchingConditions(feature, releaseId, null),
    ]),
    notes: unique(matchingTimeline(feature, releaseId)),
    sources: unique(conditionSources(feature, releaseId, null)),
  };
}

/** The full on-premises grid for a feature, one row per release. */
export function releaseGrid(indexed: IndexedDataset, feature: Feature): ReleaseRow[] {
  return indexed.releases.map((release) => {
    const cells = editionStatuses(
      indexed.raw.support_matrix,
      indexed.matrixIndex,
      feature.id,
      release.id,
    );
    const aggregate = aggregateEditions(cells, indexed.editionNames);
    const editions = Object.fromEntries(cells.map((c) => [c.edition, c.status])) as Record<
      EditionSlug,
      SupportStatus
    >;
    return {
      release,
      editions,
      aggregate: aggregate.status,
      aggregateCondition: aggregate.condition,
    };
  });
}

/** The earliest release where the feature is recorded available or preview. */
export function introducedIn(
  indexed: IndexedDataset,
  feature: Feature,
): { release: Release; summary: string | null } | null {
  const explicit = feature.timeline.find((t) => t.event === 'introduced');
  if (explicit) {
    const release = indexed.releases.find((r) => r.id === explicit.environment);
    if (release) return { release, summary: explicit.summary };
  }

  for (const row of releaseGrid(indexed, feature)) {
    if (row.aggregate === 'available' || row.aggregate === 'preview' || row.aggregate === 'conditional') {
      return { release: row.release, summary: null };
    }
  }
  return null;
}
