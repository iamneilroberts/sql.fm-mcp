import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { introducedIn, releaseGrid, statusFor } from '../domain/dataset.js';
import { composeFeatureText } from '../domain/text.js';
import { suggest } from '../search/index.js';
import type { DatasetProvider } from '../providers/types.js';
import { featureNotFound, invalidInput } from '../util/errors.js';
import { isValidFeatureId, LIMITS } from '../util/limits.js';
import type { Logger } from '../util/log.js';
import { attributionFields, guarded, READ_ONLY_ANNOTATIONS, statusEnum, toolResult } from './shared.js';

const inputSchema = z.object({
  id: z
    .string()
    .max(LIMITS.ID_MAX_LENGTH)
    .describe('Feature id (slug) from a search result, e.g. "string-agg".'),
});

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string().describe('Complete, model-readable description of this feature\'s support.'),
  url: z.string().describe('Canonical SQL.FM URL. Use this to cite the record.'),
  metadata: z.object({
    slug: z.string(),
    category: z.string(),
    parent_category: z.string().nullable(),
    type: z.string(),
    summary: z.string(),
    aliases: z.array(z.string()),
    support: z.object({
      sql_server: z.array(
        z.object({
          release: z.string(),
          release_label: z.string(),
          year: z.number().int(),
          editions: z.record(z.string(), statusEnum),
          aggregate: statusEnum,
          aggregate_condition: z.string().nullable(),
        }),
      ),
      azure: z.record(
        z.string(),
        z.object({
          status: statusEnum,
          label: z.string(),
          conditions: z.array(z.string()),
          notes: z.array(z.string()),
          sources: z.array(z.string()),
        }),
      ),
    }),
    introduced: z.object({
      environment: z.string().nullable(),
      release_label: z.string().nullable(),
      year: z.number().int().nullable(),
      summary: z.string().nullable(),
    }),
    timeline: z.array(
      z.object({
        event: z.string(),
        environment: z.string(),
        edition: z.string().nullable(),
        summary: z.string(),
        source: z.string().nullable(),
      }),
    ),
    conditions: z.array(
      z.object({
        environment: z.string().nullable(),
        edition: z.string().nullable(),
        note: z.string(),
        source: z.string().nullable(),
      }),
    ),
    requirements: z.object({
      compatibility_level: z.string().nullable(),
      platform: z.string().nullable(),
      other: z.array(z.string()),
    }),
    microsoft_docs: z.array(z.string()),
    data_gaps: z
      .array(z.string())
      .describe('What SQL.FM does not record for this feature. Never treat a gap as "unsupported".'),
  }),
  ...attributionFields,
});

const DESCRIPTION =
  'Retrieve the complete SQL.FM record for one feature: its support matrix across every SQL Server ' +
  'release and edition, Azure SQL Database and Azure SQL Managed Instance status, introduction ' +
  'history, conditions and qualifications, and Microsoft documentation links. Call this after ' +
  '`search` returns a candidate, using the `id` from the result. Use `compare_feature_support` ' +
  'instead when the question is about a small set of specific named versions or editions.';

export function registerFetchTool(
  server: McpServer,
  provider: DatasetProvider,
  logger: Logger,
): void {
  server.registerTool(
    'fetch',
    {
      title: 'Fetch a SQL.FM feature record',
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    guarded(async (args: z.infer<typeof inputSchema>) => {
      const started = Date.now();

      // Grammar check before any lookup. Ids are only ever used as map keys —
      // never to build a path or a URL.
      if (!isValidFeatureId(args.id)) {
        throw invalidInput('id', `'${args.id}' is not a valid feature id.`);
      }

      const { dataset, searchIndex } = await provider.get();
      const feature = dataset.featureById.get(args.id);
      if (!feature) {
        throw featureNotFound(args.id, suggest(searchIndex, args.id, LIMITS.SUGGESTION_COUNT));
      }

      const composed = composeFeatureText(dataset, feature);
      const grid = releaseGrid(dataset, feature);
      const introduced = introducedIn(dataset, feature);

      const azure = Object.fromEntries(
        dataset.environments.all
          .filter((environment) => environment.kind === 'azure')
          .map((environment) => {
            const resolved = statusFor(dataset, feature, environment);
            return [
              environment.id,
              {
                status: resolved.status,
                label: environment.label,
                conditions: resolved.conditions,
                notes: resolved.notes,
                sources: resolved.sources,
              },
            ];
          }),
      );

      logger.tool({
        tool: 'fetch',
        ok: true,
        latency_ms: Date.now() - started,
        result_count: 1,
        error_code: null,
        dataset_version: dataset.raw.dataset_version,
      });

      return toolResult({
        id: feature.id,
        title: feature.name,
        text: composed.text,
        url: feature.url,
        metadata: {
          slug: feature.slug,
          category: feature.category.name,
          parent_category: feature.category.parent_name,
          type: feature.type,
          summary: feature.summary,
          aliases: feature.aliases,
          support: {
            sql_server: grid.map((row) => ({
              release: row.release.id,
              release_label: row.release.name,
              year: row.release.year,
              editions: row.editions,
              aggregate: row.aggregate,
              aggregate_condition: row.aggregateCondition,
            })),
            azure,
          },
          introduced: {
            environment: introduced?.release.id ?? null,
            release_label: introduced?.release.name ?? null,
            year: introduced?.release.year ?? null,
            summary: introduced?.summary ?? null,
          },
          timeline: feature.timeline,
          conditions: feature.conditions,
          requirements: feature.requirements,
          microsoft_docs: feature.microsoft_docs,
          data_gaps: composed.dataGaps,
        },
        attribution: dataset.raw.source.attribution,
        disclaimer: dataset.raw.source.disclaimer,
        source: { name: dataset.raw.source.name, url: dataset.raw.source.url },
      });
    }),
  );
}
