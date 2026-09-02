#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createRuntime, type Env } from './config.js';
import { createServer } from './server.js';

/**
 * Local stdio entry point (architecture.md §5.6).
 *
 * A first-class supported mode, not a fallback: it is how the server is
 * developed, how MCP Inspector drives it, and how anyone can try the tools
 * against synthetic fixtures without a hosted service existing.
 *
 *   npx sqlfm-mcp                  # or: npm run dev:stdio
 *
 * For local HTTP use `npm run dev` (wrangler dev), which serves the same
 * handler on the workerd runtime — the same runtime as production, rather
 * than a Node approximation of it.
 *
 * NOTE: this ships SYNTHETIC data. Distributing real SQL.FM data in a
 * package is out of scope and would need its own permission conversation.
 */

async function main(): Promise<void> {
  const { provider, logger } = createRuntime(process.env as Env);
  const server = createServer(provider, logger);

  // stdout is the protocol channel: anything written there that is not a
  // JSON-RPC message corrupts the stream. Diagnostics go to stderr.
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      message: 'stdio server failed to start',
      detail: error instanceof Error ? error.message : 'unknown',
    })}\n`,
  );
  process.exit(1);
});
