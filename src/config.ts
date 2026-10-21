import { dirname, isAbsolute, parse, resolve } from 'node:path';
import type { LogLevel } from './types.js';

const DEFAULT_API_ROOT = 'https://api.telegram.org';
const CLOUD_UPLOAD_LIMIT_MB = 50;
const LOCAL_UPLOAD_LIMIT_MB = 2000;
const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

export interface AppConfig {
  botToken: string;
  allowedIds: ReadonlySet<number>;
  telegramApiRoot: string;
  maxConcurrentDownloads: number;
  maxQueueSize: number;
  progressUpdateIntervalMs: number;
  metadataTimeoutMs: number;
  downloadTimeoutMs: number;
  uploadTimeoutMs: number;
  uploadLimitMb: number;
  uploadLimitBytes: number;
  workDir: string;
  ytdlpBin: string;
  ffmpegBin: string;
  ffprobeBin: string;
  ffmpegLocation?: string;
  logLevel: LogLevel;
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Не задана обязательная переменная ${name}`);
  return value;
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} должна быть целым числом`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} должна быть в диапазоне ${min}..${max}`);
  }
  return value;
}

export function parseAllowedIds(raw: string): Set<number> {
  const ids = new Set<number>();
  for (const part of raw.split(/[\s,;]+/)) {
    if (!part) continue;
    if (!/^\d+$/.test(part)) throw new Error('ALLOWED_TELEGRAM_IDS содержит нечисловой ID');
    const id = Number(part);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('ALLOWED_TELEGRAM_IDS содержит некорректный ID');
    }
    ids.add(id);
  }
  if (ids.size === 0) throw new Error('ALLOWED_TELEGRAM_IDS не может быть пустым');
  return ids;
}

function parseApiRoot(raw: string | undefined): string {
  const value = (raw?.trim() || DEFAULT_API_ROOT).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TELEGRAM_API_ROOT должен быть корректным URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('TELEGRAM_API_ROOT поддерживает только http и https');
  }
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim().toLowerCase() || 'info';
  if (!LOG_LEVELS.has(value)) throw new Error('LOG_LEVEL должен быть debug, info, warn или error');
  return value as LogLevel;
}

function parseWorkDir(raw: string | undefined): string {
  const value = resolve(raw?.trim() || 'data/work');
  if (value === parse(value).root) throw new Error('WORK_DIR не может указывать на корень файловой системы');
  return value;
}

function isCloudApi(apiRoot: string): boolean {
  try {
    return new URL(apiRoot).hostname.toLowerCase() === 'api.telegram.org';
  } catch {
    return false;
  }
}

export function loadConfig(env: Env = process.env): AppConfig {
  const warnings: string[] = [];
  const botToken = required(env, 'BOT_TOKEN');
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw new Error('BOT_TOKEN имеет неожиданный формат');
  }

  const allowedIds = parseAllowedIds(required(env, 'ALLOWED_TELEGRAM_IDS'));
  const telegramApiRoot = parseApiRoot(env.TELEGRAM_API_ROOT);
  const uploadLimitMb = readInt(env, 'TELEGRAM_UPLOAD_LIMIT_MB', CLOUD_UPLOAD_LIMIT_MB, 1, LOCAL_UPLOAD_LIMIT_MB);
  const maxConcurrentDownloads = readInt(env, 'MAX_CONCURRENT_DOWNLOADS', 2, 1, 10);
  const maxQueueSize = readInt(env, 'MAX_QUEUE_SIZE', 20, 1, 200);
  const progressUpdateIntervalMs = readInt(env, 'PROGRESS_UPDATE_INTERVAL_MS', 2000, 1000, 10_000);
  const metadataTimeoutMs = readInt(env, 'METADATA_TIMEOUT_MS', 60_000, 10_000, 300_000);
  const downloadTimeoutMs = readInt(env, 'DOWNLOAD_TIMEOUT_MS', 1_800_000, 60_000, 21_600_000);
  const uploadTimeoutMs = readInt(env, 'UPLOAD_TIMEOUT_MS', 600_000, 60_000, 3_600_000);
  const workDir = parseWorkDir(env.WORK_DIR);
  const ytdlpBin = env.YTDLP_BIN?.trim() || 'yt-dlp';
  const ffmpegBin = env.FFMPEG_BIN?.trim() || 'ffmpeg';
  const ffprobeBin = env.FFPROBE_BIN?.trim() || 'ffprobe';
  const explicitFfmpegLocation = env.FFMPEG_LOCATION?.trim();
  const ffmpegLocation = explicitFfmpegLocation
    ? resolve(explicitFfmpegLocation)
    : isAbsolute(ffmpegBin)
      ? dirname(ffmpegBin)
      : undefined;

  if (isCloudApi(telegramApiRoot) && uploadLimitMb > CLOUD_UPLOAD_LIMIT_MB) {
    warnings.push(
      `TELEGRAM_UPLOAD_LIMIT_MB=${uploadLimitMb}, но облачный Bot API принимает не больше ${CLOUD_UPLOAD_LIMIT_MB} МБ.`,
    );
  }
  if (!isCloudApi(telegramApiRoot) && uploadLimitMb > LOCAL_UPLOAD_LIMIT_MB) {
    warnings.push(`TELEGRAM_UPLOAD_LIMIT_MB не должен превышать ${LOCAL_UPLOAD_LIMIT_MB}.`);
  }
  if (maxConcurrentDownloads >= 4) {
    warnings.push('Несколько параллельных загрузок делят диск и сеть; следите за свободным местом.');
  }

  return {
    botToken,
    allowedIds,
    telegramApiRoot,
    maxConcurrentDownloads,
    maxQueueSize,
    progressUpdateIntervalMs,
    metadataTimeoutMs,
    downloadTimeoutMs,
    uploadTimeoutMs,
    uploadLimitMb,
    uploadLimitBytes: uploadLimitMb * 1024 * 1024,
    workDir,
    ytdlpBin,
    ffmpegBin,
    ffprobeBin,
    ...(ffmpegLocation ? { ffmpegLocation } : {}),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    warnings,
  };
}
