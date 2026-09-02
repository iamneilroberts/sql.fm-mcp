/**
 * Structured, privacy-preserving logging. See architecture.md §12.7.
 *
 * Query TEXT is never logged. Only its length, which is enough to spot abuse
 * and pathological input without recording what anyone asked. There is no
 * analytics, no third-party telemetry, and no personal data — so there is
 * nothing to leak.
 */

export interface ToolLogFields {
  tool: string;
  ok: boolean;
  latency_ms: number;
  result_count?: number;
  query_len?: number;
  error_code?: string | null;
  dataset_version?: string;
  /** Only populated when SQLFM_LOG_QUERIES is explicitly enabled (local debugging). */
  query?: string;
}

export interface LoggerOptions {
  /** Local debugging only. Off by default; unsuitable for production. */
  logQueries: boolean;
}

export interface Logger {
  tool(fields: ToolLogFields): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function emit(level: 'info' | 'warn' | 'error', payload: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions): Logger {
  return {
    tool(fields) {
      const { query, ...safe } = fields;
      emit('info', options.logQueries && query !== undefined ? { ...safe, query } : safe);
    },
    warn(message, fields) {
      emit('warn', { message, ...fields });
    },
    error(message, fields) {
      emit('error', { message, ...fields });
    },
  };
}

/** A logger that discards everything. Used in tests to keep output readable. */
export const silentLogger: Logger = {
  tool() {},
  warn() {},
  error() {},
};
