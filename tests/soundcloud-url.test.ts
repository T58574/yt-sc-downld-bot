import { describe, expect, it } from 'vitest';
import {
  isSoundCloudMediaUrl,
  looksLikeSoundCloudUrl,
  parseSoundCloudUrl,
  soundCloudRejectionMessage,
} from '../src/soundcloud/url.js';

function ok(input: string) {
  const result = parseSoundCloudUrl(input);
  if (!result.ok) throw new Error(`Ожидался успех для ${input}, получено ${result.reason}`);
  return result.value;
}

function reason(input: string) {
  const result = parseSoundCloudUrl(input);
  if (result.ok) throw new Error(`Ожидался отказ для ${input}`);
  return result.reason;
}

describe('parseSoundCloudUrl', () => {
  it('разбирает обычную ссылку на трек и убирает query/hash', () => {
    const value = ok('https://soundcloud.com/vainontop/9ts-x-liverpool-street-in-the-rain-1?si=abc#t=10');
    expect(value.url).toBe('https://soundcloud.com/vainontop/9ts-x-liverpool-street-in-the-rain-1');
    expect(value.shortLink).toBe(false);
  });

  it('поддерживает www, m и короткие ссылки on.soundcloud.com', () => {
    expect(ok('https://www.soundcloud.com/artist/track').url).toBe('https://soundcloud.com/artist/track');
    expect(ok('http://m.soundcloud.com/artist/track').url).toBe('https://soundcloud.com/artist/track');
    const short = ok('https://on.soundcloud.com/AbCdEf123');
    expect(short.url).toBe('https://on.soundcloud.com/AbCdEf123');
    expect(short.shortLink).toBe(true);
  });

  it('обрезает пробелы вокруг ссылки', () => {
    expect(ok('  https://soundcloud.com/artist/track\n').url).toBe('https://soundcloud.com/artist/track');
  });

  it('отклоняет пустую строку, мусор и слишком длинный ввод', () => {
    expect(reason('   ')).toBe('empty');
    expect(reason('привет')).toBe('invalid_url');
    expect(reason(`https://soundcloud.com/${'a'.repeat(3000)}/track`)).toBe('too_long');
  });

  it('отклоняет неподдерживаемые схемы, чужие хосты и логин/пароль', () => {
    expect(reason('ftp://soundcloud.com/artist/track')).toBe('unsupported_scheme');
    expect(reason('https://example.com/artist/track')).toBe('unsupported_host');
    expect(reason('https://soundcloud.com.evil.tld/artist/track')).toBe('unsupported_host');
    expect(reason('https://user:pass@soundcloud.com/artist/track')).toBe('invalid_url');
  });

  it('отклоняет профили, плейлисты и служебные пути', () => {
    expect(reason('https://soundcloud.com/artist')).toBe('unsupported_path');
    expect(reason('https://soundcloud.com/artist/sets')).toBe('playlist_only');
    expect(reason('https://soundcloud.com/artist/sets/my-set')).toBe('playlist_only');
    expect(reason('https://soundcloud.com/discover')).toBe('unsupported_path');
    expect(reason('https://soundcloud.com/artist/track/extra')).toBe('unsupported_path');
    expect(reason('https://on.soundcloud.com/')).toBe('unsupported_path');
  });

  it('отклоняет небезопасные сегменты пути', () => {
    expect(reason('https://soundcloud.com/../track')).toBe('unsupported_path');
    expect(reason('https://soundcloud.com/artist/track%0a')).toBe('unsupported_path');
  });

  it('отдаёт понятное сообщение для каждого типа отказа', () => {
    const reasons = [
      'empty',
      'too_long',
      'invalid_url',
      'unsupported_scheme',
      'unsupported_host',
      'unsupported_path',
      'playlist_only',
    ] as const;
    for (const item of reasons) {
      const message = soundCloudRejectionMessage(item);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain('undefined');
    }
  });
});

describe('определение SoundCloud', () => {
  it('узнаёт хосты SoundCloud', () => {
    expect(looksLikeSoundCloudUrl('https://soundcloud.com/artist/track')).toBe(true);
    expect(looksLikeSoundCloudUrl('https://on.soundcloud.com/AbCdEf')).toBe(true);
    expect(looksLikeSoundCloudUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
    expect(looksLikeSoundCloudUrl('не url')).toBe(false);
  });

  it('проверяет URL перед передачей в yt-dlp', () => {
    expect(isSoundCloudMediaUrl('https://soundcloud.com/artist/track')).toBe(true);
    expect(isSoundCloudMediaUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isSoundCloudMediaUrl('file:///etc/passwd')).toBe(false);
  });
});
