import { Api, TelegramClient, client as gram } from 'telegram';
import { ProcessTimeoutError, TaskCancelledError, TelegramSendError } from '../errors.js';
import type { MediaSelection, VideoMetadata } from '../types.js';
import type { DownloadedFile } from '../ytdlp/download.js';
import { audioPerformer, audioTitle, buildMediaCaption, mediaFileName, videoDimensions } from './media-info.js';

/** Частей загружаем параллельно: Telegram просит до 512 КиБ на часть. */
const UPLOAD_WORKERS = 4;

export interface MtprotoSendOptions {
  client: TelegramClient;
  chatId: number;
  file: DownloadedFile;
  metadata: VideoMetadata;
  selection: MediaSelection;
  timeoutMs: number;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}

/** Атрибуты документа: по ним Telegram понимает, что это аудио или видео. */
export function buildMediaAttributes(
  metadata: VideoMetadata,
  selection: MediaSelection,
  fileName: string,
): Api.TypeDocumentAttribute[] {
  const attributes: Api.TypeDocumentAttribute[] = [new Api.DocumentAttributeFilename({ fileName })];
  if (selection.kind === 'audio') {
    const performer = audioPerformer(metadata);
    attributes.push(
      new Api.DocumentAttributeAudio({
        voice: false,
        title: audioTitle(metadata),
        ...(performer ? { performer } : {}),
        duration: Math.round(metadata.durationSec ?? 0),
      }),
    );
    return attributes;
  }
  const { width, height } = videoDimensions(metadata, selection.height);
  attributes.push(
    new Api.DocumentAttributeVideo({
      w: width,
      h: height,
      duration: Math.round(metadata.durationSec ?? 0),
      supportsStreaming: true,
    }),
  );
  return attributes;
}

export function describeMtprotoError(error: unknown): string {
  const text =
    typeof error === 'object' && error !== null && 'errorMessage' in error
      ? String((error as { errorMessage?: unknown }).errorMessage ?? '')
      : error instanceof Error
        ? error.message
        : String(error);
  if (/USER_CANCELED/i.test(text)) return 'Отправка отменена.';
  if (/FILE_PARTS_INVALID|FILE_PART_TOO_BIG|PART_ID_INVALID|FILE_PART_X_MISSING/i.test(text)) {
    return 'Telegram отклонил файл: он больше допустимого размера.';
  }
  if (isAuthFailure(text)) return 'Сессия MTProto отозвана Telegram. Перезапустите бота, чтобы войти заново.';
  if (/FLOOD_WAIT/i.test(text)) return 'Telegram временно ограничил отправку файлов. Попробуйте через минуту.';
  if (/CHAT_WRITE_FORBIDDEN|BOT_BLOCKED|USER_BANNED|CHAT_SEND_FORBIDDEN/i.test(text)) {
    return 'Telegram не дал отправить файл: чат недоступен или бот заблокирован.';
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(text)) {
    return 'Не удалось отправить файл из-за сетевой ошибки. Попробуйте позже.';
  }
  return 'Не удалось отправить файл в Telegram. Подробности есть в логах сервера.';
}

function isAuthFailure(text: string): boolean {
  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|AUTH_KEY_PERM_EMPTY/i.test(text);
}

/**
 * Отправляет файл ботом через MTProto: лимит 2000 МиБ вместо 50 МиБ у Bot API.
 * Отмена и таймаут работают через флаг isCanceled — GramJS проверяет его после
 * каждой загруженной части.
 */
export async function sendMediaViaMtproto(options: MtprotoSendOptions): Promise<void> {
  const { client, chatId, file, metadata, selection, signal, timeoutMs } = options;
  const fileName = mediaFileName(metadata, file.extension);
  const upload = new gram.uploads.CustomFile(fileName, file.sizeBytes, file.path);

  let timedOut = false;
  let lastPercent = -1;
  const progressCallback = Object.assign(
    (progress: number) => {
      const percent = Math.min(100, Math.round(progress * 100));
      if (percent === lastPercent) return;
      lastPercent = percent;
      options.onProgress?.(percent);
    },
    { isCanceled: false },
  );

  const onAbort = (): void => {
    progressCallback.isCanceled = true;
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    progressCallback.isCanceled = true;
  }, timeoutMs);
  timer.unref();

  try {
    await client.sendFile(chatId, {
      file: upload,
      caption: buildMediaCaption(metadata, selection),
      parseMode: 'html',
      attributes: buildMediaAttributes(metadata, selection, fileName),
      forceDocument: false,
      supportsStreaming: selection.kind === 'video',
      workers: UPLOAD_WORKERS,
      progressCallback,
    });
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new TaskCancelledError();
    }
    if (timedOut) throw new ProcessTimeoutError(timeoutMs);
    throw new TelegramSendError(describeMtprotoError(error), error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }

  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new TaskCancelledError();
  }
  if (timedOut) throw new ProcessTimeoutError(timeoutMs);
}
