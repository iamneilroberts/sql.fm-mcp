import { introducedIn, releaseGrid, statusFor, type IndexedDataset, type ReleaseRow } from './dataset.js';
import { groupRuns } from './matrix.js';
import { statusLabel } from './status.js';
import type { EditionSlug, Feature, Release, SupportStatus } from './types.js';

/**
 * Deterministic composition of the model-readable `text` body for `fetch`.
 *
 * Upstream summaries average ~130 characters, far too thin to be the body of
 * a reference answer, so `text` is composed from the structured record. It is
 * a pure function with golden-file tests: wording changes are reviewable
 * diffs, not surprises.
 *
 * Runs of releases that agree are compressed ("2017-2025") because spelling
 * out 19 releases x 4 editions would bury the reader. A run only extends
 * while the per-edition signature is IDENTICAL — any edition divergence
 * starts a new line, because that is exactly the case a reader must not miss.
 */

function shortReleaseLabel(release: Release): string {
  return release.name.replace(/^SQL Server\s+/i, '');
}

function editionSignature(row: ReleaseRow, order: EditionSlug[]): string {
  return order.map((edition) => row.editions[edition]).join('|');
}

function describeEditions(
  row: ReleaseRow,
  order: EditionSlug[],
  editionNames: Record<string, string>,
): string {
  const statuses = new Set(order.map((edition) => row.editions[edition]));
  if (statuses.size === 1) {
    const only = [...statuses][0] as SupportStatus;
    return statusLabel(only).toLowerCase();
  }

  const byStatus = new Map<SupportStatus, string[]>();
  for (const edition of order) {
    const status = row.editions[edition];
    const list = byStatus.get(status) ?? [];
    list.push(editionNames[edition] ?? edition);
    byStatus.set(status, list);
  }

  return [...byStatus.entries()]
    .map(([status, editions]) => `${statusLabel(status).toLowerCase()}: ${editions.join(', ')}`)
    .join('; ');
}

function onPremisesLines(
  indexed: IndexedDataset,
  feature: Feature,
): { lines: string[]; hasUnknown: boolean } {
  const order = indexed.raw.support_matrix.edition_order;
  const grid = releaseGrid(indexed, feature);
  const runs = groupRuns(grid, (row) => editionSignature(row, order));

  const lines = runs.map((run) => {
    const from = shortReleaseLabel(run.first.release);
    const to = shortReleaseLabel(run.last.release);
    const range = run.items.length === 1 ? from : `${from}-${to}`;
    return `  ${range}: ${describeEditions(run.first, order, indexed.editionNames)}`;
  });

  const hasUnknown = grid.some((row) => order.some((e) => row.editions[e] === 'unknown'));
  return { lines, hasUnknown };
}

export interface ComposedText {
  text: string;
  /** Human-readable gaps, surfaced separately so tools can flag them structurally. */
  dataGaps: string[];
}

export function composeFeatureText(indexed: IndexedDataset, feature: Feature): ComposedText {
  const parts: string[] = [];
  const dataGaps: string[] = [];

  const categoryLine = feature.category.parent_name
    ? `${feature.category.name} (${feature.category.parent_name})`
    : feature.category.name;
  parts.push(`${feature.name} — ${categoryLine}`);
  if (feature.summary) parts.push(feature.summary);
  parts.push('');

  const introduced = introducedIn(indexed, feature);
  parts.push(
    introduced
      ? `Introduced: ${introduced.release.name}.${introduced.summary ? ` ${introduced.summary}` : ''}`
      : 'Introduced: not recorded in SQL.FM.',
  );
  if (!introduced) dataGaps.push('Introduction release is not recorded in SQL.FM.');

  const onPrem = onPremisesLines(indexed, feature);
  parts.push('SQL Server:');
  parts.push(...onPrem.lines);
  if (onPrem.hasUnknown) {
    dataGaps.push('SQL.FM has not recorded support for some SQL Server releases or editions.');
  }

  const cloudEnvironments = indexed.environments.all.filter((env) => env.kind === 'azure');
  if (cloudEnvironments.length > 0) {
    parts.push('Azure:');
    for (const environment of cloudEnvironments) {
      const resolved = statusFor(indexed, feature, environment);
      const qualifier =
        resolved.conditions.length > 0 ? ` — ${resolved.conditions.join(' ')}` : '';
      const note = resolved.notes.length > 0 ? ` (${resolved.notes.join(' ')})` : '';
      parts.push(
        `  ${environment.label}: ${statusLabel(resolved.status).toLowerCase()}${qualifier}${note}`,
      );
      if (resolved.status === 'unknown') {
        dataGaps.push(`SQL.FM has not recorded support for ${environment.label}.`);
      }
    }
  }

  // Reserved fields are reported as gaps, never invented. `compatibility_level`
  // is null for every record in the current upstream data (architecture.md §3.2).
  if (feature.requirements.compatibility_level) {
    parts.push(`Compatibility level: ${feature.requirements.compatibility_level}.`);
  } else {
    parts.push('Compatibility level: not recorded in SQL.FM.');
    dataGaps.push('Compatibility-level requirements are not recorded in SQL.FM.');
  }
  if (feature.requirements.platform) {
    parts.push(`Platform: ${feature.requirements.platform}.`);
  }

  const generalConditions = feature.conditions.filter((c) => c.environment === null);
  if (generalConditions.length > 0) {
    parts.push('');
    parts.push('Conditions:');
    for (const condition of generalConditions) parts.push(`  - ${condition.note}`);
  }

  parts.push('');
  parts.push(`Source: ${feature.url}`);
  if (feature.microsoft_docs.length > 0) {
    parts.push(`Microsoft documentation: ${feature.microsoft_docs.join(' ')}`);
  }
  parts.push(indexed.raw.source.attribution);
  parts.push(indexed.raw.source.disclaimer);

  return { text: parts.join('\n'), dataGaps: [...new Set(dataGaps)] };
}
