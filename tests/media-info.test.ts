import { describe, expect, it } from 'vitest';
import { Api } from 'telegram';
import { audioPerformer, audioTitle, buildMediaCaption, findVideoDimensions, videoDimensions } from '../src/telegram/media-info.js';
import { buildMediaAttributes } from '../src/telegram/send-mtproto.js';
import type { VideoMetadata } from '../src/types.js';

const metadata: VideoMetadata = {
  id: 'dQw4w9WgXcQ',
  title: 'Тестовое видео',
  durationSec: 125,
  uploader: 'Канал',
  formats: [
    { formatId: '137', ext: 'mp4', width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
    { formatId: '140', ext: 'm4a', acodec: 'mp4a.40.2' },
  ],
  hasAudio: true,
};

describe('buildMediaCaption', () => {
  it('экранирует заголовок и добавляет формат с длительностью', () => {
    const caption = buildMediaCaption({ ...metadata, title: '<b>жирный</b>' }, { kind: 'video', height: 1080 });
    expect(caption).toContain('&lt;b&gt;жирный&lt;/b&gt;');
    expect(caption).toContain('MP4 1080p');
    expect(caption).toContain('2:05');
  });
});

describe('размеры видео', () => {
  it('берёт размеры из метаданных', () => {
    expect(findVideoDimensions(metadata, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('подставляет 16:9, если формат неизвестен', () => {
    expect(videoDimensions({ ...metadata, formats: [] }, 720)).toEqual({ width: 1280, height: 720 });
  });
});

describe('buildMediaAttributes', () => {
  it('для видео добавляет атрибут видео с размерами и стримингом', () => {
    const attributes = buildMediaAttributes(metadata, { kind: 'video', height: 1080 }, 'dQw4w9WgXcQ.mp4');
    const video = attributes.find((item) => item instanceof Api.DocumentAttributeVideo) as Api.DocumentAttributeVideo;
    expect(video.w).toBe(1920);
    expect(video.h).toBe(1080);
    expect(video.duration).toBe(125);
    expect(video.supportsStreaming).toBe(true);
    expect(attributes[0]).toBeInstanceOf(Api.DocumentAttributeFilename);
  });

  it('для аудио добавляет атрибут аудио с названием и исполнителем', () => {
    const attributes = buildMediaAttributes(metadata, { kind: 'audio' }, 'dQw4w9WgXcQ.mp3');
    const audio = attributes.find((item) => item instanceof Api.DocumentAttributeAudio) as Api.DocumentAttributeAudio;
    expect(audio.voice).toBe(false);
    expect(audio.title).toBe('Тестовое видео');
    expect(audio.performer).toBe('Канал');
    expect(audio.duration).toBe(125);
  });

  it('обрезает длинные названия и пропускает пустого исполнителя', () => {
    const long: VideoMetadata = { ...metadata, title: 'x'.repeat(200), uploader: undefined };
    expect(audioTitle(long)).toHaveLength(64);
    expect(audioPerformer(long)).toBeUndefined();
  });
});
