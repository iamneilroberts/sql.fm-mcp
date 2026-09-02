import fixture from '../fixtures/synthetic/dataset.v1.json' with { type: 'json' };
import synonyms from '../data/synonyms.json' with { type: 'json' };
import { indexDataset } from '../src/domain/dataset.js';
import { validateDataset } from '../src/providers/validate.js';
import { buildSearchIndex } from '../src/search/index.js';
import { createFixtureProvider } from '../src/providers/local.js';

/** Deep clone so a test can mutate the fixture without leaking into others. */
export function rawFixture(): Record<string, unknown> {
  return structuredClone(fixture) as Record<string, unknown>;
}

export const synonymMap: Record<string, string[]> = synonyms;

export function loadFixture() {
  const dataset = validateDataset(rawFixture());
  const indexed = indexDataset(dataset);
  return { dataset, indexed, searchIndex: buildSearchIndex(indexed, synonymMap) };
}

export function fixtureProvider() {
  return createFixtureProvider(rawFixture(), synonymMap);
}

/** Parse the structuredContent out of a tool result, or throw with its error. */
export function structured<T>(result: unknown): T {
  const value = result as { structuredContent?: T; isError?: boolean; content?: { text: string }[] };
  if (value.isError) {
    throw new Error(`tool returned an error: ${value.content?.[0]?.text ?? 'unknown'}`);
  }
  if (value.structuredContent === undefined) throw new Error('result has no structuredContent');
  return value.structuredContent;
}

/** Parse the error payload out of a failed tool result. */
export function errorPayload(result: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  suggestions?: string[];
  valid_environments?: string[];
  field?: string;
} {
  const value = result as { isError?: boolean; content?: { text: string }[] };
  if (!value.isError) throw new Error('expected an error result');
  const text = value.content?.[0]?.text;
  if (!text) throw new Error('error result has no text');
  return (JSON.parse(text) as { error: ReturnType<typeof errorPayload> }).error;
}
