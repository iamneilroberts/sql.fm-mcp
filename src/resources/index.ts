import type { McpServer } from '@modelcontextprotocol/server';
import type { DatasetProvider } from '../providers/types.js';

/**
 * Discovery is exposed as resources, not tools (architecture.md §8.4).
 *
 * Both would be pure, argument-free enumeration — the canonical case for a
 * resource. Adding them as tools would tax every client's `tools/list`
 * forever and add distractors at tool-selection time, for information already
 * reachable from the schema descriptions and from the `unknown_environment`
 * error payload.
 *
 * Resources are static per deploy, so the cache hints are generous.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const publicCache = { ttlMs: ONE_HOUR_MS, cacheScope: 'public' as const };

function jsonResource(uri: string, body: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(body, null, 2),
      },
    ],
  };
}

export function registerResources(server: McpServer, provider: DatasetProvider): void {
  server.registerResource(
    'environments',
    'sqlfm://environments',
    {
      title: 'SQL.FM environments',
      description:
        'Every environment that can be compared: each SQL Server release (as a whole and per edition), plus Azure SQL Database and Azure SQL Managed Instance. Use these ids with compare_feature_support.',
      mimeType: 'application/json',
      cacheHint: publicCache,
    },
    async (uri) => {
      const { dataset } = await provider.get();
      return jsonResource(uri.toString(), {
        environments: dataset.environments.all.map((environment) => ({
          id: environment.id,
          kind: environment.kind,
          label: environment.label,
          short_label: environment.shortLabel,
          release: environment.release?.id ?? null,
          edition: environment.edition,
          covers_all_editions: environment.aggregate,
          docs: environment.docs,
        })),
        count: dataset.environments.all.length,
      });
    },
  );

  server.registerResource(
    'categories',
    'sqlfm://categories',
    {
      title: 'SQL.FM categories',
      description:
        'The SQL.FM category tree with parents and per-category feature counts. Use a category name with the `category` filter on search.',
      mimeType: 'application/json',
      cacheHint: publicCache,
    },
    async (uri) => {
      const { dataset } = await provider.get();
      const counts = new Map<number, number>();
      for (const feature of dataset.raw.features) {
        counts.set(feature.category.id, (counts.get(feature.category.id) ?? 0) + 1);
      }
      return jsonResource(uri.toString(), {
        categories: [...dataset.raw.categories]
          .sort((a, b) => a.sort - b.sort)
          .map((category) => ({
            id: category.id,
            name: category.name,
            parent_id: category.parent_id,
            parent_name: category.parent_name,
            feature_count: counts.get(category.id) ?? 0,
          })),
      });
    },
  );

  server.registerResource(
    'dataset-meta',
    'sqlfm://dataset/meta',
    {
      title: 'SQL.FM dataset provenance',
      description:
        'Which SQL.FM dataset this server is serving: schema and dataset version, generation time, content hash, and whether the data is stale.',
      mimeType: 'application/json',
      // Freshness metadata: short TTL, and private so an intermediary cannot
      // serve one deployment's provenance for another's.
      cacheHint: { ttlMs: 60_000, cacheScope: 'private' },
    },
    async (uri) => {
      const { meta, dataset } = await provider.get();
      return jsonResource(uri.toString(), {
        ...meta,
        source: dataset.raw.source,
      });
    },
  );
}
