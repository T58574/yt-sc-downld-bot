import { describe, expect, it } from 'vitest';
import { loadConfig, parseAllowedIds } from '../src/config.js';

const TOKEN = `123456789:${'A'.repeat(35)}`;

function env(overrides: Record<string, string | undefined> = {}) {
  return { BOT_TOKEN: TOKEN, ALLOWED_TELEGRAM_IDS: '111', ...overrides };
}

describe('parseAllowedIds', () => {
  it('принимает несколько ID через любые разделители', () => {
    expect([...parseAllowedIds('111,222 333;444')]).toEqual([111, 222, 333, 444]);
    expect([...parseAllowedIds(' 555 ')].length).toBe(1);
  });

  it('отклоняет мусор и пустой список', () => {
    expect(() => parseAllowedIds('111,abc')).toThrow(/нечисловой/);
    expect(() => parseAllowedIds('0')).toThrow(/некорректный/);
    expect(() => parseAllowedIds('-5')).toThrow(/нечисловой/);
    expect(() => parseAllowedIds('  ')).toThrow(/пустым/);
  });
});

describe('loadConfig', () => {
  it('подставляет безопасные значения по умолчанию', () => {
    const config = loadConfig(env());
    expect(config.telegramApiRoot).toBe('https://api.telegram.org');
    expect(config.uploadLimitMb).toBe(50);
    expect(config.uploadLimitBytes).toBe(50 * 1024 * 1024);
    expect(config.maxConcurrentDownloads).toBe(2);
    expect(config.maxQueueSize).toBe(20);
    expect(config.progressUpdateIntervalMs).toBe(2000);
    expect(config.downloadTimeoutMs).toBe(1_800_000);
    expect(config.ytdlpBin).toBe('yt-dlp');
    expect(config.ffmpegBin).toBe('ffmpeg');
    expect(config.logLevel).toBe('info');
    expect(config.warnings).toEqual([]);
  });

  it('требует корректный токен и список доступа', () => {
    expect(() => loadConfig(env({ BOT_TOKEN: undefined }))).toThrow(/BOT_TOKEN/);
    expect(() => loadConfig(env({ BOT_TOKEN: 'no-token' }))).toThrow(/формат/);
    expect(() => loadConfig(env({ ALLOWED_TELEGRAM_IDS: undefined }))).toThrow(/ALLOWED_TELEGRAM_IDS/);
  });

  it('читает переопределения из окружения', () => {
    const config = loadConfig(
      env({
        TELEGRAM_API_ROOT: 'http://127.0.0.1:8081/',
        TELEGRAM_UPLOAD_LIMIT_MB: '2000',
        MAX_CONCURRENT_DOWNLOADS: '4',
        MAX_QUEUE_SIZE: '5',
        LOG_LEVEL: 'debug',
        WORK_DIR: 'data/custom',
        YTDLP_BIN: '/opt/yt-dlp/yt-dlp',
        FFMPEG_BIN: '/opt/ffmpeg/bin/ffmpeg',
        FFMPEG_LOCATION: '/opt/ffmpeg/bin',
      }),
    );
    expect(config.telegramApiRoot).toBe('http://127.0.0.1:8081');
    expect(config.uploadLimitMb).toBe(2000);
    expect(config.maxConcurrentDownloads).toBe(4);
    expect(config.maxQueueSize).toBe(5);
    expect(config.logLevel).toBe('debug');
    expect(config.workDir.endsWith('data/custom')).toBe(true);
    expect(config.ffmpegLocation).toBe('/opt/ffmpeg/bin');
  });

  it('выводит каталог ffmpeg из абсолютного пути к бинарнику', () => {
    const config = loadConfig(env({ FFMPEG_BIN: '/opt/ffmpeg/bin/ffmpeg' }));
    expect(config.ffmpegLocation).toBe('/opt/ffmpeg/bin');
  });

  it('проверяет числовые переменные', () => {
    expect(() => loadConfig(env({ MAX_CONCURRENT_DOWNLOADS: 'abc' }))).toThrow(/целым числом/);
    expect(() => loadConfig(env({ MAX_CONCURRENT_DOWNLOADS: '0' }))).toThrow(/диапазоне/);
    expect(() => loadConfig(env({ TELEGRAM_UPLOAD_LIMIT_MB: '9999' }))).toThrow(/диапазоне/);
    expect(() => loadConfig(env({ LOG_LEVEL: 'verbose' }))).toThrow(/LOG_LEVEL/);
  });

  it('отклоняет некорректный API root и корень файловой системы как WORK_DIR', () => {
    expect(() => loadConfig(env({ TELEGRAM_API_ROOT: 'ftp://api.telegram.org' }))).toThrow(/http/);
    expect(() => loadConfig(env({ TELEGRAM_API_ROOT: 'not a url' }))).toThrow(/URL/);
    expect(() => loadConfig(env({ WORK_DIR: '/' }))).toThrow(/корень/);
  });

  it('предупреждает о лимитах и параллельности', () => {
    expect(loadConfig(env({ TELEGRAM_UPLOAD_LIMIT_MB: '2000' })).warnings.join(' ')).toContain('50');
    expect(loadConfig(env({ MAX_CONCURRENT_DOWNLOADS: '4' })).warnings.join(' ')).toContain('параллельных');
    expect(loadConfig(env({ TELEGRAM_API_ROOT: 'http://127.0.0.1:8081', TELEGRAM_UPLOAD_LIMIT_MB: '1900' })).warnings).toEqual([]);
  });

  it('требует api_id и api_hash вместе', () => {
    expect(() => loadConfig(env({ TELEGRAM_API_ID: '123456' }))).toThrow(/вместе/);
    expect(() => loadConfig(env({ TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef' }))).toThrow(/вместе/);
    expect(() => loadConfig(env({ TELEGRAM_API_ID: 'abc', TELEGRAM_API_HASH: 'x'.repeat(32) }))).toThrow(/числом/);
    expect(() => loadConfig(env({ TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'short' }))).toThrow(/32/);
  });

  it('с MTProto поднимает лимит отправки до 2000 МиБ', () => {
    const config = loadConfig(
      env({ TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef' }),
    );
    expect(config.mtprotoEnabled).toBe(true);
    expect(config.mtprotoApiId).toBe(123456);
    expect(config.uploadLimitMb).toBe(2000);
    expect(config.uploadLimitBytes).toBe(2000 * 1024 * 1024);
    expect(config.botApiUploadLimitBytes).toBe(50 * 1024 * 1024);
    expect(config.mtprotoThresholdBytes).toBe(50 * 1024 * 1024);
    expect(config.mtprotoSessionFile.endsWith('data/mtproto-session.txt')).toBe(true);
    expect(config.warnings).toEqual([]);
  });

  it('без MTProto лимит остаётся облачным', () => {
    const config = loadConfig(env());
    expect(config.mtprotoEnabled).toBe(false);
    expect(config.uploadLimitMb).toBe(50);
    expect(config.botApiUploadLimitBytes).toBe(50 * 1024 * 1024);
  });

  it('порог MTProto не может превышать общий лимит', () => {
    const api = { TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef' };
    expect(() => loadConfig(env({ ...api, TELEGRAM_UPLOAD_LIMIT_MB: '100', MTPROTO_THRESHOLD_MB: '500' }))).toThrow(
      /MTPROTO_THRESHOLD_MB/,
    );
    const config = loadConfig(env({ ...api, MTPROTO_THRESHOLD_MB: '10' }));
    expect(config.mtprotoThresholdBytes).toBe(10 * 1024 * 1024);
  });

  it('порог по умолчанию не превышает общий лимит', () => {
    const api = { TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef' };
    const config = loadConfig(
      env({ ...api, TELEGRAM_API_ROOT: 'http://127.0.0.1:8081', TELEGRAM_UPLOAD_LIMIT_MB: '50' }),
    );
    expect(config.mtprotoThresholdBytes).toBe(50 * 1024 * 1024);
    expect(config.uploadLimitMb).toBe(50);
  });

  it('локальный Bot API поднимает лимит Bot API до 2000 МиБ', () => {
    const config = loadConfig(env({ TELEGRAM_API_ROOT: 'http://127.0.0.1:8081' }));
    expect(config.botApiUploadLimitBytes).toBe(2000 * 1024 * 1024);
    expect(config.uploadLimitMb).toBe(2000);
    expect(config.warnings).toEqual([]);
  });

  it('настройки защиты YouTube читаются из окружения', () => {
    const config = loadConfig(
      env({
        YTDLP_COOKIES_FILE: '/etc/yt/cookies.txt',
        YTDLP_SLEEP_REQUESTS: '2',
        YTDLP_IMPERSONATE: 'chrome',
        YTDLP_LIMIT_RATE: '5M',
      }),
    );
    expect(config.ytdlpCookiesFile).toBe('/etc/yt/cookies.txt');
    expect(config.ytdlpSleepRequestsSec).toBe(2);
    expect(config.ytdlpImpersonate).toBe('chrome');
    expect(config.ytdlpLimitRate).toBe('5M');
  });

  it('по умолчанию пауза между запросами секунда, остальное выключено', () => {
    const config = loadConfig(env());
    expect(config.ytdlpSleepRequestsSec).toBe(1);
    expect(config.ytdlpCookiesFile).toBeUndefined();
    expect(config.ytdlpImpersonate).toBeUndefined();
    expect(config.ytdlpLimitRate).toBeUndefined();
  });
});
