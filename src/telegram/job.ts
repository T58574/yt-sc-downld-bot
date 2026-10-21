import type { Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { FileTooLargeError, TaskCancelledError, UnsupportedVideoError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { MediaSelection, Task, TaskContext } from '../types.js';
import { createTaskDir, removeTaskDir } from '../files.js';
import { downloadMedia } from '../ytdlp/download.js';
import { fetchVideoMetadata } from '../ytdlp/metadata.js';
import { buildVideoQualities, AUDIO_FORMAT_SELECTOR } from '../youtube/formats.js';
import { sendMedia } from './send.js';

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new TaskCancelledError();
}

export interface DownloadTaskFactoryOptions {
  id: string;
  ownerId: number;
  chatId: number;
  videoId: string;
  selection: MediaSelection;
  config: AppConfig;
  api: Api;
  logger: Logger;
  workRoot: string;
  onMetadata?: (metadata: import('../types.js').VideoMetadata) => void;
}

export function createDownloadTask(options: DownloadTaskFactoryOptions): Task {
  const { id, ownerId, chatId, videoId, selection, config, api, logger, workRoot, onMetadata } = options;
  const label = `${videoId}/${selection.kind === 'audio' ? 'mp3' : `${selection.height}p`}`;

  return {
    id,
    ownerId,
    label,
    run: async (context: TaskContext) => {
      context.report({ stage: 'metadata' });
      const metadata = await fetchVideoMetadata({ config, videoId, signal: context.signal });
      logger.info('metadata_fetched', {
        taskId: id,
        videoId,
        durationSec: metadata.durationSec,
        formats: metadata.formats.length,
      });

      const qualities = buildVideoQualities(metadata, config.uploadLimitBytes);
      let selector: string;
      let expectedStreams = 1;
      if (selection.kind === 'video') {
        const quality = qualities.find((entry) => entry.height === selection.height);
        if (!quality) {
          throw new UnsupportedVideoError('format_unavailable', 'Выбранное качество недоступно');
        }
        if (
          quality.estimateSource === 'reported' &&
          quality.estimatedBytes !== undefined &&
          quality.estimatedBytes > config.uploadLimitBytes
        ) {
          throw new FileTooLargeError(quality.estimatedBytes, config.uploadLimitBytes, true);
        }
        selector = quality.selector;
        expectedStreams = quality.needsAudio ? 2 : 1;
      } else {
        if (!metadata.hasAudio) {
          throw new UnsupportedVideoError('no_audio', 'Нет аудиодорожки');
        }
        selector = AUDIO_FORMAT_SELECTOR;
      }

      throwIfAborted(context.signal);
      const taskDir = await createTaskDir(workRoot);
      logger.info('task_dir_created', { taskId: id, videoId, selection: label });
      try {
        const file = await downloadMedia({
          videoId,
          selection,
          selector,
          workDir: taskDir,
          nodePath: process.execPath,
          ytdlpBin: config.ytdlpBin,
          ...(config.ffmpegLocation ? { ffmpegLocation: config.ffmpegLocation } : {}),
          expectedStreams,
          timeoutMs: config.downloadTimeoutMs,
          signal: context.signal,
          onProgress: context.report,
        });
        throwIfAborted(context.signal);

        if (file.sizeBytes > config.uploadLimitBytes) {
          throw new FileTooLargeError(file.sizeBytes, config.uploadLimitBytes);
        }

        context.report({ stage: 'uploading' });
        await sendMedia({
          api,
          chatId,
          file,
          metadata,
          selection,
          config,
          signal: context.signal,
        });
        logger.info('task_uploaded', { taskId: id, videoId, sizeBytes: file.sizeBytes, extension: file.extension });
      } finally {
        await removeTaskDir(taskDir, workRoot).catch((error: unknown) => {
          logger.warn('task_dir_cleanup_failed', { taskId: id, error });
        });
      }
    },
  };
}
