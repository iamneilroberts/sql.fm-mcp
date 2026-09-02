import { SUPPORT_STATUSES, type SupportStatus, type EditionSlug } from './types.js';

const STATUS_SET: ReadonlySet<string> = new Set(SUPPORT_STATUSES);

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

const LABELS: Record<SupportStatus, string> = {
  available: 'Available',
  unavailable: 'Not available',
  conditional: 'Available with conditions',
  preview: 'Preview',
  not_applicable: 'Not applicable',
  unknown: 'Not recorded',
};

export function statusLabel(status: SupportStatus): string {
  return LABELS[status];
}

/**
 * Statuses that represent an absence of a recorded positive/negative answer.
 * Callers must surface these as gaps, never as negatives.
 */
export function isDataGap(status: SupportStatus): boolean {
  return status === 'unknown';
}

/** `not_applicable` is a statement about history: the environment did not exist. */
export function isNotApplicable(status: SupportStatus): boolean {
  return status === 'not_applicable';
}

export interface EditionStatus {
  edition: EditionSlug;
  status: SupportStatus;
}

export interface AggregateResult {
  status: SupportStatus;
  /**
   * Populated when editions disagree, naming which are and are not available.
   * This is what stops a mixed release collapsing into a bare yes or no.
   */
  condition: string | null;
  /** Editions that contributed a gap, if any. */
  unknownEditions: EditionSlug[];
}

function editionNames(editions: EditionSlug[], names: Record<string, string>): string {
  const labels = editions.map((e) => names[e] ?? e);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Aggregate per-edition statuses into a single release-level status.
 *
 * The lattice (architecture.md §10.3), in priority order:
 *
 *  1. Any `unknown`            -> `unknown`      (absorbing; never masked by known values)
 *  2. Mixed available/unavailable -> `conditional` (with a condition naming the editions)
 *  3. Any `preview`            -> `preview`
 *  4. Any `conditional`        -> `conditional`
 *  5. Uniform (ignoring `not_applicable`) -> that status
 *  6. All `not_applicable`     -> `not_applicable`
 *
 * Rule 1 comes first on purpose: an unrecorded edition must not be hidden
 * behind three recorded ones. Rule 2 is the case that matters most in
 * practice — an Enterprise-only feature aggregates to `conditional`, never to
 * `available` or `unavailable`, either of which would be a wrong answer to
 * "does SQL Server 2019 support X".
 */
export function aggregateEditions(
  cells: EditionStatus[],
  editionNamesBySlug: Record<string, string> = {},
): AggregateResult {
  if (cells.length === 0) {
    return { status: 'unknown', condition: null, unknownEditions: [] };
  }

  const unknownEditions = cells.filter((c) => c.status === 'unknown').map((c) => c.edition);
  if (unknownEditions.length > 0) {
    return {
      status: 'unknown',
      condition:
        `SQL.FM has not recorded support for ` +
        `${editionNames(unknownEditions, editionNamesBySlug)}.`,
      unknownEditions,
    };
  }

  // `not_applicable` editions did not exist in this release; they neither
  // support nor fail to support the feature, so they are excluded from the
  // comparison rather than counted as negatives.
  const applicable = cells.filter((c) => c.status !== 'not_applicable');
  if (applicable.length === 0) {
    return { status: 'not_applicable', condition: null, unknownEditions: [] };
  }

  const available = applicable.filter((c) => c.status === 'available').map((c) => c.edition);
  const unavailable = applicable.filter((c) => c.status === 'unavailable').map((c) => c.edition);

  if (available.length > 0 && unavailable.length > 0) {
    return {
      status: 'conditional',
      condition:
        `Available in ${editionNames(available, editionNamesBySlug)}; ` +
        `not available in ${editionNames(unavailable, editionNamesBySlug)}.`,
      unknownEditions: [],
    };
  }

  if (applicable.some((c) => c.status === 'preview')) {
    return { status: 'preview', condition: null, unknownEditions: [] };
  }
  if (applicable.some((c) => c.status === 'conditional')) {
    return { status: 'conditional', condition: null, unknownEditions: [] };
  }

  const distinct = new Set(applicable.map((c) => c.status));
  if (distinct.size === 1) {
    return { status: applicable[0]!.status, condition: null, unknownEditions: [] };
  }

  // Mixed statuses we have no better rule for. Report the ambiguity rather
  // than picking a winner.
  return {
    status: 'conditional',
    condition: 'Support differs by edition.',
    unknownEditions: [],
  };
}
