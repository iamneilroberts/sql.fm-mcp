import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { connectClient } from '../mcp-harness.js';

/**
 * Tool discovery and client-compatibility conformance.
 *
 * These are the assertions that catch a break in ChatGPT / Claude / Codex
 * compatibility before a client does. Real client behaviour cannot be fully
 * asserted in CI, so docs/clients.md carries the manual matrix too.
 */

let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ client, close } = await connectClient());
});
afterAll(async () => {
  await close();
});

interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
  outputSchema?: { type: string; properties?: Record<string, unknown> };
  annotations?: Record<string, unknown>;
}

async function tools(): Promise<ToolInfo[]> {
  const result = (await client.listTools()) as { tools: ToolInfo[] };
  return result.tools;
}

describe('tools/list', () => {
  it('exposes exactly the three designed tools, in a deterministic order', async () => {
    const names = (await tools()).map((t) => t.name);
    expect(names).toEqual(['search', 'fetch', 'compare_feature_support']);

    const again = (await tools()).map((t) => t.name);
    expect(again).toEqual(names);
  });

  it('gives every tool a title, an action-oriented description, and a short name', async () => {
    for (const tool of await tools()) {
      expect(tool.title, `${tool.name} needs a title`).toBeTruthy();
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.name.length).toBeLessThanOrEqual(64);
      // Claude connector-directory guidance: descriptions must say when to call.
      expect(tool.description!.toLowerCase()).toMatch(/use (this|these)|call this/);
    }
  });

  it('marks every tool read-only, non-destructive, idempotent, and closed-world', async () => {
    for (const tool of await tools()) {
      expect(tool.annotations, `${tool.name} needs annotations`).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('publishes an explicit input and output schema for every tool', async () => {
    for (const tool of await tools()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema, `${tool.name} needs an outputSchema`).toBeDefined();
      expect(tool.outputSchema!.type).toBe('object');
    }
  });
});

describe('OpenAI deep-research contract', () => {
  it('search takes a single required query string', async () => {
    const search = (await tools()).find((t) => t.name === 'search')!;
    expect(search.inputSchema.required).toEqual(['query']);
    expect(search.inputSchema.properties!['query']).toMatchObject({ type: 'string' });
  });

  it('fetch takes a single required id string', async () => {
    const fetchTool = (await tools()).find((t) => t.name === 'fetch')!;
    expect(fetchTool.inputSchema.required).toEqual(['id']);
    expect(fetchTool.inputSchema.properties!['id']).toMatchObject({ type: 'string' });
  });

  it('search results carry id, title and url for citation', async () => {
    const search = (await tools()).find((t) => t.name === 'search')!;
    const results = search.outputSchema!.properties!['results'] as {
      items: { properties: Record<string, unknown> };
    };
    for (const field of ['id', 'title', 'url']) {
      expect(results.items.properties[field], `results[].${field}`).toBeDefined();
    }
  });

  it('fetch output carries id, title, text, url and metadata', async () => {
    const fetchTool = (await tools()).find((t) => t.name === 'fetch')!;
    for (const field of ['id', 'title', 'text', 'url', 'metadata']) {
      expect(fetchTool.outputSchema!.properties![field], `fetch.${field}`).toBeDefined();
    }
  });
});

describe('resources', () => {
  it('exposes discovery as resources rather than extra tools', async () => {
    const result = (await client.listResources()) as { resources: { uri: string }[] };
    const uris = result.resources.map((r) => r.uri).sort();
    expect(uris).toEqual(['sqlfm://categories', 'sqlfm://dataset/meta', 'sqlfm://environments']);
  });

  it('lists every environment id with its grammar parts', async () => {
    const result = (await client.readResource({ uri: 'sqlfm://environments' })) as {
      contents: { text: string }[];
    };
    const body = JSON.parse(result.contents[0]!.text) as {
      environments: { id: string; kind: string; covers_all_editions: boolean }[];
      count: number;
    };
    expect(body.count).toBe(8 * 5 + 2);
    expect(body.environments.map((e) => e.id)).toContain('mssql-2019-standard');
    expect(body.environments.map((e) => e.id)).toContain('azure-sql-mi');
  });

  it('reports dataset provenance and freshness', async () => {
    const result = (await client.readResource({ uri: 'sqlfm://dataset/meta' })) as {
      contents: { text: string }[];
    };
    const body = JSON.parse(result.contents[0]!.text) as {
      schema_version: string;
      content_hash: string;
      stale: boolean;
      source_kind: string;
    };
    expect(body.schema_version).toBe('1.0.0');
    expect(body.content_hash).toMatch(/^sha256:/);
    expect(body.stale).toBe(false);
    expect(body.source_kind).toBe('fixture');
  });

  it('reports category counts', async () => {
    const result = (await client.readResource({ uri: 'sqlfm://categories' })) as {
      contents: { text: string }[];
    };
    const body = JSON.parse(result.contents[0]!.text) as {
      categories: { name: string; feature_count: number }[];
    };
    const total = body.categories.reduce((sum, c) => sum + c.feature_count, 0);
    expect(total).toBe(12);
  });
});
