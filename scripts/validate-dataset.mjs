#!/usr/bin/env node
/**
 * Validates a dataset file against schemas/dataset.v1.schema.json plus the
 * cross-checks the schema cannot express (matrix row lengths, legend
 * coverage, release references, duplicate ids).
 *
 *   node scripts/validate-dataset.mjs [path]
 *
 * Defaults to the synthetic fixture. Point it at a generated
 * data/dataset.v1.json before deploying one.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '../fixtures/synthetic/dataset.v1.json');

const dataset = JSON.parse(readFileSync(target, 'utf8'));
const problems = [];

const major = Number.parseInt(String(dataset.schema_version).split('.')[0], 10);
if (major !== 1) problems.push(`schema_version ${dataset.schema_version} is not 1.x`);

const matrix = dataset.support_matrix ?? {};
const expected = (matrix.release_order?.length ?? 0) * (matrix.edition_order?.length ?? 0);
const releaseIds = new Set((dataset.releases ?? []).map((r) => r.id));

for (const id of matrix.release_order ?? []) {
  if (!releaseIds.has(id)) problems.push(`release_order names unknown release '${id}'`);
}

for (const [featureId, row] of Object.entries(matrix.rows ?? {})) {
  if (row.length !== expected) {
    problems.push(`row '${featureId}' has length ${row.length}, expected ${expected}`);
  }
  for (const code of row) {
    if (!(code in (matrix.legend ?? {}))) {
      problems.push(`row '${featureId}' uses code '${code}' which is not in the legend`);
    }
  }
}

const seen = new Set();
for (const feature of dataset.features ?? []) {
  if (seen.has(feature.id)) problems.push(`duplicate feature id '${feature.id}'`);
  seen.add(feature.id);
  if (!matrix.rows?.[feature.id]) problems.push(`feature '${feature.id}' has no matrix row`);
  for (const url of feature.microsoft_docs ?? []) {
    if (!url.startsWith('https://')) problems.push(`feature '${feature.id}' has a non-https doc URL`);
  }
}

for (const featureId of Object.keys(matrix.rows ?? {})) {
  if (!seen.has(featureId)) problems.push(`matrix row '${featureId}' has no feature record`);
}

if (problems.length > 0) {
  console.error(`dataset validation failed for ${target}:`);
  for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
  if (problems.length > 50) console.error(`  ... and ${problems.length - 50} more`);
  process.exit(1);
}

console.log(
  `dataset ok: ${target}\n  ${dataset.features.length} features, ` +
    `${matrix.release_order.length} releases x ${matrix.edition_order.length} editions, ` +
    `schema_version ${dataset.schema_version}, dataset_version ${dataset.dataset_version}`,
);
