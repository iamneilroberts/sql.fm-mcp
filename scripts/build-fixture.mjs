#!/usr/bin/env node
/**
 * Generates fixtures/synthetic/dataset.v1.json.
 *
 * THE FEATURES HERE ARE INVENTED. No SQL.FM content appears in this file or
 * in its output. What is real is the SHAPE: the same status vocabulary, the
 * same environment grammar, the same compact matrix encoding, and the same
 * sparse-data patterns observed upstream. That is what makes fixture-backed
 * acceptance tests meaningful evidence about production behaviour without
 * embedding anyone else's data.
 *
 * Release identifiers and years are public facts about Microsoft's product,
 * not SQL.FM's curation, and the environment grammar is defined in terms of
 * them — so they are used as-is.
 *
 * Generated rather than hand-written so every matrix row is provably the
 * right length and every code is in the legend.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../fixtures/synthetic/dataset.v1.json');

const RELEASES = [
  { id: 'mssql-2000', name: 'SQL Server 2000', major: '8.0', year: 2000, sort: 10 },
  { id: 'mssql-2005', name: 'SQL Server 2005', major: '9.0', year: 2005, sort: 20 },
  { id: 'mssql-2012', name: 'SQL Server 2012', major: '11.0', year: 2012, sort: 30 },
  { id: 'mssql-2016', name: 'SQL Server 2016', major: '13.0', year: 2016, sort: 40 },
  { id: 'mssql-2017', name: 'SQL Server 2017', major: '14.0', year: 2017, sort: 50 },
  { id: 'mssql-2019', name: 'SQL Server 2019', major: '15.0', year: 2019, sort: 60 },
  { id: 'mssql-2022', name: 'SQL Server 2022', major: '16.0', year: 2022, sort: 70 },
  { id: 'mssql-2025', name: 'SQL Server 2025', major: '17.0', year: 2025, sort: 80 },
];

const EDITIONS = [
  { id: 'standard', name: 'Standard', sort: 10 },
  { id: 'enterprise', name: 'Enterprise', sort: 20 },
  { id: 'developer', name: 'Developer', sort: 30 },
  { id: 'express', name: 'Express', sort: 40 },
];

const CLOUD_TARGETS = [
  {
    id: 'azure-sql-db',
    name: 'Azure SQL Database',
    short: 'Azure SQL DB',
    docs: 'https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview',
    sort: 10,
  },
  {
    id: 'azure-sql-mi',
    name: 'Azure SQL Managed Instance',
    short: 'Azure SQL MI',
    docs: 'https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/sql-managed-instance-paas-overview',
    sort: 20,
  },
];

const CATEGORIES = [
  { id: 1, name: 'Functions', parent_id: null, parent_name: null, sort: 10 },
  { id: 2, name: 'Aggregate Functions', parent_id: 1, parent_name: 'Functions', sort: 11 },
  { id: 3, name: 'String Functions', parent_id: 1, parent_name: 'Functions', sort: 12 },
  { id: 4, name: 'Indexing & Storage', parent_id: null, parent_name: null, sort: 20 },
  { id: 5, name: 'Indexing', parent_id: 4, parent_name: 'Indexing & Storage', sort: 21 },
  { id: 6, name: 'Storage Engine', parent_id: 4, parent_name: 'Indexing & Storage', sort: 22 },
  { id: 7, name: 'High Availability & DR', parent_id: null, parent_name: null, sort: 30 },
  { id: 8, name: 'Security', parent_id: null, parent_name: null, sort: 40 },
  { id: 9, name: 'Performance', parent_id: null, parent_name: null, sort: 50 },
  { id: 10, name: 'Data Management', parent_id: null, parent_name: null, sort: 60 },
];

const LEGEND = { a: 'available', u: 'unavailable', n: 'not_applicable', '?': 'unknown', p: 'preview' };

const DOCS = 'https://learn.microsoft.com/en-us/sql/';

/**
 * Per-release edition codes, written as [standard, enterprise, developer, express].
 * `n` marks an edition that did not exist in that release.
 */
const A = 'aaaa'; // all editions available
const U = 'uuuu'; // all editions unavailable
const U0 = 'uuun'; // SQL Server 2000: Express did not exist yet
const ENT = 'uaau'; // Enterprise + Developer only
const UNK = '????'; // not yet verified
const PRE = 'pppp'; // preview

const FEATURES = [
  {
    id: 'widget-agg',
    name: 'WIDGET_AGG',
    type: 'function',
    category: 2,
    summary: 'Aggregates widget values across rows with a configurable separator.',
    rows: [U0, U, U, U, A, A, A, A],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2017',
    introducedSummary: 'WIDGET_AGG introduced.',
  },
  {
    id: 'glyph-parse',
    name: 'GLYPH_PARSE',
    type: 'function',
    category: 3,
    summary: 'Parses glyph sequences into their component parts.',
    rows: [U0, U, U, U, U, U, A, A],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2022',
    introducedSummary: 'GLYPH_PARSE introduced.',
  },
  {
    id: 'sparkle-compression',
    name: 'Sparkle Compression',
    type: 'Indexing feature',
    category: 5,
    summary: 'Compresses sparkle indexes while concurrent access continues.',
    // The edition-restriction case: Enterprise and Developer only, from 2016.
    rows: [U0, U, U, ENT, ENT, ENT, ENT, ENT],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2016',
    introducedSummary: 'Sparkle Compression introduced in Enterprise edition.',
    aliases: ['Sparkle', 'SC'],
  },
  {
    id: 'flux-capacitor-index',
    name: 'Flux Capacitor Index',
    type: 'Indexing feature',
    category: 5,
    summary: 'Maintains a time-ordered auxiliary index for flux lookups.',
    rows: [U0, U, U, U, A, A, A, A],
    // The Azure-divergence + conditional case.
    cloud: {
      'azure-sql-db': ['available', null],
      'azure-sql-mi': [
        'conditional',
        'Supported, but index maintenance windows cannot be configured on Managed Instance.',
      ],
    },
    introduced: 'mssql-2017',
  },
  {
    id: 'quantum-replication',
    name: 'Quantum Replication',
    type: 'HA/DR feature',
    category: 7,
    summary: 'Replicates quantum-partitioned data between replicas.',
    // The unknown-data case: 2025 is not yet verified.
    rows: [U0, U, U, U, U, A, A, UNK],
    cloud: { 'azure-sql-db': ['unavailable', 'Not offered on Azure SQL Database.'] },
    introduced: 'mssql-2019',
  },
  {
    id: 'nimbus-cache',
    name: 'Nimbus Cache',
    type: 'Performance feature',
    category: 9,
    summary: 'Caches nimbus query fragments in memory across sessions.',
    // The preview case.
    rows: [U0, U, U, U, U, U, U, PRE],
    cloud: { 'azure-sql-db': ['preview', 'Available in preview.'], 'azure-sql-mi': ['unavailable', null] },
  },
  {
    id: 'orbit-sync',
    name: 'Orbit Sync',
    type: 'Data management feature',
    category: 10,
    summary: 'Synchronizes orbit metadata between primary and secondary nodes.',
    rows: [U0, U, A, A, A, A, A, A],
    cloud: { 'azure-sql-db': ['unavailable', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2012',
    aliases: ['OS', 'OrbitSync'],
  },
  {
    id: 'zephyr-audit',
    name: 'Zephyr Audit',
    type: 'Security feature',
    category: 8,
    summary: 'Records zephyr-level access events to an audit target.',
    rows: [U0, A, A, A, A, A, A, A],
    cloud: {
      'azure-sql-db': ['conditional', 'Audit targets are limited to blob storage on Azure SQL Database.'],
      'azure-sql-mi': ['available', null],
    },
    introduced: 'mssql-2005',
    conditions: [
      {
        environment: null,
        edition: null,
        note: 'Audit target configuration requires membership in the server audit role.',
        source: `${DOCS}security/auditing`,
      },
    ],
  },
  {
    id: 'prism-encrypt',
    name: 'Prism Encryption',
    type: 'Security feature',
    category: 8,
    summary: 'Encrypts prism data at rest using a database encryption key.',
    rows: [U0, U, ENT, ENT, A, A, A, A],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2012',
    introducedSummary: 'Prism Encryption introduced in Enterprise edition.',
    aliases: ['PE'],
    timelineExtra: [
      {
        event: 'edition_changed',
        environment: 'mssql-2017',
        edition: 'standard',
        summary: 'Prism Encryption becomes available in Standard edition.',
        source: null,
      },
    ],
  },
  {
    id: 'lumen-stats',
    name: 'LUMEN_STATS',
    type: 'Diagnostic feature',
    category: 9,
    summary: 'Exposes lumen distribution statistics for the current database.',
    rows: [U0, U, U, A, A, A, A, A],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2016',
  },
  {
    id: 'tessellate-partition',
    name: 'Tessellate Partitioning',
    type: 'Storage feature',
    category: 6,
    summary: 'Partitions tessellated tables across filegroups.',
    rows: [U0, ENT, ENT, ENT, ENT, A, A, A],
    cloud: { 'azure-sql-db': ['available', null], 'azure-sql-mi': ['available', null] },
    introduced: 'mssql-2005',
  },
  {
    id: 'beacon-restore',
    name: 'Beacon Restore',
    type: 'Data management feature',
    category: 10,
    summary: 'Restores a database to a beacon point without full recovery.',
    rows: [U0, U, U, U, U, A, A, A],
    cloud: {
      'azure-sql-db': ['unavailable', 'Point-in-time restore is managed by the service instead.'],
      'azure-sql-mi': ['unavailable', 'Point-in-time restore is managed by the service instead.'],
    },
    introduced: 'mssql-2019',
  },
];

function buildFeature(spec) {
  const category = CATEGORIES.find((c) => c.id === spec.category);
  const timeline = [];
  if (spec.introduced) {
    timeline.push({
      event: 'introduced',
      environment: spec.introduced,
      edition: null,
      summary: spec.introducedSummary ?? `${spec.name} introduced.`,
      source: null,
    });
  }
  timeline.push(...(spec.timelineExtra ?? []));

  const cloudSupport = {};
  for (const target of CLOUD_TARGETS) {
    const entry = spec.cloud?.[target.id];
    // A target with no entry is left absent on purpose: absence must resolve
    // to `unknown`, never to `unavailable`.
    if (!entry) continue;
    const [status, note] = entry;
    cloudSupport[target.id] = {
      status,
      note,
      sources: [`${DOCS}azure/features-comparison`],
    };
  }

  return {
    id: spec.id,
    upstream_id: null,
    name: spec.name,
    slug: spec.id,
    url: `https://sql.fm/features/${spec.id}/`,
    type: spec.type,
    category: { id: category.id, name: category.name, parent_name: category.parent_name },
    summary: spec.summary,
    aliases: spec.aliases ?? [],
    microsoft_docs: [`${DOCS}${spec.id}`],
    cloud_support: cloudSupport,
    timeline,
    conditions: spec.conditions ?? [],
    requirements: { compatibility_level: null, platform: null, other: [] },
    attributes: [],
  };
}

const rows = {};
for (const spec of FEATURES) {
  if (spec.rows.length !== RELEASES.length) {
    throw new Error(`${spec.id}: expected ${RELEASES.length} release groups, got ${spec.rows.length}`);
  }
  const row = spec.rows.join('');
  const expected = RELEASES.length * EDITIONS.length;
  if (row.length !== expected) {
    throw new Error(`${spec.id}: row length ${row.length}, expected ${expected}`);
  }
  for (const code of row) {
    if (!(code in LEGEND)) throw new Error(`${spec.id}: code '${code}' is not in the legend`);
  }
  rows[spec.id] = row;
}

const dataset = {
  schema_version: '1.0.0',
  dataset_version: 'synthetic-fixture-1',
  generated_at: '2026-09-02T00:00:00Z',
  source: {
    name: 'SQL.FM',
    url: 'https://sql.fm/',
    feature_url_template: 'https://sql.fm/features/{slug}/',
    attribution:
      'SYNTHETIC TEST DATA — not SQL.FM content. In production this field reads: Data from SQL.FM (https://sql.fm/), created and maintained by Mike Scalise.',
    disclaimer:
      'SYNTHETIC TEST DATA. These features are invented and describe no real product. Not affiliated with SQL.FM or Microsoft.',
  },
  releases: RELEASES,
  editions: EDITIONS,
  cloud_targets: CLOUD_TARGETS,
  categories: CATEGORIES,
  support_matrix: {
    encoding: 'compact-v1',
    legend: LEGEND,
    release_order: RELEASES.map((r) => r.id),
    edition_order: EDITIONS.map((e) => e.id),
    rows,
  },
  features: FEATURES.map(buildFeature),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(
  `wrote ${outputPath}: ${dataset.features.length} features, ` +
    `${RELEASES.length} releases x ${EDITIONS.length} editions + ${CLOUD_TARGETS.length} cloud targets`,
);
