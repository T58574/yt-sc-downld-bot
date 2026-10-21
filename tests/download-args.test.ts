import { describe, expect, it } from 'vitest';
import { buildDownloadArgs } from '../src/ytdlp/download.js';
import { buildMetadataArgs } from '../src/ytdlp/metadata.js';
import { AUDIO_FORMAT_SELECTOR, buildVideoQualities, formatSelector } from '../src/youtube/formats.js';
import type { MediaSelection, VideoMetadata } from '../src/types.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const WORK_DIR = '/srv/bot/data/work/job-abc';

function build(selection: MediaSelection, selector = formatSelector(selection)): string[] {
  return buildDownloadArgs({
    videoId: VIDEO_ID,
    selection,
    selector,
    workDir: WORK_DIR,
    nodePath: '/usr/local/bin/node',
    ytdlpBin: 'yt-dlp',
  });
}

describe('buildDownloadArgs', () => {
  it('собирает аргументы для MP3', () => {
    const args = build({ kind: 'audio' }, AUDIO_FORMAT_SELECTOR);
    expect(args).toContain('--extract-audio');
    expect(args).toContain('mp3');
    expect(args).toContain('--audio-quality');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('--ignore-config');
    expect(args[args.indexOf('--format') + 1]).toBe(AUDIO_FORMAT_SELECTOR);
    expect(args[args.length - 1]).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(args).not.toContain('--merge-output-format');
  });

  it('собирает аргументы для MP4 с нужным форматом', () => {
    const args = build({ kind: 'video', height: 720 });
    const formatIndex = args.indexOf('--format');
    expect(args[formatIndex + 1]).toBe(formatSelector({ kind: 'video', height: 720 }));
    expect(args).toContain('--merge-output-format');
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4');
    expect(args).not.toContain('--extract-audio');
  });

  it('привязывает выбор пользователя к конкретному формату с известным размером', () => {
    const metadata: VideoMetadata = {
      id: VIDEO_ID,
      title: 'Test',
      durationSec: 100,
      hasAudio: true,
      formats: [
        { formatId: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, filesize: 80 * 1024 * 1024 },
        { formatId: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128, filesize: 2 * 1024 * 1024 },
      ],
    };
    const quality = buildVideoQualities(metadata, 50 * 1024 * 1024).find((entry) => entry.height === 1080);
    expect(quality?.selector.startsWith('137+bestaudio[ext=m4a]/')).toBe(true);

    const args = build({ kind: 'video', height: 1080 }, quality?.selector ?? '');
    expect(args[args.indexOf('--format') + 1]).toBe(quality?.selector);
  });

  it('держит временные файлы внутри каталога задачи', () => {
    const args = build({ kind: 'audio' }, AUDIO_FORMAT_SELECTOR);
    expect(args[args.indexOf('--paths') + 1]).toBe(`temp:${WORK_DIR}`);
    expect(args[args.indexOf('--output') + 1]).toBe(`${WORK_DIR}/%(id)s.%(ext)s`);
  });

  it('просит у yt-dlp машинный прогресс с id формата', () => {
    const args = build({ kind: 'video', height: 720 });
    const template = args[args.indexOf('--progress-template') + 1];
    expect(template).toContain('PROGRESS|%(progress.status)s');
    expect(template).toContain('%(progress.total_bytes_estimate)s');
    expect(template).toContain('%(info.format_id)s');
    expect(args).toContain('--newline');
  });

  it('передаёт JS runtime для EJS и кастомный ffmpeg', () => {
    const args = buildDownloadArgs({
      videoId: VIDEO_ID,
      selection: { kind: 'audio' },
      selector: AUDIO_FORMAT_SELECTOR,
      workDir: WORK_DIR,
      nodePath: '/opt/node/bin/node',
      ytdlpBin: 'yt-dlp',
      ffmpegLocation: '/opt/ffmpeg/bin',
    });
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:/opt/node/bin/node');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/opt/ffmpeg/bin');
  });

  it('не допускает подстановку shell-команд через ID видео', () => {
    expect(() =>
      buildDownloadArgs({
        videoId: '$(rm -rf /)',
        selection: { kind: 'audio' },
        selector: AUDIO_FORMAT_SELECTOR,
        workDir: WORK_DIR,
        nodePath: '/usr/bin/node',
        ytdlpBin: 'yt-dlp',
      }),
    ).toThrow(/ID видео/);
  });

  it('отклоняет подозрительный селектор формата', () => {
    for (const selector of ['', '  ', 'best; rm -rf /', 'best$(whoami)', 'best\n--exec', 'x'.repeat(600)]) {
      expect(() => build({ kind: 'video', height: 720 }, selector)).toThrow(/селектор/);
    }
  });
});

describe('buildMetadataArgs', () => {
  it('просит JSON без плейлиста и без записи на диск', () => {
    const args = buildMetadataArgs(VIDEO_ID, '/usr/local/bin/node');
    expect(args).toContain('--dump-single-json');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('--no-cache-dir');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:/usr/local/bin/node');
    expect(args[args.length - 1]).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });
});
