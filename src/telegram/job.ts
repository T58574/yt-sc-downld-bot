import type { AppConfig } from '../config.js';
import { FileTooLargeError, TaskCancelledError, UnsupportedVideoError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { MediaSelection, Task, TaskContext, VideoMetadata } from '../types.js';
import { createTaskDir, removeTaskDir } from '../files.js';
import { downloadMedia, downloadSoundCloudAudio } from '../ytdlp/download.js';
import { fetchVideoMetadata } from '../ytdlp/metadata.js';
import { ytdlpNetworkOptions } from '../ytdlp/args.js';
import { buildVideoQualities, AUDIO_FORMAT_SELECTOR } from '../youtube/formats.js';
import type { MediaSender } from './sender.js';

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
  sender: MediaSender;
  logger: Logger;
  workRoot: string;
  onMetadata?: (metadata: VideoMetadata) => void;
}

export function createDownloadTask(options: DownloadTaskFactoryOptions): Task {
  const { id, ownerId, chatId, videoId, selection, config, sender, logger, workRoot, onMetadata } = options;
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
          network: ytdlpNetworkOptions(config),
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
        await sender.send({
          chatId,
          file,
          metadata,
          selection,
          signal: context.signal,
          onProgress: (percent) => {
            context.report({ stage: 'uploading', percent });
          },
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

export interface SoundCloudTaskFactoryOptions {
  id: string;
  ownerId: number;
  chatId: number;
  url: string;
  metadata: VideoMetadata;
  config: AppConfig;
  sender: MediaSender;
  logger: Logger;
  workRoot: string;
}

/**
 * SoundCloud-трек не предлагает выбор формата: сразу качаем аудио и отдаём mp3.
 * Метаданные уже получены в обработчике ссылки, второй запрос к SoundCloud не нужен.
 */
export function createSoundCloudTask(options: SoundCloudTaskFactoryOptions): Task {
  const { id, ownerId, chatId, url, metadata, config, sender, logger, workRoot } = options;
  const selection: MediaSelection = { kind: 'audio' };

  return {
    id,
    ownerId,
    label: `soundcloud/${metadata.id}/mp3`,
    run: async (context: TaskContext) => {
      throwIfAborted(context.signal);
      const taskDir = await createTaskDir(workRoot);
      logger.info('soundcloud_task_dir_created', { taskId: id, trackId: metadata.id });
      try {
        const file = await downloadSoundCloudAudio({
          url,
          workDir: taskDir,
          nodePath: process.execPath,
          ytdlpBin: config.ytdlpBin,
          ...(config.ffmpegLocation ? { ffmpegLocation: config.ffmpegLocation } : {}),
          network: ytdlpNetworkOptions(config),
          timeoutMs: config.downloadTimeoutMs,
          signal: context.signal,
          onProgress: context.report,
        });
        throwIfAborted(context.signal);

        if (file.sizeBytes > config.uploadLimitBytes) {
          throw new FileTooLargeError(file.sizeBytes, config.uploadLimitBytes);
        }

        context.report({ stage: 'uploading' });
        await sender.send({
          chatId,
          file,
          metadata,
          selection,
          signal: context.signal,
          onProgress: (percent) => {
            context.report({ stage: 'uploading', percent });
          },
        });
        logger.info('soundcloud_task_uploaded', {
          taskId: id,
          trackId: metadata.id,
          sizeBytes: file.sizeBytes,
        });
      } finally {
        await removeTaskDir(taskDir, workRoot).catch((error: unknown) => {
          logger.warn('task_dir_cleanup_failed', { taskId: id, error });
        });
      }
    },
  };
}
