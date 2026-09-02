/**
 * Structured, safe errors. See architecture.md §12.8.
 *
 * Every message is written to tell a model what to do next, which is why
 * `suggestions` and `validEnvironments` are part of the error payload rather
 * than an afterthought. Nothing here may carry a stack trace, an internal
 * path, or an upstream URL.
 */

export type ErrorCode =
  | 'feature_not_found'
  | 'unknown_environment'
  | 'invalid_input'
  | 'dataset_unavailable';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  suggestions?: string[];
  valid_environments?: string[];
  field?: string;
}

export class ToolError extends Error {
  readonly payload: ErrorPayload;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.name = 'ToolError';
    this.payload = payload;
  }
}

export function featureNotFound(id: string, suggestions: string[]): ToolError {
  return new ToolError({
    code: 'feature_not_found',
    message: `No SQL.FM feature with id '${id}'.`,
    retryable: false,
    suggestions,
  });
}

export function unknownEnvironment(input: string, validEnvironments: string[]): ToolError {
  return new ToolError({
    code: 'unknown_environment',
    message: `'${input}' is not a known environment.`,
    retryable: false,
    valid_environments: validEnvironments,
  });
}

export function invalidInput(field: string, message: string): ToolError {
  return new ToolError({ code: 'invalid_input', message, retryable: false, field });
}

export function datasetUnavailable(): ToolError {
  return new ToolError({
    code: 'dataset_unavailable',
    message: 'The SQL.FM dataset is not currently available. Try again shortly.',
    retryable: true,
  });
}

/**
 * Convert anything thrown inside a tool into a safe payload.
 * Unrecognized errors become a generic retryable message — the internal
 * detail stays in the structured log, never in the response.
 */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof ToolError) return error.payload;
  return {
    code: 'dataset_unavailable',
    message: 'The request could not be completed.',
    retryable: true,
  };
}
