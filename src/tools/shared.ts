import { z } from 'zod';
import { SUPPORT_STATUSES } from '../domain/types.js';
import { toErrorPayload, ToolError } from '../util/errors.js';

/**
 * Shared tool plumbing: schema fragments, result shaping, and the error
 * boundary every tool runs inside.
 */

export const statusEnum = z.enum(SUPPORT_STATUSES);

export const sourceSchema = z.object({
  name: z.string(),
  url: z.string(),
});

/** Attribution fields carried on every tool result (architecture.md §13). */
export const attributionFields = {
  attribution: z.string().describe('Required attribution for this data.'),
  disclaimer: z.string().describe('Accuracy and non-affiliation disclaimer.'),
  source: sourceSchema,
};

/**
 * The dual result shape.
 *
 * `structuredContent` is the machine-readable answer; `content[0].text` is the
 * same object JSON-encoded. ChatGPT requires both; every other client
 * tolerates both. Emitting one without the other is the most common way an
 * MCP server fails client compatibility, so it is done in one place.
 */
export function toolResult<T>(structured: T): {
  content: [{ type: 'text'; text: string }];
  structuredContent: T;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

/**
 * Error results carry no `structuredContent`: an error is not an instance of
 * the tool's output schema, and pretending otherwise makes clients that
 * validate output reject the error instead of reporting it.
 */
export function toolErrorResult(error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const payload = toErrorPayload(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: payload }) }],
    isError: true,
  };
}

/** Read-only, deterministic, closed-world. Identical for all three tools. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Wrap a tool handler so no unexpected throw escapes as a stack trace, and so
 * every failure comes back as a structured, safe payload.
 */
export function guarded<Args, Result>(
  handler: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result | ReturnType<typeof toolErrorResult>> {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (error) {
      if (!(error instanceof ToolError)) {
        // Detail stays in the log; the response says only that it failed.
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            message: 'unhandled tool error',
            detail: error instanceof Error ? error.message : 'unknown',
          }),
        );
      }
      return toolErrorResult(error);
    }
  };
}
