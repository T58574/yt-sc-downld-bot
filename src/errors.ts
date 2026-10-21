import { formatBytes } from './format.js';

export type YtDlpFailureKind =
  | 'youtube_blocked'
  | 'unavailable'
  | 'private'
  | 'age_restricted'
  | 'members_only'
  | 'live'
  | 'unsupported'
  | 'format_unavailable'
  | 'too_large'
  | 'rate_limited'
  | 'network'
  | 'conversion'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export class TaskCancelledError extends Error {
  constructor(message = 'Задача отменена') {
    super(message);
    this.name = 'TaskCancelledError';
  }
}

export class ProcessTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Превышено время выполнения: ${timeoutMs} мс`);
    this.name = 'ProcessTimeoutError';
  }
}

export class ToolNotFoundError extends Error {
  constructor(public readonly binary: string) {
    super(`Исполняемый файл не найден: ${binary}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ExternalCommandError extends Error {
  constructor(
    public readonly binary: string,
    public readonly exitCode: number | null,
    public readonly stderrTail: string,
  ) {
    super(`${binary} завершился с кодом ${exitCode ?? 'null'}`);
    this.name = 'ExternalCommandError';
  }
}

export class FileTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limitBytes: number,
    public readonly estimated = false,
  ) {
    super(`Файл ${formatBytes(sizeBytes)} превышает лимит ${formatBytes(limitBytes)}`);
    this.name = 'FileTooLargeError';
  }
}

export class TelegramSendError extends Error {
  constructor(public readonly userMessage: string, cause: unknown) {
    super(userMessage, { cause });
    this.name = 'TelegramSendError';
  }
}

export class UnsupportedVideoError extends Error {
  constructor(
    public readonly kind: 'live' | 'playlist' | 'no_video' | 'no_audio' | 'format_unavailable' | 'invalid_metadata',
    message: string,
  ) {
    super(message);
    this.name = 'UnsupportedVideoError';
  }
}

export class OutputFileMissingError extends Error {
  constructor(expectedExtension: string) {
    super(`yt-dlp не создал ожидаемый файл .${expectedExtension}`);
    this.name = 'OutputFileMissingError';
  }
}

export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function isTaskCancelled(error: unknown): boolean {
  return error instanceof TaskCancelledError;
}

export function classifyYtDlpFailure(stderr: string): YtDlpFailureKind {
  const text = stderr.toLowerCase();
  if (/sign in to confirm|not a bot|confirm you.?re not a bot|use --cookies|cookies-from-browser/.test(text)) {
    return 'youtube_blocked';
  }
  if (/this live event|is live|live event will begin|premieres in/.test(text)) return 'live';
  if (/private video|video is private/.test(text)) return 'private';
  if (/age-restricted|confirm your age|inappropriate for some users/.test(text)) return 'age_restricted';
  if (/members-only|join this channel|channel members/.test(text)) return 'members_only';
  if (/video unavailable|this video is unavailable|has been removed|removed by the uploader/.test(text)) {
    return 'unavailable';
  }
  if (/requested format is not available|format .* is not available|requested downloading of .* not available/.test(text)) {
    return 'format_unavailable';
  }
  if (/file is larger than max-filesize|max-filesize/.test(text)) return 'too_large';
  if (/http error 429|too many requests|rate.?limit/.test(text)) return 'rate_limited';
  if (/unsupported url|is not a valid url|no video formats found/.test(text)) return 'unsupported';
  if (/timed out|timeout|temporary failure|name or service not known|unable to download webpage|connection (?:refused|reset)|network is unreachable|getaddrinfo/.test(text)) {
    return 'network';
  }
  if (/ffmpeg|ffprobe|postprocessing|conversion failed|error while opening decoder|merging formats/.test(text)) {
    return 'conversion';
  }
  return 'unknown';
}

export function ytDlpFailureMessage(kind: YtDlpFailureKind): string {
  switch (kind) {
    case 'youtube_blocked':
      return 'YouTube запросил подтверждение, что запрос делает человек. С серверного IP это иногда требует cookies или PO token; в первой версии авторизация не поддерживается. Попробуйте позже.';
    case 'unavailable':
      return 'Видео недоступно: удалено, скрыто или ограничено автором.';
    case 'private':
      return 'Это приватное видео, скачать его нельзя.';
    case 'age_restricted':
      return 'Видео имеет возрастное ограничение. В первой версии такие видео не поддерживаются.';
    case 'members_only':
      return 'Видео доступно только участникам канала. Скачать его нельзя.';
    case 'live':
      return 'Прямые трансляции не поддерживаются. Дождитесь окончания эфира и пришлите обычную ссылку.';
    case 'unsupported':
      return 'YouTube не отдал видеоформаты для этой ссылки. Проверьте, что это обычное видео, а не трансляция или playlist.';
    case 'format_unavailable':
      return 'Выбранное качество больше недоступно. Пришлите ссылку заново и выберите другой вариант.';
    case 'too_large':
      return 'Файл превышает допустимый размер. Выберите качество ниже.';
    case 'rate_limited':
      return 'YouTube временно ограничил частоту запросов. Подождите несколько минут и попробуйте снова.';
    case 'network':
      return 'Сетевая ошибка при обращении к YouTube. Проверьте соединение на сервере и попробуйте позже.';
    case 'conversion':
      return 'Ошибка конвертации или объединения файла. Попробуйте другое качество; если повторяется — проверьте ffmpeg в логах.';
    case 'timeout':
      return 'Операция заняла слишком много времени и была остановлена. Попробуйте видео короче или качество ниже.';
    case 'cancelled':
      return 'Задача отменена.';
    case 'unknown':
      return 'Не удалось скачать или обработать видео. Попробуйте позже; подробности есть в логах сервера.';
  }
}

export function userMessageForError(error: unknown, uploadLimitBytes: number): string {
  if (error instanceof FileTooLargeError) {
    const prefix = error.estimated ? 'Ожидаемый размер файла' : 'Файл весит';
    return `${prefix} ${formatBytes(error.sizeBytes)}, а Telegram принимает не больше ${formatBytes(uploadLimitBytes)}. Выберите качество ниже или аудио MP3.`;
  }
  if (error instanceof TelegramSendError) return error.userMessage;
  if (error instanceof ProcessTimeoutError) return ytDlpFailureMessage('timeout');
  if (error instanceof ToolNotFoundError) {
    return `На сервере не найден ${error.binary}. Проверьте установку yt-dlp, ffmpeg и ffprobe.`;
  }
  if (error instanceof OutputFileMissingError) {
    return 'После обработки не нашёлся готовый файл. Попробуйте ещё раз или выберите другое качество.';
  }
  if (error instanceof UnsupportedVideoError) {
    if (error.kind === 'live') return ytDlpFailureMessage('live');
    if (error.kind === 'no_video') return 'Для этого видео нет MP4-вариантов. Можно скачать только MP3.';
    if (error.kind === 'no_audio') return 'Для этого видео нет аудиодорожки. MP3 недоступен.';
    if (error.kind === 'format_unavailable') return ytDlpFailureMessage('format_unavailable');
    return 'Не удалось разобрать данные видео. Попробуйте другую ссылку.';
  }
  if (error instanceof ExternalCommandError) {
    return ytDlpFailureMessage(classifyYtDlpFailure(error.stderrTail));
  }
  return ytDlpFailureMessage('unknown');
}

export function describeTelegramError(error: unknown): string {
  const description =
    typeof error === 'object' && error !== null && 'description' in error
      ? String((error as { description?: unknown }).description ?? '')
      : error instanceof Error
        ? error.message
        : String(error);
  if (/too large|entity too large|file is too big|request entity/i.test(description)) {
    return 'Telegram отклонил файл: он больше допустимого размера для Bot API.';
  }
  if (/bot was blocked|chat not found|forbidden/i.test(description)) {
    return 'Telegram не дал отправить файл: бот заблокирован или чат недоступен.';
  }
  if (/timed out|timeout|fetch failed|network|econn|etimedout/i.test(description)) {
    return 'Не удалось отправить файл из-за сетевой ошибки. Попробуйте позже.';
  }
  if (/429|too many requests|retry after/i.test(description)) {
    return 'Telegram временно ограничил отправку сообщений. Попробуйте через минуту.';
  }
  return 'Не удалось отправить файл в Telegram. Подробности есть в логах сервера.';
}
