import { createFetchHandler, type HandlerOptions } from './handler.js';
import type { Env } from './config.js';

/**
 * Shape A — standalone Cloudflare Worker (architecture.md §5.3.1).
 *
 * The handler is built once per isolate and reused, so the dataset and search
 * index are constructed on the first request and amortized across every
 * request that isolate serves.
 */

let handler: ReturnType<typeof createFetchHandler> | null = null;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    handler ??= createFetchHandler({ env } satisfies HandlerOptions);
    return handler(request, env, ctx);
  },
};
