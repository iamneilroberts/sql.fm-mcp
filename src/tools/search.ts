import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { statusFor } from '../domain/dataset.js';
import { resolveEnvironment, ENVIRONMENT_GRAMMAR } from '../domain/environments.js';
import { normalize } from '../search/normalize.js';
import { search, suggest } from '../search/index.js';
import type { DatasetProvider } from '../providers/types.js';
import { unknownEnvironment } from '../util/errors.js';
import { LIMITS } from '../util/limits.js';
import type { Logger } from '../util/log.js';
import { attributionFields, guarded, READ_ONLY_ANNOTATIONS, statusEnum, toolResult } from './shared.js';

/**
 * ChatGPT deep research requires `search` to accept a single query string.
 * Every filter here is optional and additive: ChatGPT omits them, Claude and
 * Codex can use them, and the tool stays conformant either way.
 */
const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(LIMITS.QUERY_MAX_LENGTH)
    .describe(
      'Feature name, keyword, or natural-language question. Examples: "STRING_AGG", "online index rebuild", "which version added DATE_BUCKET".',
    ),
  category: z
    .string()
    .max(LIMITS.CATEGORY_MAX_LENGTH)
    .optional()
    .describe('Restrict to a SQL.FM category, e.g. "Indexing", "Security". See sqlfm://categories.'),
  environment: z
    .string()
    .max(LIMITS.ENVIRONMENT_MAX_LENGTH)
    .optional()
    .describe(`Restrict to features with the given status in one environment. ${ENVIRONMENT_GRAMMAR}`),
  status: statusEnum
    .optional()
    .describe('Used with `environment`: keep only features with this status there. Defaults to "available".'),
  limit: z
    .number()
    .int()
    .min(LIMITS.RESULT_LIMIT_MIN)
    .max(LIMITS.RESULT_LIMIT_MAX)
    .default(LIMITS.RESULT_LIMIT_DEFAULT)
    .describe(`Maximum results to return (1-${LIMITS.RESULT_LIMIT_MAX}).`),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().describe('Feature id (slug). Pass to fetch or compare_feature_support.'),
      title: z.string(),
      url: z.string().describe('Canonical SQL.FM URL. Use this to cite the result.'),
      summary: z.string(),
      category: z.string(),
      score: z.number().describe('Relevance score, 0-1000. Higher is a stronger match.'),
      match_reason: z.enum([
        'exact_slug',
        'exact_name',
        'alias',
        'prefix',
        'tokens',
        'description',
        'fuzzy',
      ]),
    }),
  ),
  total_matched: z.number().int().describe('Matches before `limit` was applied.'),
  truncated: z.boolean(),
  suggestions: z.array(z.string()).describe('Nearest feature ids, when the search found nothing.'),
  query_interpretation: z.object({
    normalized_query: z.string(),
    tokens: z.array(z.string()),
    synonyms_applied: z.array(z.string()),
    filters: z.object({
      category: z.string().nullable(),
      environment: z.string().nullable(),
      status: z.string().nullable(),
    }),
  }),
  ...attributionFields,
});

const DESCRIPTION =
  'Search the SQL.FM SQL Server feature reference by name, keyword, or natural language. ' +
  'Use this FIRST whenever a question involves whether a SQL Server or Azure SQL feature, function, ' +
  'or capability exists, when it was introduced, or which versions or editions have it — including ' +
  'questions about T-SQL functions, indexing, high availability, security, and Azure SQL differences. ' +
  'Returns candidate features with canonical sql.fm URLs for citation. Call `fetch` for full detail on ' +
  'a result, or `compare_feature_support` to compare one feature across environments. ' +
  'Do not answer SQL Server version-support questions from memory; search here.';

export function registerSearchTool(
  server: McpServer,
  provider: DatasetProvider,
  logger: Logger,
): void {
  server.registerTool(
    'search',
    {
      title: 'Search SQL.FM features',
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    guarded(async (args: z.infer<typeof inputSchema>) => {
      const started = Date.now();
      const { dataset, searchIndex } = await provider.get();

      const outcome = search(searchIndex, args.query);

      let filtered = outcome.hits;
      let environmentId: string | null = null;

      if (args.category !== undefined) {
        const wanted = normalize(args.category).spaced;
        filtered = filtered.filter((hit) => {
          const name = normalize(hit.feature.category.name).spaced;
          const parent = normalize(hit.feature.category.parent_name ?? '').spaced;
          return name === wanted || parent === wanted;
        });
      }

      if (args.environment !== undefined) {
        const environment = resolveEnvironment(dataset.environments, args.environment);
        if (!environment) {
          throw unknownEnvironment(
            args.environment,
            dataset.environments.all.map((e) => e.id),
          );
        }
        environmentId = environment.id;
        const wantedStatus = args.status ?? 'available';
        filtered = filtered.filter(
          (hit) => statusFor(dataset, hit.feature, environment).status === wantedStatus,
        );
      }

      const results = filtered.slice(0, args.limit).map((hit) => ({
        id: hit.feature.id,
        title: hit.feature.name,
        url: hit.feature.url,
        summary: hit.feature.summary,
        category: hit.feature.category.name,
        score: hit.score,
        match_reason: hit.reason,
      }));

      // An empty search is not an error — it is a result with a next step.
      const suggestions =
        results.length === 0 ? suggest(searchIndex, args.query, LIMITS.SUGGESTION_COUNT) : [];

      logger.tool({
        tool: 'search',
        ok: true,
        latency_ms: Date.now() - started,
        result_count: results.length,
        query_len: args.query.length,
        error_code: null,
        dataset_version: dataset.raw.dataset_version,
        query: args.query,
      });

      return toolResult({
        results,
        total_matched: filtered.length,
        truncated: filtered.length > results.length,
        suggestions,
        query_interpretation: {
          normalized_query: outcome.interpretation.normalizedQuery,
          tokens: outcome.interpretation.tokens,
          synonyms_applied: outcome.interpretation.synonymsApplied,
          filters: {
            category: args.category ?? null,
            environment: environmentId,
            status: args.environment !== undefined ? (args.status ?? 'available') : null,
          },
        },
        attribution: dataset.raw.source.attribution,
        disclaimer: dataset.raw.source.disclaimer,
        source: { name: dataset.raw.source.name, url: dataset.raw.source.url },
      });
    }),
  );
}
