import { describe, expect, it } from 'vitest';
import { parseMediaLink } from '../src/links.js';

describe('parseMediaLink', () => {
  it('распознаёт YouTube', () => {
    const result = parseMediaLink('https://youtu.be/dQw4w9WgXcQ');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.provider !== 'youtube') throw new Error('Ожидался YouTube');
    expect(result.value.youtube.videoId).toBe('dQw4w9WgXcQ');
  });

  it('распознаёт SoundCloud', () => {
    const result = parseMediaLink('https://soundcloud.com/vainontop/9ts-x-liverpool-street-in-the-rain-1');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.provider !== 'soundcloud') throw new Error('Ожидался SoundCloud');
    expect(result.value.soundcloud.url).toBe(
      'https://soundcloud.com/vainontop/9ts-x-liverpool-street-in-the-rain-1',
    );
  });

  it('для неверной ссылки SoundCloud отдаёт сообщение про SoundCloud', () => {
    const result = parseMediaLink('https://soundcloud.com/artist/sets/my-set');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Ожидался отказ');
    expect(result.message).toContain('SoundCloud');
  });

  it('для неверной ссылки YouTube отдаёт сообщение про YouTube', () => {
    const result = parseMediaLink('https://youtube.com/playlist?list=PL123');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Ожидался отказ');
    expect(result.message).toContain('Плейлисты');
  });

  it('не принимает чужие хосты', () => {
    const result = parseMediaLink('https://example.com/artist/track');
    expect(result.ok).toBe(false);
  });
});
