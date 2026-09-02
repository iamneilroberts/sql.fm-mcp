/**
 * The `dataset.v1` contract. See docs/data-schema.md.
 *
 * These types describe the normalized dataset the MCP server reads. They are
 * deliberately close to SQL.FM's own export shape so that a first-party
 * generator (scripts/build-dataset.mjs) is a serialize step rather than a
 * transformation project.
 */

/**
 * The closed support vocabulary.
 *
 * `unknown` and `not_applicable` are ABSENCE OF DATA and a statement about
 * history respectively. Neither is a negative. Nothing in this codebase may
 * render, aggregate, or default them to `unavailable` — see
 * {@link ../../docs/architecture.md} §7.1. There is deliberately no boolean
 * `supported` field anywhere, so there is nothing to accidentally coerce to.
 */
export const SUPPORT_STATUSES = [
  'available',
  'unavailable',
  'conditional',
  'preview',
  'not_applicable',
  'unknown',
] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Edition slugs, in display order. */
export const EDITIONS = ['standard', 'enterprise', 'developer', 'express'] as const;
export type EditionSlug = (typeof EDITIONS)[number];

export interface DatasetSource {
  name: string;
  url: string;
  /** e.g. "https://sql.fm/features/{slug}/" */
  feature_url_template: string;
  attribution: string;
  disclaimer: string;
}

export interface Release {
  /** Canonical environment id for the release as a whole, e.g. "mssql-2019". */
  id: string;
  name: string;
  /** Internal version, e.g. "15.0". */
  major: string;
  year: number;
  sort: number;
}

export interface Edition {
  id: EditionSlug;
  name: string;
  sort: number;
}

export interface CloudTarget {
  /** Canonical environment id, e.g. "azure-sql-db". */
  id: string;
  name: string;
  short: string;
  docs: string | null;
  sort: number;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  sort: number;
}

/**
 * The on-premises matrix, kept in SQL.FM's compact encoding.
 *
 * Each row is `releases.length * editions.length` characters, ordered by
 * release (ascending `sort`) then edition (ascending `sort`). Held compact on
 * disk for size; always expanded before it reaches a tool result.
 */
export interface SupportMatrix {
  encoding: 'compact-v1';
  /** Single-character code -> status. Explicit in-band so the file is self-describing. */
  legend: Record<string, SupportStatus>;
  /** Release environment ids, in matrix order. */
  release_order: string[];
  /** Edition slugs, in matrix order. */
  edition_order: EditionSlug[];
  /** Keyed by feature id (slug). */
  rows: Record<string, string>;
}

export interface CloudSupportCell {
  status: SupportStatus;
  note: string | null;
  sources: string[];
}

export interface TimelineEvent {
  /** e.g. "introduced", "edition_changed", "first_verified". */
  event: string;
  /** Release environment id, e.g. "mssql-2017". */
  environment: string;
  edition: EditionSlug | null;
  summary: string;
  source: string | null;
}

export interface FeatureCondition {
  /** Release or cloud environment id; null means it applies everywhere. */
  environment: string | null;
  edition: EditionSlug | null;
  note: string;
  source: string | null;
}

/**
 * Reserved requirement fields.
 *
 * `compatibility_level` is `null` for every record in the current upstream
 * data — the concept is not recorded there (architecture.md §3.2, Q4). It is
 * modelled so that it can be populated without a schema change, and reported
 * as "not recorded" rather than invented.
 */
export interface FeatureRequirements {
  compatibility_level: string | null;
  platform: string | null;
  other: string[];
}

export interface FeatureCategoryRef {
  id: number;
  name: string;
  parent_name: string | null;
}

export interface Feature {
  /** The slug. Stable public id; also the canonical URL segment. */
  id: string;
  /** Upstream numeric id, retained for traceability and bug reports. */
  upstream_id: number | null;
  name: string;
  slug: string;
  /** Canonical SQL.FM URL. Used for citation. */
  url: string;
  type: string;
  category: FeatureCategoryRef;
  summary: string;
  aliases: string[];
  microsoft_docs: string[];
  /** Keyed by cloud environment id. */
  cloud_support: Record<string, CloudSupportCell>;
  timeline: TimelineEvent[];
  conditions: FeatureCondition[];
  requirements: FeatureRequirements;
  /** Opaque upstream passthrough; not interpreted. */
  attributes: unknown[];
}

export interface Dataset {
  /** Semver of the dataset contract. The server accepts 1.x only. */
  schema_version: string;
  /** Opaque upstream build id. */
  dataset_version: string;
  generated_at: string | null;
  source: DatasetSource;
  releases: Release[];
  editions: Edition[];
  cloud_targets: CloudTarget[];
  categories: Category[];
  support_matrix: SupportMatrix;
  features: Feature[];
}

export interface DatasetMeta {
  schema_version: string;
  dataset_version: string;
  generated_at: string | null;
  /** Hash of the canonical dataset bytes. Always computable, even when upstream omits a version. */
  content_hash: string;
  source_kind: 'fixture' | 'local' | 'http';
  fetched_at: string;
  /** True when serving last-known-good after a failed refresh. */
  stale: boolean;
  feature_count: number;
  environment_count: number;
}
