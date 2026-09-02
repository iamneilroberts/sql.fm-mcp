import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { compareFeature, resolveRequestedEnvironments } from '../domain/compare.js';
import { ENVIRONMENT_GRAMMAR } from '../domain/environments.js';
import { suggest } from '../search/index.js';
import type { DatasetProvider } from '../providers/types.js';
import { featureNotFound, invalidInput, unknownEnvironment } from '../util/errors.js';
import { isValidFeatureId, LIMITS } from '../util/limits.js';
import type { Logger } from '../util/log.js';
import { attributionFields, guarded, READ_ONLY_ANNOTATIONS, statusEnum, toolResult } from './shared.js';

const inputSchema = z.object({
  id: z
    .string()
    .max(LIMITS.ID_MAX_LENGTH)
    .describe('Feature id (slug) from a search result, e.g. "string-agg".'),
  environments: z
    .array(z.string().max(LIMITS.ENVIRONMENT_MAX_LENGTH))
    .min(1)
    .max(LIMITS.ENVIRONMENTS_MAX)
    .describe(
      `Environments to compare, in the order you want them reported. ${ENVIRONMENT_GRAMMAR} ` +
        'Example: ["mssql-2016","mssql-2019-standard","mssql-2019-enterprise","azure-sql-db"].',
    ),
  include_unchanged: z
    .boolean()
    .default(true)
    .describe(
      'When false, collapse consecutive environments with identical status into ranges, keeping only transitions. Useful for "when did this change".',
    ),
});

const outputSchema = z.object({
  feature: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    category: z.string(),
    summary: z.string(),
  }),
  rows: z.array(
    z.object({
      environment: z.string(),
      label: z.string(),
      status: statusEnum,
      status_label: z.string(),
      conditions: z.array(z.string()),
      notes: z.array(z.string()),
      sources: z.array(z.string()),
      collapsed_range: z
        .object({ from: z.string(), to: z.string(), count: z.number().int() })
        .nullable(),
    }),
  ),
  summary: z.string(),
  differences: z.array(
    z.object({
      from_environment: z.string(),
      to_environment: z.string(),
      from_status: statusEnum,
      to_status: statusEnum,
    }),
  ),
  unknown_environments: z
    .array(z.string())
    .describe('Environments where SQL.FM records no data. This is missing data, NOT "unsupported".'),
  warnings: z.array(z.string()),
  url: z.string().describe('Canonical SQL.FM URL. Use this to cite the comparison.'),
  microsoft_docs: z.array(z.string()),
  ...attributionFields,
});

const DESCRIPTION =
  'Compare support for one SQL.FM feature across specific SQL Server versions, editions, and Azure ' +
  'SQL environments. Use this for direct comparison questions — "does SQL Server 2019 Standard have X", ' +
  '"compare X across 2016, 2019, 2022 and Azure SQL", "which editions support X". Returns one row per ' +
  'requested environment with status, conditions, and citations, and explicitly flags any environment ' +
  'where SQL.FM has no recorded data. Get the feature id from `search` first.';

export function registerCompareTool(
  server: McpServer,
  provider: DatasetProvider,
  logger: Logger,
): void {
  server.registerTool(
    'compare_feature_support',
    {
      title: 'Compare SQL.FM feature support',
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    guarded(async (args: z.infer<typeof inputSchema>) => {
      const started = Date.now();

      if (!isValidFeatureId(args.id)) {
        throw invalidInput('id', `'${args.id}' is not a valid feature id.`);
      }

      const { dataset, searchIndex } = await provider.get();
      const feature = dataset.featureById.get(args.id);
      if (!feature) {
        throw featureNotFound(args.id, suggest(searchIndex, args.id, LIMITS.SUGGESTION_COUNT));
      }

      const resolution = resolveRequestedEnvironments(dataset, args.environments);
      if ('unresolved' in resolution) {
        // Never silently drop a row: a dropped row reads as "not applicable"
        // and produces a confident wrong answer.
        throw unknownEnvironment(
          resolution.unresolved,
          dataset.environments.all.map((e) => e.id),
        );
      }

      const comparison = compareFeature(
        dataset,
        feature,
        resolution.environments,
        args.include_unchanged,
      );

      logger.tool({
        tool: 'compare_feature_support',
        ok: true,
        latency_ms: Date.now() - started,
        result_count: comparison.rows.length,
        error_code: null,
        dataset_version: dataset.raw.dataset_version,
      });

      return toolResult({
        feature: {
          id: feature.id,
          title: feature.name,
          url: feature.url,
          category: feature.category.name,
          summary: feature.summary,
        },
        rows: comparison.rows.map((row) => ({
          environment: row.environment,
          label: row.label,
          status: row.status,
          status_label: row.statusLabel,
          conditions: row.conditions,
          notes: row.notes,
          sources: row.sources,
          collapsed_range: row.collapsedRange ?? null,
        })),
        summary: comparison.summary,
        differences: comparison.differences,
        unknown_environments: comparison.unknownEnvironments,
        warnings: comparison.warnings,
        url: feature.url,
        microsoft_docs: feature.microsoft_docs,
        attribution: dataset.raw.source.attribution,
        disclaimer: dataset.raw.source.disclaimer,
        source: { name: dataset.raw.source.name, url: dataset.raw.source.url },
      });
    }),
  );
}
