import { describe, expect, it } from 'vitest';
import { createLogger, redactText } from '../src/logger.js';

function collect(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  const logger = createLogger(level, (line) => lines.push(line));
  return {
    logger,
    lines,
    parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('redactText', () => {
  it('скрывает токены ботов', () => {
    expect(redactText(`BOT_TOKEN=123456789:${'A'.repeat(35)}`)).toContain('[redacted-token]');
    expect(redactText(`BOT_TOKEN=123456789:${'A'.repeat(35)}`)).not.toContain('123456789:');
  });

  it('обрезает query-параметры ссылок', () => {
    expect(redactText('https://api.telegram.org/bot123/getUpdates?offset=5')).toBe('https://api.telegram.org/bot123/getUpdates');
  });

  it('не ломается на некорректном URL', () => {
    expect(redactText('see https://[bad')).toContain('[url]');
  });
});

describe('createLogger', () => {
  it('пишет структурированный JSON с временем и уровнем', () => {
    const { logger, parsed } = collect();
    logger.info('task_started', { taskId: 'abc' });
    const [entry] = parsed();
    expect(entry?.level).toBe('info');
    expect(entry?.event).toBe('task_started');
    expect(entry?.taskId).toBe('abc');
    expect(typeof entry?.time).toBe('string');
  });

  it('уважает уровень логирования', () => {
    const { logger, lines } = collect('warn');
    logger.debug('debug_event');
    logger.info('info_event');
    logger.warn('warn_event');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('warn_event');
  });

  it('скрывает значения секретных полей и токены внутри текста', () => {
    const { logger, parsed } = collect();
    logger.error('failed', {
      token: `123456789:${'B'.repeat(35)}`,
      authorization: 'Bearer secret',
      message: `не удалось войти с 123456789:${'C'.repeat(35)}`,
    });
    const [entry] = parsed();
    expect(entry?.token).toBe('[redacted]');
    expect(entry?.authorization).toBe('[redacted]');
    expect(String(entry?.message)).toContain('[redacted-token]');
  });

  it('сериализует ошибки без потери имени и сообщения', () => {
    const { logger, parsed } = collect();
    const error = new Error('ENOENT: нет файла');
    error.name = 'ToolNotFoundError';
    logger.error('tool_failed', { error });
    const serialized = parsed()[0]?.error as Record<string, unknown> | undefined;
    expect(serialized?.name).toBe('ToolNotFoundError');
    expect(String(serialized?.message)).toContain('ENOENT');
  });

  it('обрезает слишком глубокие структуры', () => {
    const { logger, parsed } = collect();
    logger.info('deep', { a: { b: { c: { d: { e: { f: 1 } } } } } });
    expect(JSON.stringify(parsed()[0])).toContain('[truncated]');
  });
});
