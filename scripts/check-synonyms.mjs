#!/usr/bin/env node
/**
 * Verifies that every synonym in data/synonyms.json targets a feature that
 * actually exists in the bundled dataset.
 *
 * Run in CI so a renamed or removed slug fails the build rather than silently
 * degrading search recall.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => JSON.parse(readFileSync(resolve(here, path), 'utf8'));

const synonyms = read('../data/synonyms.json');
const dataset = read('../fixtures/synthetic/dataset.v1.json');
const known = new Set(dataset.features.map((f) => f.id));

const problems = [];
for (const [phrase, targets] of Object.entries(synonyms)) {
  if (!Array.isArray(targets) || targets.length === 0) {
    problems.push(`'${phrase}' has no targets`);
    continue;
  }
  for (const target of targets) {
    if (!known.has(target)) problems.push(`'${phrase}' targets missing feature '${target}'`);
  }
}

if (problems.length > 0) {
  console.error('synonym check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `synonyms ok: ${Object.keys(synonyms).length} phrases, all targets resolve against ${known.size} features`,
);
