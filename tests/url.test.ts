import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl, urlRejectionMessage } from '../src/youtube/url.js';

function ok(input: string) {
  const result = parseYouTubeUrl(input);
  if (!result.ok) throw new Error(`Ожидался успех для ${input}, получено ${result.reason}`);
  return result.value;
}

function reason(input: string) {
  const result = parseYouTubeUrl(input);
  if (result.ok) throw new Error(`Ожидался отказ для ${input}`);
  return result.reason;
}

describe('parseYouTubeUrl', () => {
  it('разбирает стандартную ссылку watch', () => {
    const value = ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(value.videoId).toBe('dQw4w9WgXcQ');
    expect(value.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(value.hadPlaylistParam).toBe(false);
  });

  it('разбирает watch с дополнительными параметрами и помечает playlist', () => {
    const value = ok('https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=3&t=42s');
    expect(value.videoId).toBe('dQw4w9WgXcQ');
    expect(value.hadPlaylistParam).toBe(true);
  });

  it('разбирает youtu.be, shorts, embed и m.youtube.com', () => {
    expect(ok('https://youtu.be/dQw4w9WgXcQ?t=10').videoId).toBe('dQw4w9WgXcQ');
    expect(ok('https://www.youtube.com/shorts/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
    expect(ok('https://www.youtube.com/embed/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
    expect(ok('https://m.youtube.com/watch?v=dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
  });

  it('обрезает пробелы вокруг ссылки', () => {
    expect(ok('  https://youtu.be/dQw4w9WgXcQ\n').videoId).toBe('dQw4w9WgXcQ');
  });

  it('отклоняет пустую строку, мусор и слишком длинный ввод', () => {
    expect(reason('   ')).toBe('empty');
    expect(reason('привет')).toBe('invalid_url');
    expect(reason(`https://youtu.be/${'a'.repeat(3000)}`)).toBe('too_long');
  });

  it('отклоняет неподдерживаемые схемы и сторонние хосты', () => {
    expect(reason('ftp://youtu.be/dQw4w9WgXcQ')).toBe('unsupported_scheme');
    expect(reason('javascript:alert(1)')).toBe('unsupported_scheme');
    expect(reason('https://example.com/watch?v=dQw4w9WgXcQ')).toBe('unsupported_host');
    expect(reason('https://youtube.com.evil.tld/watch?v=dQw4w9WgXcQ')).toBe('unsupported_host');
  });

  it('отклоняет ссылки с логином или паролем', () => {
    expect(reason('https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ')).toBe('invalid_url');
  });

  it('отклоняет плейлисты и трансляции', () => {
    expect(reason('https://www.youtube.com/playlist?list=PL123')).toBe('playlist_only');
    expect(reason('https://www.youtube.com/watch?list=PL123')).toBe('playlist_only');
    expect(reason('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('live_unsupported');
    expect(reason('https://www.youtube.com/watch?v=dQw4w9WgXcQ/live')).toBe('invalid_video_id');
  });

  it('отклоняет некорректный или короткий ID видео', () => {
    expect(reason('https://www.youtube.com/watch?v=short')).toBe('invalid_video_id');
    expect(reason('https://youtu.be/dQw4w9WgXcQ/extra')).toBe('unsupported_path');
    expect(reason('https://www.youtube.com/shorts/$%^&*()_+-=')).toBe('invalid_video_id');
  });

  it('отклоняет служебные и неразобранные пути', () => {
    expect(reason('https://www.youtube.com/')).toBe('unsupported_path');
    expect(reason('https://www.youtube.com/feed/subscriptions')).toBe('unsupported_path');
    expect(reason('https://www.youtube.com/channel/UC123')).toBe('unsupported_path');
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
      'live_unsupported',
      'invalid_video_id',
    ] as const;
    for (const item of reasons) {
      const message = urlRejectionMessage(item);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain('undefined');
    }
  });
});
