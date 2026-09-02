import { createMcpHandler } from '@modelcontextprotocol/server';
import { createRuntime, type Env } from './config.js';
import { bundledIsSynthetic } from './data/bundled.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

/**
 * The web-standard request handler. Everything real lives here; the Worker,
 * Pages Function, and local HTTP entries are thin adapters around it, so all
 * three serve an identical surface by construction.
 */

export const MCP_ROUTE = '/mcp';
export const HEALTH_ROUTE = '/health';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-method, mcp-name, mcp-protocol-version, authorization',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export interface HandlerOptions {
  env?: Env;
}

export function createFetchHandler(options: HandlerOptions = {}) {
  const { provider, logger } = createRuntime(options.env ?? {});
  const mcp = createMcpHandler(() => createServer(provider, logger), {
    // The server holds no session state, so legacy compatibility costs
    // nothing here — a rare case where statelessness makes backwards
    // compatibility free.
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: (error) => logger.error('mcp handler error', { detail: error.message }),
  });

  return async function fetchHandler(request: Request, ...rest: unknown[]): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === HEALTH_ROUTE) {
      return handleHealth(provider);
    }

    if (url.pathname === MCP_ROUTE || url.pathname.startsWith(`${MCP_ROUTE}/`)) {
      const response = await (mcp.fetch as (r: Request, ...a: unknown[]) => Promise<Response>)(
        request,
        ...rest,
      );
      // The MCP handler owns its own headers; CORS is layered on so browser
      // based clients and MCP Inspector can reach it.
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return json(
      {
        error: {
          code: 'not_found',
          message: `Not found. The MCP endpoint is ${MCP_ROUTE}; health is ${HEALTH_ROUTE}.`,
        },
      },
      404,
    );
  };
}

/**
 * Freshness and provenance, without exposing internals.
 *
 * Deliberately excludes upstream URLs, environment variables, internal paths,
 * error details, and request counts (architecture.md §11.4).
 */
async function handleHealth(provider: {
  get: () => Promise<{ meta: import('./domain/types.js').DatasetMeta }>;
}): Promise<Response> {
  try {
    const { meta } = await provider.get();
    return json({
      status: meta.stale ? 'degraded' : 'ok',
      dataset: {
        schema_version: meta.schema_version,
        dataset_version: meta.dataset_version,
        generated_at: meta.generated_at,
        content_hash: meta.content_hash,
        source_kind: meta.source_kind,
        stale: meta.stale,
        synthetic: bundledIsSynthetic,
        feature_count: meta.feature_count,
        environment_count: meta.environment_count,
      },
      server: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  } catch {
    return json({ status: 'error', server: { name: SERVER_NAME, version: SERVER_VERSION } }, 503);
  }
}
