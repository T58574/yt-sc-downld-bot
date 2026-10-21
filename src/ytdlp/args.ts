import type { AppConfig } from '../config.js';

/**
 * Флаги, которые снижают риск блокировок со стороны YouTube.
 * Ничего из этого не обязательно, но для IP дата-центра очень желательно.
 */
export interface YtDlpNetworkOptions {
  /** Netscape-файл cookies: снимает проверки «подтвердите, что вы не робот». */
  cookiesFile?: string;
  /** Пауза между сетевыми запросами, секунды. */
  sleepRequestsSec?: number;
  /** Маскировка под браузер, например `chrome` (в бинарнике yt-dlp есть curl_cffi). */
  impersonate?: string;
  /** Ограничение скорости, например `5M`. */
  limitRate?: string;
}

export function ytdlpNetworkOptions(
  config: Pick<AppConfig, 'ytdlpCookiesFile' | 'ytdlpSleepRequestsSec' | 'ytdlpImpersonate' | 'ytdlpLimitRate'>,
): YtDlpNetworkOptions {
  return {
    ...(config.ytdlpCookiesFile ? { cookiesFile: config.ytdlpCookiesFile } : {}),
    ...(config.ytdlpSleepRequestsSec > 0 ? { sleepRequestsSec: config.ytdlpSleepRequestsSec } : {}),
    ...(config.ytdlpImpersonate ? { impersonate: config.ytdlpImpersonate } : {}),
    ...(config.ytdlpLimitRate ? { limitRate: config.ytdlpLimitRate } : {}),
  };
}

export function networkArgs(options: YtDlpNetworkOptions | undefined): string[] {
  if (!options) return [];
  const args: string[] = [];
  if (options.cookiesFile) args.push('--cookies', options.cookiesFile);
  if (options.sleepRequestsSec && options.sleepRequestsSec > 0) {
    args.push('--sleep-requests', String(options.sleepRequestsSec));
  }
  if (options.impersonate) args.push('--impersonate', options.impersonate);
  if (options.limitRate) args.push('--limit-rate', options.limitRate);
  return args;
}
