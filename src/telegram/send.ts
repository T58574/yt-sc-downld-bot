import { InputFile, type Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { ProcessTimeoutError, TaskCancelledError, TelegramSendError, describeTelegramError } from '../errors.js';
import { truncate } from '../format.js';
import type { MediaSelection, VideoMetadata } from '../types.js';
import type { DownloadedFile } from '../ytdlp/download.js';
import { buildMediaCaption, findVideoDimensions } from './media-info.js';
import { toTelegramSignal } from './telegram-signal.js';

export interface SendMediaOptions {
  api: Api;
  chatId: number;
  file: DownloadedFile;
  metadata: VideoMetadata;
  selection: MediaSelection;
  config: Pick<AppConfig, 'uploadTimeoutMs'>;
  signal: AbortSignal;
}

/** Отправка через облачный Bot API: лимит 50 МиБ. */
export async function sendMedia(options: SendMediaOptions): Promise<void> {
  const { api, chatId, file, metadata, selection, signal } = options;
  const timeoutSignal = AbortSignal.timeout(options.config.uploadTimeoutMs);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
  const caption = buildMediaCaption(metadata, selection);
  const input = new InputFile(file.path, `${metadata.id}.${file.extension}`);
  const telegramSignal = toTelegramSignal(combinedSignal);

  try {
    if (selection.kind === 'audio') {
      await api.sendAudio(
        chatId,
        input,
        {
          caption,
          parse_mode: 'HTML',
          title: truncate(metadata.title, 64),
          ...(metadata.uploader ? { performer: truncate(metadata.uploader, 64) } : {}),
          ...(metadata.durationSec !== undefined ? { duration: metadata.durationSec } : {}),
        },
        telegramSignal,
      );
      return;
    }

    const dimensions = findVideoDimensions(metadata, selection.height);
    await api.sendVideo(
      chatId,
      input,
      {
        caption,
        parse_mode: 'HTML',
        supports_streaming: true,
        ...dimensions,
        ...(metadata.durationSec !== undefined ? { duration: metadata.durationSec } : {}),
      },
      telegramSignal,
    );
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new TaskCancelledError();
    }
    if (timeoutSignal.aborted) throw new ProcessTimeoutError(options.config.uploadTimeoutMs);
    throw new TelegramSendError(describeTelegramError(error), error);
  }
}
