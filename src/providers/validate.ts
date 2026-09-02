import { z } from 'zod';
import { expectedRowLength } from '../domain/matrix.js';
import { EDITIONS, SUPPORT_STATUSES, type Dataset } from '../domain/types.js';
import { sanitizeText, sanitizeUrls } from '../util/sanitize.js';

/**
 * Dataset validation and ingest sanitization.
 *
 * A dataset is fully validated BEFORE it is allowed to replace a live one
 * (architecture.md §11.3). A malformed or hostile upstream file can degrade
 * freshness; it must never corrupt live answers (T4).
 */

const statusSchema = z.enum(SUPPORT_STATUSES);
const editionSchema = z.enum(EDITIONS);
const urlSchema = z.string().max(500);

export const datasetSchema = z.object({
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  dataset_version: z.string().min(1).max(200),
  generated_at: z.string().max(64).nullable(),
  source: z.object({
    name: z.string().min(1).max(120),
    url: urlSchema,
    feature_url_template: z.string().min(1).max(300),
    attribution: z.string().min(1).max(2000),
    disclaimer: z.string().min(1).max(2000),
  }),
  releases: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
        major: z.string().max(32),
        year: z.number().int(),
        sort: z.number().int(),
      }),
    )
    .min(1),
  editions: z
    .array(
      z.object({
        id: editionSchema,
        name: z.string().min(1).max(64),
        sort: z.number().int(),
      }),
    )
    .min(1),
  cloud_targets: z.array(
    z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(120),
      short: z.string().max(64),
      docs: urlSchema.nullable(),
      sort: z.number().int(),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().min(1).max(120),
      parent_id: z.number().int().nullable(),
      parent_name: z.string().max(120).nullable(),
      sort: z.number().int(),
    }),
  ),
  support_matrix: z.object({
    encoding: z.literal('compact-v1'),
    legend: z.record(z.string().length(1), statusSchema),
    release_order: z.array(z.string().min(1).max(64)).min(1),
    edition_order: z.array(editionSchema).min(1),
    rows: z.record(z.string(), z.string()),
  }),
  features: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        upstream_id: z.number().int().nullable(),
        name: z.string().min(1).max(200),
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        url: urlSchema,
        type: z.string().max(120),
        category: z.object({
          id: z.number().int(),
          name: z.string().min(1).max(120),
          parent_name: z.string().max(120).nullable(),
        }),
        summary: z.string().max(4000),
        aliases: z.array(z.string().max(120)),
        microsoft_docs: z.array(urlSchema),
        cloud_support: z.record(
          z.string().max(64),
          z.object({
            status: statusSchema,
            note: z.string().max(4000).nullable(),
            sources: z.array(urlSchema),
          }),
        ),
        timeline: z.array(
          z.object({
            event: z.string().max(64),
            environment: z.string().max(64),
            edition: editionSchema.nullable(),
            summary: z.string().max(4000),
            source: urlSchema.nullable(),
          }),
        ),
        conditions: z.array(
          z.object({
            environment: z.string().max(64).nullable(),
            edition: editionSchema.nullable(),
            note: z.string().max(4000),
            source: urlSchema.nullable(),
          }),
        ),
        requirements: z.object({
          compatibility_level: z.string().max(200).nullable(),
          platform: z.string().max(200).nullable(),
          other: z.array(z.string().max(500)),
        }),
        attributes: z.array(z.unknown()),
      }),
    )
    .min(1),
});

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetValidationError';
  }
}

/** The dataset contract major version this build understands. */
export const SUPPORTED_SCHEMA_MAJOR = 1;

/**
 * Validate, gate on schema version, sanitize, and cross-check a raw dataset.
 * Throws {@link DatasetValidationError} on any failure — the caller keeps the
 * previous dataset rather than swapping in something it could not verify.
 */
export function validateDataset(raw: unknown): Dataset {
  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join('.') || '(root)' : '(root)';
    const why = first?.message ?? 'unknown';
    throw new DatasetValidationError(`Dataset failed validation at ${where}: ${why}`);
  }

  const dataset = parsed.data as Dataset;

  const major = Number.parseInt(dataset.schema_version.split('.')[0] ?? '', 10);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    throw new DatasetValidationError(
      `Unsupported dataset schema_version ${dataset.schema_version}; this build supports ${SUPPORTED_SCHEMA_MAJOR}.x.`,
    );
  }

  // Cross-checks the type system cannot express.
  const expected = expectedRowLength(dataset.support_matrix);
  for (const [featureId, row] of Object.entries(dataset.support_matrix.rows)) {
    if (row.length !== expected) {
      throw new DatasetValidationError(
        `support_matrix row '${featureId}' has length ${row.length}; expected ${expected}.`,
      );
    }
    for (const code of row) {
      if (!(code in dataset.support_matrix.legend)) {
        throw new DatasetValidationError(
          `support_matrix row '${featureId}' contains code '${code}' which is not in the legend.`,
        );
      }
    }
  }

  const releaseIds = new Set(dataset.releases.map((r) => r.id));
  for (const id of dataset.support_matrix.release_order) {
    if (!releaseIds.has(id)) {
      throw new DatasetValidationError(`support_matrix.release_order names unknown release '${id}'.`);
    }
  }

  const ids = new Set<string>();
  for (const feature of dataset.features) {
    if (ids.has(feature.id)) {
      throw new DatasetValidationError(`Duplicate feature id '${feature.id}'.`);
    }
    ids.add(feature.id);
  }

  return sanitizeDataset(dataset);
}

/**
 * Sanitize every free-text and URL field on ingest.
 *
 * Applied once at load rather than at render time, so no code path can
 * accidentally emit unsanitized upstream text. Factual content is preserved;
 * only characters that let text impersonate something else are removed.
 */
function sanitizeDataset(dataset: Dataset): Dataset {
  return {
    ...dataset,
    source: {
      ...dataset.source,
      attribution: sanitizeText(dataset.source.attribution),
      disclaimer: sanitizeText(dataset.source.disclaimer),
    },
    features: dataset.features.map((feature) => ({
      ...feature,
      name: sanitizeText(feature.name, 200),
      summary: sanitizeText(feature.summary),
      type: sanitizeText(feature.type, 120),
      aliases: feature.aliases.map((a) => sanitizeText(a, 120)).filter((a) => a.length > 0),
      microsoft_docs: sanitizeUrls(feature.microsoft_docs),
      cloud_support: Object.fromEntries(
        Object.entries(feature.cloud_support).map(([envId, cell]) => [
          envId,
          {
            ...cell,
            note: cell.note === null ? null : sanitizeText(cell.note),
            sources: sanitizeUrls(cell.sources),
          },
        ]),
      ),
      timeline: feature.timeline.map((event) => ({
        ...event,
        summary: sanitizeText(event.summary),
        source: event.source === null ? null : sanitizeUrls([event.source])[0] ?? null,
      })),
      conditions: feature.conditions.map((condition) => ({
        ...condition,
        note: sanitizeText(condition.note),
        source: condition.source === null ? null : sanitizeUrls([condition.source])[0] ?? null,
      })),
      requirements: {
        ...feature.requirements,
        other: feature.requirements.other.map((o) => sanitizeText(o, 500)),
      },
    })),
  };
}

/** SHA-256 of the canonical dataset bytes. Always computable. */
export async function contentHash(raw: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
