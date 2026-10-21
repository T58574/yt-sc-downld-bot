import { describe, expect, it } from 'vitest';
import { cancelCallbackData, formatCallbackData, parseCallbackData } from '../src/telegram/callbacks.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const TASK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('callback data', () => {
  it('собирает и разбирает выбор MP3', () => {
    const data = formatCallbackData(VIDEO_ID, { kind: 'audio' });
    expect(data).toBe(`fmt:${VIDEO_ID}:a`);
    expect(parseCallbackData(data)).toEqual({ kind: 'format', videoId: VIDEO_ID, selection: { kind: 'audio' } });
  });

  it('собирает и разбирает выбор качества видео', () => {
    const data = formatCallbackData(VIDEO_ID, { kind: 'video', height: 1080 });
    expect(data).toBe(`fmt:${VIDEO_ID}:v:1080`);
    expect(parseCallbackData(data)).toEqual({ kind: 'format', videoId: VIDEO_ID, selection: { kind: 'video', height: 1080 } });
  });

  it('разбирает отмену и собирает её детерминированно', () => {
    expect(parseCallbackData(cancelCallbackData(TASK_ID))).toEqual({ kind: 'cancel', taskId: TASK_ID });
  });

  it('все данные укладываются в лимит Telegram', () => {
    const samples = [
      formatCallbackData(VIDEO_ID, { kind: 'audio' }),
      formatCallbackData(VIDEO_ID, { kind: 'video', height: 4320 }),
      cancelCallbackData(TASK_ID),
    ];
    for (const sample of samples) {
      expect(Buffer.byteLength(sample, 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  it('отклоняет мусор и подделки', () => {
    const invalid = [
      '',
      'unknown',
      `fmt:${VIDEO_ID}`,
      `fmt:${VIDEO_ID}:x`,
      `fmt:${VIDEO_ID}:v:`,
      `fmt:${VIDEO_ID}:v:0`,
      `fmt:${VIDEO_ID}:v:9999`,
      `fmt:${VIDEO_ID}:v:12.5`,
      'fmt:short:a',
      'fmt:dQw4w9WgXcQ:a:extra',
      'cancel:not-a-uuid',
      `cancel:${TASK_ID.toUpperCase()}`,
      `cancel:${TASK_ID}-extra`,
    ];
    for (const data of invalid) {
      expect(parseCallbackData(data)).toBeNull();
    }
  });
});
