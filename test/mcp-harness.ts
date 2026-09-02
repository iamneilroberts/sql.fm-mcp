import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { silentLogger } from '../src/util/log.js';
import { fixtureProvider } from './helpers.js';

/**
 * Drives the real MCP server through the real MCP client over a linked
 * in-memory transport — the same code path a hosted client takes, minus the
 * socket. Acceptance tests run through this rather than calling tool
 * functions directly, so schema registration, validation, annotations, and
 * result shaping are all exercised.
 */
export async function connectClient(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(fixtureProvider(), silentLogger);
  await server.connect(serverTransport);

  const client = new Client({ name: 'sqlfm-test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface ToolCallResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as ToolCallResult;
}

export function expectStructured<T>(result: ToolCallResult): T {
  if (result.isError) {
    throw new Error(`tool returned an error: ${result.content?.[0]?.text ?? 'unknown'}`);
  }
  if (result.structuredContent === undefined) throw new Error('result has no structuredContent');
  return result.structuredContent as T;
}

export function expectError(result: ToolCallResult): {
  code: string;
  message: string;
  retryable: boolean;
  suggestions?: string[];
  valid_environments?: string[];
  field?: string;
} {
  if (!result.isError) throw new Error('expected an error result');
  const text = result.content?.[0]?.text;
  if (!text) throw new Error('error result has no text');
  return (JSON.parse(text) as { error: ReturnType<typeof expectError> }).error;
}
