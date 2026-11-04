import { describe, expect, it } from 'vitest';
import { normalizeMetadata } from '../src/youtube/metadata-normalize.js';
import { UnsupportedVideoError } from '../src/errors.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    title: 'Rick Astley - Never Gonna Give You Up',
    duration: 213.4,
    uploader: 'Rick Astley',
    formats: [
      { format_id: '137', ext: 'mp4', width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none', filesize: 84934656 },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 3400000 },
    ],
    ...overrides,
  };
}

describe('normalizeMetadata', () => {
  it('приводит ответ yt-dlp к внутреннему виду', () => {
    const metadata = normalizeMetadata(raw(), VIDEO_ID);
    expect(metadata.id).toBe(VIDEO_ID);
    expect(metadata.durationSec).toBe(213);
    expect(metadata.uploader).toBe('Rick Astley');
    expect(metadata.formats).toHaveLength(2);
    expect(metadata.formats[0]).toMatchObject({ formatId: '137', ext: 'mp4', height: 1080 });
    expect(metadata.hasAudio).toBe(true);
  });

  it('выкидывает форматы без id или расширения и мусорные числа', () => {
    const metadata = normalizeMetadata(
      raw({
        formats: [
          { format_id: '18', ext: 'mp4', height: 'bad' },
          { ext: 'mp4' },
          { format_id: '22', ext: 'mp4', height: 720, filesize: -1, tbr: Number.NaN },
          'мусор',
        ],
      }),
      VIDEO_ID,
    );
    expect(metadata.formats.map((entry) => entry.formatId)).toEqual(['18', '22']);
    expect(metadata.formats[0]?.height).toBeUndefined();
    expect(metadata.formats[1]?.filesize).toBeUndefined();
    expect(metadata.formats[1]?.tbr).toBeUndefined();
  });

  it('отклоняет плейлисты, трансляции и чужой ID', () => {
    expect(() => normalizeMetadata(raw({ _type: 'playlist' }), VIDEO_ID)).toThrow(UnsupportedVideoError);
    expect(() => normalizeMetadata(raw({ entries: [{}] }), VIDEO_ID)).toThrow(/playlist/);
    expect(() => normalizeMetadata(raw({ is_live: true }), VIDEO_ID)).toThrow(/трансляции/);
    expect(() => normalizeMetadata(raw({ live_status: 'is_upcoming' }), VIDEO_ID)).toThrow(/трансляции/);
    expect(() => normalizeMetadata(raw({ id: 'aaaaaaaaaaa' }), VIDEO_ID)).toThrow(/ID видео/);
  });

  it('требует непустой список форматов', () => {
    expect(() => normalizeMetadata(raw({ formats: [] }), VIDEO_ID)).toThrow(/форматы/);
    expect(() => normalizeMetadata({ id: VIDEO_ID }, VIDEO_ID)).toThrow(/форматы/);
  });

  it('чистит управляющие символы и обрезает длинные строки', () => {
    const metadata = normalizeMetadata(raw({ title: 'a\u0000b\nc   d', uploader: 'u'.repeat(400) }), VIDEO_ID);
    expect(metadata.title).toBe('a b c d');
    expect(metadata.uploader).toHaveLength(200);
  });

  it('подставляет заголовок, если yt-dlp его не отдал', () => {
    const metadata = normalizeMetadata(raw({ title: null, uploader: null }), VIDEO_ID);
    expect(metadata.title).toBe('YouTube video');
    expect(metadata.uploader).toBeUndefined();
  });

  it('фиксирует отсутствие звука', () => {
    const metadata = normalizeMetadata(raw({ formats: [{ format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none' }] }), VIDEO_ID);
    expect(metadata.hasAudio).toBe(false);
  });

  it('нормализует метаданные без ожидаемого ID (SoundCloud)', () => {
    const metadata = normalizeMetadata(
      raw({
        id: 1396707733,
        title: null,
        formats: [{ format_id: 'hls_aac_96k', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 96 }],
      }),
      undefined,
      'SoundCloud track',
    );
    expect(metadata.id).toBe('1396707733');
    expect(metadata.title).toBe('SoundCloud track');
    expect(metadata.hasAudio).toBe(true);
  });

  it('очищает ID от небезопасных символов и требует непустой ID', () => {
    expect(normalizeMetadata(raw({ id: '../<script>' }), undefined).id).toBe('script');
    expect(() => normalizeMetadata(raw({ id: '///' }), undefined)).toThrow(/ID медиа/);
  });
});
