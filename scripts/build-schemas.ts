#!/usr/bin/env tsx
/**
 * Generates schemas/dataset.v1.schema.json from the Zod schema.
 *
 * The Zod schema is the single source of truth: it validates at runtime AND
 * produces the published JSON Schema, so the two cannot drift. Regenerate
 * with `npm run build:schemas`; CI fails if the committed file is stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { datasetSchema } from '../src/providers/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../schemas/dataset.v1.schema.json');

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://sql.fm/schemas/dataset.v1.schema.json',
  title: 'SQL.FM MCP dataset (dataset.v1)',
  description:
    'The normalized dataset consumed by the SQL.FM MCP server. See docs/data-schema.md. ' +
    'Note the closed support vocabulary: "unknown" and "not_applicable" are absence of data ' +
    'and a statement about history respectively, and must never be rendered as "unavailable".',
  ...z.toJSONSchema(datasetSchema, { target: 'draft-2020-12' }),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${outputPath}`);
