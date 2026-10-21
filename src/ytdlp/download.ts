import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaSelection, ProgressUpdate } from '../types.js';
import { OutputFileMissingError } from '../errors.js';
import { findOutputFile } from '../files.js';
import { runProcess } from './process.js';
import { parseYtDlpLine } from './progress.js';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SELECTOR_PATTERN = /^[-a-zA-Z0-9_<>=^.,:\[\]()+*/|]+$/;
const MAX_SELECTOR_LENGTH = 512;
const PROGRESS_TEMPLATE =
  'download:PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s';

interface StreamProgress {
  downloaded: number;
  total?: number;
  estimatedTotal?: number;
}

/**
 * Сводит прогресс нескольких потоков (видео + аудио) в один процент:
 * иначе после завершения видео счётчик снова падает к нулю на аудио.
 *
 * Проценты считаются только по достоверным total_bytes всех ожидаемых потоков.
 * Если у какого-то потока точного размера нет (или он ещё не начался), отдаём
 * байты без процентов; total_bytes_estimate идёт отдельным полем и никогда
 * не превращается в проценты.
 */
export function createProgressAggregator(expectedStreams = 1): (update: ProgressUpdate) => ProgressUpdate {
  const streams = new Map<string, StreamProgress>();

  return (update) => {
    if (update.stage !== 'downloading' || update.formatId === undefined) return update;
    const stream = streams.get(update.formatId) ?? { downloaded: 0 };
    if (update.downloadedBytes !== undefined) {
      stream.downloaded = Math.max(stream.downloaded, update.downloadedBytes);
    }
    if (update.totalBytes !== undefined) {
      stream.total = Math.max(stream.total ?? 0, update.totalBytes);
    }
    if (stream.total !== undefined) {
      stream.total = Math.max(stream.total, stream.downloaded);
    } else if (update.percent === 100) {
      // Строка finished без total_bytes: фактический размер потока = скачанное.
      stream.total = stream.downloaded;
    }
    if (stream.total === undefined && update.estimatedTotalBytes !== undefined) {
      stream.estimatedTotal = Math.max(stream.estimatedTotal ?? 0, update.estimatedTotalBytes);
    }
    streams.set(update.formatId, stream);

    let downloaded = 0;
    let total = 0;
    let estimatedTotal = 0;
    let totalsKnown = true;
    let estimatesKnown = true;
    for (const entry of streams.values()) {
      downloaded += entry.downloaded;
      if (entry.total === undefined) {
        totalsKnown = false;
      } else {
        total += entry.total;
      }
      const estimated = entry.total ?? entry.estimatedTotal;
      if (estimated === undefined) {
        estimatesKnown = false;
      } else {
        estimatedTotal += estimated;
      }
    }

    const extra = {
      ...(update.speedBps !== undefined ? { speedBps: update.speedBps } : {}),
      ...(update.etaSec !== undefined ? { etaSec: update.etaSec } : {}),
      formatId: update.formatId,
    };

    if (totalsKnown && streams.size >= expectedStreams && total > 0) {
      return {
        stage: 'downloading',
        percent: Math.min(100, (downloaded / total) * 100),
        downloadedBytes: downloaded,
        totalBytes: total,
        ...extra,
      };
    }
    return {
      stage: 'downloading',
      downloadedBytes: downloaded,
      ...(!totalsKnown && estimatesKnown && estimatedTotal > 0
        ? { estimatedTotalBytes: Math.max(estimatedTotal, downloaded) }
        : {}),
      ...extra,
    };
  };
}

export interface BuildDownloadArgsOptions {
  videoId: string;
  selection: MediaSelection;
  selector: string;
  workDir: string;
  nodePath: string;
  ytdlpBin: string;
  ffmpegLocation?: string;
}

export function buildDownloadArgs(options: BuildDownloadArgsOptions): string[] {
  if (!VIDEO_ID_PATTERN.test(options.videoId)) throw new Error('Некорректный ID видео');
  if (!options.selector || options.selector.length > MAX_SELECTOR_LENGTH || !SELECTOR_PATTERN.test(options.selector)) {
    throw new Error('Некорректный селектор формата');
  }
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--color',
    'never',
    '--newline',
    '--no-cache-dir',
    '--no-mtime',
    '--restrict-filenames',
    '--trim-filenames',
    '90',
    '--js-runtimes',
    `node:${options.nodePath}`,
    '--socket-timeout',
    '20',
    '--retries',
    '5',
    '--fragment-retries',
    '5',
    '--extractor-retries',
    '2',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--paths',
    `temp:${options.workDir}`,
    '--output',
    join(options.workDir, '%(id)s.%(ext)s'),
    ...(options.ffmpegLocation ? ['--ffmpeg-location', options.ffmpegLocation] : []),
  ];

  if (options.selection.kind === 'audio') {
    args.push('--format', options.selector, '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('--format', options.selector, '--merge-output-format', 'mp4');
  }

  args.push(`https://www.youtube.com/watch?v=${options.videoId}`);
  return args;
}

export interface DownloadMediaOptions extends BuildDownloadArgsOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /**
   * Сколько потоков скачает yt-dlp: 2 для «видео-онли + аудио», иначе 1.
   * Нужно, чтобы не показывать 100% после завершения видео, пока не началось аудио.
   */
  expectedStreams?: number;
  onProgress: (update: ProgressUpdate) => void;
}

export interface DownloadedFile {
  path: string;
  sizeBytes: number;
  extension: 'mp3' | 'mp4';
}

export async function downloadMedia(options: DownloadMediaOptions): Promise<DownloadedFile> {
  const extension = options.selection.kind === 'audio' ? 'mp3' : 'mp4';
  const args = buildDownloadArgs(options);
  const aggregate = createProgressAggregator(options.expectedStreams ?? 1);
  options.onProgress({ stage: 'downloading' });

  await runProcess({
    bin: options.ytdlpBin,
    args,
    cwd: options.workDir,
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    onLine: (line) => {
      const update = parseYtDlpLine(line);
      if (update) options.onProgress(aggregate(update));
    },
    maxStdoutBytes: 4 * 1024 * 1024,
  });

  const outputPath = await findOutputFile(options.workDir, extension);
  if (!outputPath) throw new OutputFileMissingError(extension);
  const info = await stat(outputPath);
  return { path: outputPath, sizeBytes: info.size, extension };
}
