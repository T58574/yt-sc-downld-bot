import { describe, expect, it } from 'vitest';
import { buildVideoQualities, formatSelector, hasDownloadableAudio, qualityLabel } from '../src/youtube/formats.js';
import type { MediaFormat, VideoMetadata } from '../src/types.js';

const MIB = 1024 * 1024;

function format(partial: Partial<MediaFormat> & { formatId: string; ext: string }): MediaFormat {
  return partial;
}

function metadata(formats: MediaFormat[]): VideoMetadata {
  return {
    id: 'dQw4w9WgXcQ',
    title: 'Test',
    formats,
    hasAudio: formats.some((entry) => entry.acodec !== undefined && entry.acodec !== 'none'),
  };
}

const audioM4a = format({ formatId: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128, filesize: 2 * MIB });

describe('buildVideoQualities', () => {
  it('берёт только mp4 с H.264 и сортирует по убыванию высоты', () => {
    const qualities = buildVideoQualities(
      metadata([
        format({ formatId: '137', ext: 'mp4', vcodec: 'avc1.640028', height: 1080, filesize: 80 * MIB }),
        format({ formatId: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, filesize: 12 * MIB }),
        format({ formatId: '248', ext: 'webm', vcodec: 'vp9', height: 1080 }),
        format({ formatId: '313', ext: 'webm', vcodec: 'vp09.00.50.08', height: 2160 }),
        audioM4a,
      ]),
      50 * MIB,
    );
    expect(qualities.map((entry) => entry.height)).toEqual([1080, 360]);
    expect(qualities[0]?.estimatedBytes).toBe(82 * MIB);
    expect(qualities[0]?.exceedsLimit).toBe(true);
    expect(qualities[1]?.exceedsLimit).toBe(false);
  });

  it('предпочитает video-only формат и добавляет аудио к оценке', () => {
    const qualities = buildVideoQualities(
      metadata([
        format({ formatId: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, filesize: 12 * MIB }),
        format({ formatId: '134', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 360, filesize: 10 * MIB }),
        audioM4a,
      ]),
      100 * MIB,
    );
    expect(qualities).toHaveLength(1);
    expect(qualities[0]?.estimatedBytes).toBe(12 * MIB);
  });

  it('не придумывает размер, если метаданных нет', () => {
    const qualities = buildVideoQualities(
      metadata([format({ formatId: '134', ext: 'mp4', vcodec: 'avc1', height: 480, acodec: 'none' })]),
      50 * MIB,
    );
    expect(qualities[0]?.estimatedBytes).toBeUndefined();
    expect(qualities[0]?.estimateSource).toBeUndefined();
    expect(qualities[0]?.exceedsLimit).toBe(false);
    expect(qualityLabel(qualities[0]!)).toBe('480p');
  });

  it('оценивает размер по битрейту, если YouTube не отдал filesize', () => {
    const qualities = buildVideoQualities(
      {
        id: 'dQw4w9WgXcQ',
        title: 'Test',
        durationSec: 100,
        hasAudio: true,
        formats: [
          format({ formatId: '230', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 360, tbr: 800 }),
          format({ formatId: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128 }),
        ],
      },
      50 * MIB,
    );
    expect(qualities[0]?.estimateSource).toBe('bitrate');
    expect(qualities[0]?.estimatedBytes).toBe(11_600_000);
    expect(qualities[0]?.exceedsLimit).toBe(false);
    expect(qualityLabel(qualities[0]!)).toContain('~11 МиБ');
  });

  it('без длительности не оценивает размер по битрейту', () => {
    const qualities = buildVideoQualities(
      metadata([format({ formatId: '230', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 360, tbr: 800 })]),
      50 * MIB,
    );
    expect(qualities[0]?.estimatedBytes).toBeUndefined();
    expect(qualities[0]?.exceedsLimit).toBe(false);
  });

  it('привязывает каждый вариант к конкретному формату', () => {
    const qualities = buildVideoQualities(
      metadata([
        format({ formatId: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, filesize: 80 * MIB }),
        format({ formatId: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a.40.2', height: 360, filesize: 12 * MIB }),
        audioM4a,
      ]),
      200 * MIB,
    );
    const hd = qualities.find((entry) => entry.height === 1080);
    const sd = qualities.find((entry) => entry.height === 360);
    expect(hd?.selector.startsWith('137+bestaudio[ext=m4a]/bestvideo[height=1080]')).toBe(true);
    expect(sd?.selector.startsWith('18/bestvideo[height=360]')).toBe(true);
    expect(hd?.estimateSource).toBe('reported');
    expect(hd?.needsAudio).toBe(true);
    expect(sd?.needsAudio).toBe(false);
  });

  it('ограничивает список восемью вариантами', () => {
    const formats = Array.from({ length: 12 }, (_, index) =>
      format({ formatId: String(index), ext: 'mp4', vcodec: 'avc1', height: 100 + index * 10, filesize: MIB }),
    );
    const qualities = buildVideoQualities(metadata([...formats, audioM4a]), 50 * MIB);
    expect(qualities).toHaveLength(8);
    expect(qualities[0]?.height).toBe(210);
  });

  it('помечает превышение лимита и в подписи кнопки', () => {
    const formats = [
      format({ formatId: '137', ext: 'mp4', vcodec: 'avc1', height: 1080, filesize: 90 * MIB }),
      audioM4a,
    ];
    const qualities = buildVideoQualities(metadata(formats), 50 * MIB);
    expect(qualities[0]?.estimatedBytes).toBe(92 * MIB);
    expect(qualityLabel(qualities[0]!)).toContain('⚠️');
  });
});

describe('hasDownloadableAudio', () => {
  it('видит аудиодорожку', () => {
    expect(hasDownloadableAudio(metadata([audioM4a]))).toBe(true);
    expect(hasDownloadableAudio(metadata([format({ formatId: '134', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 480 })]))).toBe(
      false,
    );
  });
});

describe('formatSelector', () => {
  it('для аудио берёт m4a и не падает на отказе', () => {
    expect(formatSelector({ kind: 'audio' })).toBe('bestaudio[ext=m4a]/bestaudio/best');
  });

  it('для видео фиксирует H.264 и m4a с запасными вариантами', () => {
    const selector = formatSelector({ kind: 'video', height: 720 });
    expect(selector.split('/')[0]).toBe('bestvideo[height=720][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]');
    expect(selector).toContain('best[height<=720][ext=mp4]');
  });

  it('отклоняет некорректную высоту', () => {
    expect(() => formatSelector({ kind: 'video', height: 0 })).toThrow();
    expect(() => formatSelector({ kind: 'video', height: 5000 })).toThrow();
    expect(() => formatSelector({ kind: 'video', height: 720.5 })).toThrow();
  });
});
