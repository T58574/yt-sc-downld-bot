import type { AppConfig } from '../config.js';
import { UnsupportedVideoError } from '../errors.js';
import type { VideoMetadata } from '../types.js';
import { normalizeMetadata } from '../youtube/metadata-normalize.js';
import { networkArgs, ytdlpNetworkOptions, type YtDlpNetworkOptions } from './args.js';
import { runProcess } from './process.js';

function commonMetadataArgs(
  nodePath: string,
  ffmpegLocation?: string,
  network?: YtDlpNetworkOptions,
): string[] {
  return [
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--color',
    'never',
    '--js-runtimes',
    `node:${nodePath}`,
    '--socket-timeout',
    '20',
    '--retries',
    '3',
    '--extractor-retries',
    '2',
    '--no-cache-dir',
    ...networkArgs(network),
    ...(ffmpegLocation ? ['--ffmpeg-location', ffmpegLocation] : []),
  ];
}

export function buildMetadataArgs(
  videoId: string,
  nodePath: string,
  ffmpegLocation?: string,
  network?: YtDlpNetworkOptions,
): string[] {
  return [
    ...commonMetadataArgs(nodePath, ffmpegLocation, network),
    '--dump-single-json',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

/** Тот же запрос метаданных, но по произвольному URL (SoundCloud и т.п.). */
export function buildUrlMetadataArgs(
  url: string,
  nodePath: string,
  ffmpegLocation?: string,
  network?: YtDlpNetworkOptions,
): string[] {
  return [...commonMetadataArgs(nodePath, ffmpegLocation, network), '--dump-single-json', url];
}

function parseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new UnsupportedVideoError('invalid_metadata', 'yt-dlp вернул пустой ответ');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new UnsupportedVideoError('invalid_metadata', 'yt-dlp вернул некорректный JSON');
  }
}

export interface FetchMetadataOptions {
  config: Pick<
    AppConfig,
    | 'ytdlpBin'
    | 'metadataTimeoutMs'
    | 'ffmpegLocation'
    | 'workDir'
    | 'ytdlpCookiesFile'
    | 'ytdlpSleepRequestsSec'
    | 'ytdlpImpersonate'
    | 'ytdlpLimitRate'
  >;
  videoId: string;
  signal?: AbortSignal;
}

export async function fetchVideoMetadata(options: FetchMetadataOptions): Promise<VideoMetadata> {
  const args = buildMetadataArgs(
    options.videoId,
    process.execPath,
    options.config.ffmpegLocation,
    ytdlpNetworkOptions(options.config),
  );
  const result = await runProcess({
    bin: options.config.ytdlpBin,
    args,
    cwd: options.config.workDir,
    timeoutMs: options.config.metadataTimeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    maxStdoutBytes: 32 * 1024 * 1024,
  });
  const raw = parseJson(result.stdout);
  return normalizeMetadata(raw, options.videoId);
}

export interface FetchUrlMetadataOptions {
  config: FetchMetadataOptions['config'];
  url: string;
  signal?: AbortSignal;
  fallbackTitle?: string;
}

/** Метаданные по URL, когда ID заранее неизвестен (SoundCloud). */
export async function fetchUrlMetadata(options: FetchUrlMetadataOptions): Promise<VideoMetadata> {
  const args = buildUrlMetadataArgs(
    options.url,
    process.execPath,
    options.config.ffmpegLocation,
    ytdlpNetworkOptions(options.config),
  );
  const result = await runProcess({
    bin: options.config.ytdlpBin,
    args,
    cwd: options.config.workDir,
    timeoutMs: options.config.metadataTimeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    maxStdoutBytes: 32 * 1024 * 1024,
  });
  const raw = parseJson(result.stdout);
  return normalizeMetadata(raw, undefined, options.fallbackTitle ?? 'SoundCloud track');
}
