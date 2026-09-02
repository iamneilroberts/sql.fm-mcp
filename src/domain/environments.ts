import { EDITIONS, type Dataset, type EditionSlug } from './types.js';

/**
 * A resolved environment: one addressable column of the feature matrix.
 *
 * The registry is DERIVED from the dataset's `releases`, `editions`, and
 * `cloud_targets` rather than stored. Storing it would let the environment
 * list and `support_matrix.release_order` drift apart; deriving makes that
 * class of bug unrepresentable. (Deliberate deviation from architecture.md
 * §7.3, which sketched a stored `environments[]`. Same ids, same output.)
 */
export interface EnvironmentRef {
  id: string;
  kind: 'sqlserver' | 'azure';
  label: string;
  shortLabel: string | null;
  release: { id: string; name: string; major: string; year: number } | null;
  edition: EditionSlug | null;
  docs: string | null;
  sort: number;
  /** True when the id covers every edition of a release (e.g. "mssql-2019"). */
  aggregate: boolean;
}

export interface EnvironmentRegistry {
  /** All environments, ascending `sort`. */
  all: EnvironmentRef[];
  byId: Map<string, EnvironmentRef>;
  /** Normalized alias -> canonical id. */
  aliases: Map<string, string>;
}

/**
 * Normalization for environment lookup. Deliberately aggressive: models and
 * users phrase these many ways ("SQL Server 2019 Standard", "2019 std",
 * "mssql_2019_standard") and all should land on one id.
 */
function normalizeEnvKey(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Second, whitespace-free form, so "azuresqldb" matches "azure sql db". */
function collapse(input: string): string {
  return normalizeEnvKey(input).replace(/ /g, '');
}

const EDITION_ALIASES: Record<EditionSlug, string[]> = {
  standard: ['standard', 'std'],
  enterprise: ['enterprise', 'ent'],
  developer: ['developer', 'dev'],
  express: ['express', 'exp'],
};

const CLOUD_ALIASES: Record<string, string[]> = {
  'azure-sql-db': [
    'azure sql database',
    'azure sql db',
    'azure sql',
    'sql database',
    'sqldb',
    'azuresql',
    'sql azure',
  ],
  'azure-sql-mi': [
    'azure sql managed instance',
    'azure sql mi',
    'managed instance',
    'sql managed instance',
    'sql mi',
    'mi',
  ],
};

function addAlias(map: Map<string, string>, alias: string, id: string): void {
  const key = normalizeEnvKey(alias);
  if (key && !map.has(key)) map.set(key, id);
  const collapsed = collapse(alias);
  if (collapsed && !map.has(collapsed)) map.set(collapsed, id);
}

/**
 * Build the environment registry for a dataset.
 *
 * Yields `releases * (editions + 1) + cloud_targets` entries: one aggregate id
 * per release, one per release/edition pair, and one per cloud target.
 */
export function buildEnvironmentRegistry(dataset: Dataset): EnvironmentRegistry {
  const all: EnvironmentRef[] = [];
  const aliases = new Map<string, string>();

  const releases = [...dataset.releases].sort((a, b) => a.sort - b.sort);
  const editions = [...dataset.editions].sort((a, b) => a.sort - b.sort);

  for (const release of releases) {
    const releaseRef = {
      id: release.id,
      name: release.name,
      major: release.major,
      year: release.year,
    };

    all.push({
      id: release.id,
      kind: 'sqlserver',
      label: release.name,
      shortLabel: null,
      release: releaseRef,
      edition: null,
      docs: null,
      sort: release.sort * 1000,
      aggregate: true,
    });

    addAlias(aliases, release.id, release.id);
    addAlias(aliases, release.name, release.id);
    addAlias(aliases, release.name.replace(/^SQL Server /i, ''), release.id);
    addAlias(aliases, release.major, release.id);
    addAlias(aliases, `sqlserver ${release.year}`, release.id);

    for (const [index, edition] of editions.entries()) {
      const id = `${release.id}-${edition.id}`;
      all.push({
        id,
        kind: 'sqlserver',
        label: `${release.name} ${edition.name}`,
        shortLabel: null,
        release: releaseRef,
        edition: edition.id,
        docs: null,
        sort: release.sort * 1000 + (index + 1) * 10,
        aggregate: false,
      });

      addAlias(aliases, id, id);
      addAlias(aliases, `${release.name} ${edition.name}`, id);
      const bare = release.name.replace(/^SQL Server /i, '');
      for (const editionAlias of EDITION_ALIASES[edition.id]) {
        addAlias(aliases, `${release.name} ${editionAlias}`, id);
        addAlias(aliases, `${bare} ${editionAlias}`, id);
        addAlias(aliases, `${release.id} ${editionAlias}`, id);
      }
    }
  }

  const cloudTargets = [...dataset.cloud_targets].sort((a, b) => a.sort - b.sort);
  for (const target of cloudTargets) {
    all.push({
      id: target.id,
      kind: 'azure',
      label: target.name,
      shortLabel: target.short,
      release: null,
      edition: null,
      docs: target.docs,
      sort: 900_000 + target.sort,
      aggregate: false,
    });

    addAlias(aliases, target.id, target.id);
    addAlias(aliases, target.name, target.id);
    addAlias(aliases, target.short, target.id);
    for (const alias of CLOUD_ALIASES[target.id] ?? []) addAlias(aliases, alias, target.id);
  }

  all.sort((a, b) => a.sort - b.sort);
  const byId = new Map(all.map((env) => [env.id, env]));
  return { all, byId, aliases };
}

/**
 * Resolve a caller-supplied environment string to a canonical environment.
 * Returns null when unresolvable — callers must surface that as a structured
 * `unknown_environment` error, never as a dropped row.
 */
export function resolveEnvironment(
  registry: EnvironmentRegistry,
  input: string,
): EnvironmentRef | null {
  const direct = registry.byId.get(input);
  if (direct) return direct;

  const key = normalizeEnvKey(input);
  const viaAlias = registry.aliases.get(key) ?? registry.aliases.get(collapse(input));
  return viaAlias ? (registry.byId.get(viaAlias) ?? null) : null;
}

/**
 * The environment id grammar, stated once for tool descriptions and errors.
 */
export const ENVIRONMENT_GRAMMAR =
  'Grammar: "mssql-<year>" for a whole release (all editions), ' +
  '"mssql-<year>-<edition>" where edition is standard|enterprise|developer|express, ' +
  '"azure-sql-db" for Azure SQL Database, "azure-sql-mi" for Azure SQL Managed Instance. ' +
  'Examples: "mssql-2019", "mssql-2019-standard", "azure-sql-db".';

/** Cheap syntactic gate applied before registry lookup. */
export const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9 ._-]{0,59}$/i;

export { EDITIONS };
