import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import type { LogLevel } from './types.js';

const DEFAULT_API_ROOT = 'https://api.telegram.org';
const CLOUD_UPLOAD_LIMIT_MB = 50;
const LOCAL_UPLOAD_LIMIT_MB = 2000;
/** Через MTProto бот умеет отправлять 4000 частей по 512 КиБ = 2000 МиБ. */
const MTPROTO_UPLOAD_LIMIT_MB = 2000;
const DEFAULT_MTPROTO_UPLOAD_TIMEOUT_MS = 7_200_000;
const DEFAULT_MTPROTO_SESSION_FILE = 'mtproto-session.txt';
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
  botApiUploadLimitBytes: number;
  mtprotoEnabled: boolean;
  mtprotoApiId?: number;
  mtprotoApiHash?: string;
  mtprotoThresholdBytes: number;
  mtprotoSessionFile: string;
  mtprotoUploadTimeoutMs: number;
  workDir: string;
  ytdlpBin: string;
  ffmpegBin: string;
  ffprobeBin: string;
  ffmpegLocation?: string;
  ytdlpCookiesFile?: string;
  ytdlpSleepRequestsSec: number;
  ytdlpImpersonate?: string;
  ytdlpLimitRate?: string;
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

/** api_id с my.telegram.org: целое положительное число. */
function parseApiId(raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error('TELEGRAM_API_ID должен быть положительным числом');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('TELEGRAM_API_ID должен быть положительным числом');
  }
  return parsed;
}

/** api_hash с my.telegram.org: 32 символа. */
function parseApiHash(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!/^[A-Za-z0-9]{32}$/.test(value)) {
    throw new Error('TELEGRAM_API_HASH должен состоять из 32 символов');
  }
  return value;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const warnings: string[] = [];
  const botToken = required(env, 'BOT_TOKEN');
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw new Error('BOT_TOKEN имеет неожиданный формат');
  }

  const allowedIds = parseAllowedIds(required(env, 'ALLOWED_TELEGRAM_IDS'));
  const telegramApiRoot = parseApiRoot(env.TELEGRAM_API_ROOT);

  const apiId = parseApiId(env.TELEGRAM_API_ID);
  const apiHash = parseApiHash(env.TELEGRAM_API_HASH);
  if ((apiId === undefined) !== (apiHash === undefined)) {
    throw new Error('TELEGRAM_API_ID и TELEGRAM_API_HASH нужно задать вместе');
  }
  const mtprotoEnabled = apiId !== undefined && apiHash !== undefined;

  const botApiUploadLimitMb = isCloudApi(telegramApiRoot) ? CLOUD_UPLOAD_LIMIT_MB : LOCAL_UPLOAD_LIMIT_MB;
  const botApiUploadLimitBytes = botApiUploadLimitMb * 1024 * 1024;

  const uploadLimitMb = readInt(
    env,
    'TELEGRAM_UPLOAD_LIMIT_MB',
    mtprotoEnabled ? MTPROTO_UPLOAD_LIMIT_MB : botApiUploadLimitMb,
    1,
    MTPROTO_UPLOAD_LIMIT_MB,
  );
  // Порог по умолчанию — лимит Bot API, но не больше общего лимита отправки.
  const defaultThresholdMb = Math.min(botApiUploadLimitMb, uploadLimitMb);
  const mtprotoThresholdMb = readInt(env, 'MTPROTO_THRESHOLD_MB', defaultThresholdMb, 1, MTPROTO_UPLOAD_LIMIT_MB);
  if (mtprotoEnabled && mtprotoThresholdMb > uploadLimitMb) {
    throw new Error('MTPROTO_THRESHOLD_MB не может превышать TELEGRAM_UPLOAD_LIMIT_MB');
  }
  const mtprotoUploadTimeoutMs = readInt(
    env,
    'MTPROTO_UPLOAD_TIMEOUT_MS',
    DEFAULT_MTPROTO_UPLOAD_TIMEOUT_MS,
    60_000,
    21_600_000,
  );
  const workDir = parseWorkDir(env.WORK_DIR);
  const mtprotoSessionFile = resolve(
    env.MTPROTO_SESSION_FILE?.trim() || join(dirname(workDir), DEFAULT_MTPROTO_SESSION_FILE),
  );
  const maxConcurrentDownloads = readInt(env, 'MAX_CONCURRENT_DOWNLOADS', 2, 1, 10);
  const maxQueueSize = readInt(env, 'MAX_QUEUE_SIZE', 20, 1, 200);
  const progressUpdateIntervalMs = readInt(env, 'PROGRESS_UPDATE_INTERVAL_MS', 2000, 1000, 10_000);
  const metadataTimeoutMs = readInt(env, 'METADATA_TIMEOUT_MS', 60_000, 10_000, 300_000);
  const downloadTimeoutMs = readInt(env, 'DOWNLOAD_TIMEOUT_MS', 1_800_000, 60_000, 21_600_000);
  const uploadTimeoutMs = readInt(env, 'UPLOAD_TIMEOUT_MS', 600_000, 60_000, 3_600_000);
  const ytdlpBin = env.YTDLP_BIN?.trim() || 'yt-dlp';
  const ffmpegBin = env.FFMPEG_BIN?.trim() || 'ffmpeg';
  const ffprobeBin = env.FFPROBE_BIN?.trim() || 'ffprobe';
  const cookiesFile = env.YTDLP_COOKIES_FILE?.trim();
  const impersonate = env.YTDLP_IMPERSONATE?.trim();
  const limitRate = env.YTDLP_LIMIT_RATE?.trim();
  const ytdlpSleepRequestsSec = readInt(env, 'YTDLP_SLEEP_REQUESTS', 1, 0, 60);
  const explicitFfmpegLocation = env.FFMPEG_LOCATION?.trim();
  const ffmpegLocation = explicitFfmpegLocation
    ? resolve(explicitFfmpegLocation)
    : isAbsolute(ffmpegBin)
      ? dirname(ffmpegBin)
      : undefined;

  if (!mtprotoEnabled && uploadLimitMb > botApiUploadLimitMb) {
    warnings.push(
      `TELEGRAM_UPLOAD_LIMIT_MB=${uploadLimitMb}, но Bot API принимает не больше ${botApiUploadLimitMb} МБ.`,
    );
  }
  if (mtprotoEnabled && uploadLimitMb > MTPROTO_UPLOAD_LIMIT_MB) {
    warnings.push(`TELEGRAM_UPLOAD_LIMIT_MB не должен превышать ${MTPROTO_UPLOAD_LIMIT_MB}.`);
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
    botApiUploadLimitBytes,
    mtprotoEnabled,
    ...(apiId !== undefined ? { mtprotoApiId: apiId } : {}),
    ...(apiHash !== undefined ? { mtprotoApiHash: apiHash } : {}),
    mtprotoThresholdBytes: mtprotoThresholdMb * 1024 * 1024,
    mtprotoSessionFile,
    mtprotoUploadTimeoutMs,
    workDir,
    ytdlpBin,
    ffmpegBin,
    ffprobeBin,
    ...(ffmpegLocation ? { ffmpegLocation } : {}),
    ...(cookiesFile ? { ytdlpCookiesFile: resolve(cookiesFile) } : {}),
    ytdlpSleepRequestsSec,
    ...(impersonate ? { ytdlpImpersonate: impersonate } : {}),
    ...(limitRate ? { ytdlpLimitRate: limitRate } : {}),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    warnings,
  };
}

/**
 * Конфиг для режима без MTProto: лимиты урезаются до возможностей Bot API,
 * чтобы бот не обещал пользователю файлы, которые отправить не сможет.
 */
export function withBotApiLimit(config: AppConfig): AppConfig {
  if (config.uploadLimitBytes <= config.botApiUploadLimitBytes) return config;
  return {
    ...config,
    uploadLimitMb: Math.floor(config.botApiUploadLimitBytes / (1024 * 1024)),
    uploadLimitBytes: config.botApiUploadLimitBytes,
    mtprotoThresholdBytes: config.botApiUploadLimitBytes,
  };
}
