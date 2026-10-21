import type { LogLevel } from './types.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TOKEN_PATTERN = /\b\d{5,15}:[A-Za-z0-9_-]{25,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const SECRET_KEY_PATTERN = /token|authorization|password|secret|cookie|api[_-]?key/i;

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export type LogSink = (line: string) => void;

function stripUrlDetails(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[url]';
  }
}

export function redactText(input: string): string {
  return input
    .replace(TOKEN_PATTERN, '[redacted-token]')
    .replace(URL_PATTERN, (rawUrl) => stripUrlDetails(rawUrl));
}

function sanitizeValue(value: unknown, key?: string, depth = 0): unknown {
  if (key !== undefined && SECRET_KEY_PATTERN.test(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
    };
  }
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, undefined, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function createLogger(level: LogLevel, sink: LogSink = (line) => process.stdout.write(`${line}\n`)): Logger {
  const threshold = LEVEL_WEIGHT[level];

  function write(entryLevel: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    try {
      const payload = {
        time: new Date().toISOString(),
        level: entryLevel,
        event,
        ...(fields ? (sanitizeValue(fields) as Record<string, unknown>) : {}),
      };
      sink(JSON.stringify(payload));
    } catch {
      sink(
        JSON.stringify({
          time: new Date().toISOString(),
          level: 'error',
          event: 'logger_failure',
        }),
      );
    }
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
