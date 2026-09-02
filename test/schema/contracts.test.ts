import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { connectClient } from '../mcp-harness.js';

/**
 * Contract stability.
 *
 * The published dataset schema and the three tool schemas are snapshotted, so
 * changing a client-visible contract is a reviewable diff rather than a
 * silent break for anyone already connected.
 */

let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ client, close } = await connectClient());
});
afterAll(async () => {
  await close();
});

describe('dataset schema', () => {
  it('the committed JSON Schema is up to date with the Zod source of truth', () => {
    const committed = readFileSync('schemas/dataset.v1.schema.json', 'utf8');
    execFileSync('npx', ['tsx', 'scripts/build-schemas.ts'], { stdio: 'pipe' });
    const regenerated = readFileSync('schemas/dataset.v1.schema.json', 'utf8');
    expect(regenerated).toBe(committed);
  });

  it('declares the closed support vocabulary', () => {
    const schema = JSON.parse(readFileSync('schemas/dataset.v1.schema.json', 'utf8')) as Record<
      string,
      unknown
    >;
    const serialized = JSON.stringify(schema);
    for (const status of [
      'available',
      'unavailable',
      'conditional',
      'preview',
      'not_applicable',
      'unknown',
    ]) {
      expect(serialized).toContain(`"${status}"`);
    }
    // There must be no boolean "supported" anywhere: nothing to coerce to.
    expect(serialized).not.toContain('"supported"');
  });
});

describe('tool schemas', () => {
  it('match the committed snapshot', async () => {
    const { tools } = (await client.listTools()) as {
      tools: { name: string; inputSchema: unknown; outputSchema: unknown }[];
    };
    const contract = Object.fromEntries(
      tools.map((tool) => [tool.name, { input: tool.inputSchema, output: tool.outputSchema }]),
    );
    expect(contract).toMatchSnapshot();
  });

  it('bounds every user-controllable dimension', async () => {
    const { tools } = (await client.listTools()) as {
      tools: { name: string; inputSchema: { properties: Record<string, Record<string, unknown>> } }[];
    };
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema.properties]));

    expect(byName['search']!['query']!['maxLength']).toBe(200);
    expect(byName['search']!['limit']!['maximum']).toBe(50);
    expect(byName['fetch']!['id']!['maxLength']).toBe(64);
    expect(byName['compare_feature_support']!['environments']!['maxItems']).toBe(32);
    expect(byName['compare_feature_support']!['id']!['maxLength']).toBe(64);
  });
});
