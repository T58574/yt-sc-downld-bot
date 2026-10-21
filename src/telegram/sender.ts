import type { Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { FileTooLargeError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { MediaSelection, VideoMetadata } from '../types.js';
import type { DownloadedFile } from '../ytdlp/download.js';
import type { MtprotoClient } from './mtproto-client.js';
import { sendMedia } from './send.js';
import { sendMediaViaMtproto } from './send-mtproto.js';

export type UploadTransport = 'bot-api' | 'mtproto';

export interface SendMediaRequest {
  chatId: number;
  file: DownloadedFile;
  metadata: VideoMetadata;
  selection: MediaSelection;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface MediaSender {
  send: (request: SendMediaRequest) => Promise<void>;
}

export interface TransportOptions {
  mtprotoAvailable: boolean;
  thresholdBytes: number;
}

/** Файлы больше порога уходят в MTProto, остальные — в Bot API. */
export function selectTransport(sizeBytes: number, options: TransportOptions): UploadTransport {
  if (!options.mtprotoAvailable) return 'bot-api';
  return sizeBytes > options.thresholdBytes ? 'mtproto' : 'bot-api';
}

export interface MediaSenderOptions {
  api: Api;
  mtproto?: MtprotoClient;
  config: AppConfig;
  logger: Logger;
}

/**
 * Выбирает транспорт отправки: Bot API для мелких файлов, MTProto для крупных.
 * Если MTProto недоступен, а файл не влезает в Bot API — понятная ошибка,
 * а не молчаливое обрезание возможностей.
 */
export function createMediaSender(options: MediaSenderOptions): MediaSender {
  const { api, mtproto, config, logger } = options;

  return {
    async send(request: SendMediaRequest): Promise<void> {
      const sizeBytes = request.file.sizeBytes;
      const transport = selectTransport(sizeBytes, {
        mtprotoAvailable: Boolean(mtproto),
        thresholdBytes: config.mtprotoThresholdBytes,
      });

      if (transport === 'mtproto' && mtproto) {
        logger.info('upload_transport', { transport, sizeBytes });
        await sendMediaViaMtproto({
          client: mtproto.client,
          chatId: request.chatId,
          file: request.file,
          metadata: request.metadata,
          selection: request.selection,
          timeoutMs: config.mtprotoUploadTimeoutMs,
          signal: request.signal,
          ...(request.onProgress ? { onProgress: request.onProgress } : {}),
        });
        return;
      }

      if (sizeBytes > config.botApiUploadLimitBytes) {
        throw new FileTooLargeError(sizeBytes, config.botApiUploadLimitBytes);
      }

      logger.info('upload_transport', { transport, sizeBytes });
      await sendMedia({
        api,
        chatId: request.chatId,
        file: request.file,
        metadata: request.metadata,
        selection: request.selection,
        config,
        signal: request.signal,
      });
    },
  };
}
