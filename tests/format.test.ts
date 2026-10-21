import { describe, expect, it } from 'vitest';
import { escapeHtml, formatBytes, formatDuration, formatEta, formatSpeed, truncate } from '../src/format.js';

describe('escapeHtml', () => {
  it('экранирует опасные символы', () => {
    expect(escapeHtml('<b>a & "b"</b>')).toBe('&lt;b&gt;a &amp; &quot;b&quot;&lt;/b&gt;');
  });
});

describe('truncate', () => {
  it('обрезает длинный текст и оставляет короткий', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('formatDuration', () => {
  it('форматирует минуты и часы', () => {
    expect(formatDuration(213)).toBe('3:33');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('возвращает «неизвестно» для мусора', () => {
    expect(formatDuration(undefined)).toBe('неизвестно');
    expect(formatDuration(-1)).toBe('неизвестно');
    expect(formatDuration(Number.NaN)).toBe('неизвестно');
  });
});

describe('formatBytes', () => {
  it('подбирает единицы измерения', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(2048)).toBe('2.00 КиБ');
    expect(formatBytes(300 * 1024)).toBe('300.0 КиБ');
    expect(formatBytes(1024 * 1024)).toBe('1.00 МиБ');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 МиБ');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 ГиБ');
    expect(formatBytes(undefined)).toBe('неизвестно');
    expect(formatBytes(-1)).toBe('неизвестно');
  });
});

describe('formatSpeed и formatEta', () => {
  it('не показывает бессмысленные значения', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1.00 МиБ/с');
    expect(formatSpeed(0)).toBeUndefined();
    expect(formatSpeed(undefined)).toBeUndefined();
    expect(formatEta(90)).toBe('1:30');
    expect(formatEta(-5)).toBeUndefined();
  });
});
