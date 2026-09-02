import { createFetchHandler } from './handler.js';
import type { Env } from './config.js';

/**
 * Shape B — Cloudflare Pages Function adapter (architecture.md §5.3.1).
 *
 * Drop `src/` into the SQL.FM Pages project and add:
 *
 *     // functions/mcp/[[path]].ts
 *     export { onRequest } from '../../src/pages';
 *
 * Pages Functions run on the Workers runtime, so this is the same handler the
 * standalone Worker serves — the MCP surface does not change with the shape.
 */

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

let handler: ReturnType<typeof createFetchHandler> | null = null;

export function onRequest(context: PagesContext): Promise<Response> {
  handler ??= createFetchHandler({ env: context.env });
  return handler(context.request, context.env, context);
}
