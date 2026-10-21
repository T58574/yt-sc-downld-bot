import { InputFile, type Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { ProcessTimeoutError, TaskCancelledError, TelegramSendError, describeTelegramError } from '../errors.js';
import { escapeHtml, formatDuration, truncate } from '../format.js';
import type { MediaSelection, VideoMetadata } from '../types.js';
import type { DownloadedFile } from '../ytdlp/download.js';
import { selectionLabel } from './render.js';
import { toTelegramSignal } from './telegram-signal.js';

const CAPTION_ESCAPED_LIMIT = 900;

function safeEscapedText(value: string, maxEscapedLength: number): string {
  let length = Math.min(value.length, maxEscapedLength);
  while (length > 0) {
    const escaped = escapeHtml(value.slice(0, length));
    if (escaped.length <= maxEscapedLength) return escaped;
    length = Math.floor(length * 0.8);
  }
  return '';
}

function buildCaption(metadata: VideoMetadata, selection: MediaSelection): string {
  const title = safeEscapedText(metadata.title, CAPTION_ESCAPED_LIMIT - 60);
  const duration = formatDuration(metadata.durationSec);
  return `<b>${title}</b>\n${escapeHtml(selectionLabel(selection))} · ${duration}`;
}

function findVideoDimensions(metadata: VideoMetadata, height: number): { width?: number; height?: number } {
  const formats = metadata.formats.filter(
    (format) => format.ext === 'mp4' && format.vcodec?.startsWith('avc1') && format.height === height,
  );
  const chosen = formats.find((format) => !format.acodec || format.acodec === 'none') ?? formats[0];
  return { ...(chosen?.width !== undefined ? { width: chosen.width } : {}), ...(chosen?.height !== undefined ? { height: chosen.height } : {}) };
}

export interface SendMediaOptions {
  api: Api;
  chatId: number;
  file: DownloadedFile;
  metadata: VideoMetadata;
  selection: MediaSelection;
  config: Pick<AppConfig, 'uploadTimeoutMs'>;
  signal: AbortSignal;
}

export async function sendMedia(options: SendMediaOptions): Promise<void> {
  const { api, chatId, file, metadata, selection, signal } = options;
  const timeoutSignal = AbortSignal.timeout(options.config.uploadTimeoutMs);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
  const caption = buildCaption(metadata, selection);
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
