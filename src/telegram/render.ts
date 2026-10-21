import { InlineKeyboard } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import type { MediaSelection, ProgressUpdate, VideoMetadata, VideoQuality } from '../types.js';
import { escapeHtml, formatBytes, formatDuration, formatEta, formatSpeed, truncate } from '../format.js';
import { qualityLabel } from '../youtube/formats.js';
import { cancelCallbackData, formatCallbackData } from './callbacks.js';

const TITLE_DISPLAY_LENGTH = 120;

export const QUEUE_FULL_MESSAGE = 'Очередь заполнена. Дождитесь завершения текущих задач и пришлите ссылку снова.';

function titleHeader(metadata: VideoMetadata | undefined): string {
  return metadata ? `<b>${escapeHtml(truncate(metadata.title, TITLE_DISPLAY_LENGTH))}</b>` : '<b>YouTube</b>';
}

export function selectionLabel(selection: MediaSelection): string {
  return selection.kind === 'audio' ? 'MP3' : `MP4 ${selection.height}p`;
}

export function renderVideoInfo(
  metadata: VideoMetadata,
  qualities: VideoQuality[],
  hasAudio: boolean,
  hadPlaylistParam: boolean,
  uploadLimitBytes: number,
): string {
  const lines = [
    `<b>${escapeHtml(truncate(metadata.title, TITLE_DISPLAY_LENGTH))}</b>`,
    `Канал: ${escapeHtml(truncate(metadata.uploader ?? 'неизвестен', 80))}`,
    `Длительность: ${formatDuration(metadata.durationSec)}`,
    '',
    'Выберите формат:',
  ];
  if (hasAudio) lines.push('🎵 MP3 — только аудио');
  if (qualities.length > 0) lines.push('🎬 MP4 — H.264/AAC, варианты качества кнопками ниже');
  else lines.push('MP4-варианты H.264 для этого видео недоступны.');
  if (qualities.some((quality) => quality.exceedsLimit)) {
    lines.push('', `⚠️ Варианты с пометкой могут не пройти по лимиту Telegram (${formatBytes(uploadLimitBytes)}).`);
  }
  if (hadPlaylistParam) lines.push('', 'ℹ️ В ссылке был параметр playlist — скачаю только это видео.');
  return lines.join('\n');
}

export function formatSelectionKeyboard(
  videoId: string,
  qualities: VideoQuality[],
  hasAudio: boolean,
): InlineKeyboard {
  const rows: InlineKeyboardButton[][] = [];
  if (hasAudio) {
    rows.push([{ text: '🎵 MP3', callback_data: formatCallbackData(videoId, { kind: 'audio' }) }]);
  }
  for (let index = 0; index < qualities.length; index += 2) {
    rows.push(
      qualities.slice(index, index + 2).map((quality) => ({
        text: `🎬 ${qualityLabel(quality)}`,
        callback_data: formatCallbackData(videoId, { kind: 'video', height: quality.height }),
      })),
    );
  }
  return InlineKeyboard.from(rows);
}
export function cancelKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard().text('⛔ Отмена', cancelCallbackData(taskId));
}

function renderStage(update: ProgressUpdate, selection: MediaSelection): string {
  switch (update.stage) {
    case 'queued':
      return `⏳ В очереди${update.queuePosition ? ` · позиция ${update.queuePosition}` : ''}`;
    case 'metadata':
      return '🔎 Получаю информацию о видео…';
    case 'downloading': {
      const percent = update.percent === undefined ? undefined : `${update.percent.toFixed(1)}%`;
      const bytes =
        update.totalBytes !== undefined
          ? `${formatBytes(update.downloadedBytes)} из ${formatBytes(update.totalBytes)}`
          : update.estimatedTotalBytes !== undefined
            ? `Скачано ${formatBytes(update.downloadedBytes)} из ~${formatBytes(update.estimatedTotalBytes)}`
            : update.downloadedBytes !== undefined
              ? `Скачано ${formatBytes(update.downloadedBytes)}`
              : undefined;
      const speed = formatSpeed(update.speedBps);
      const eta = formatEta(update.etaSec);
      const details = [percent, bytes, speed, eta ? `осталось ${eta}` : undefined].filter(Boolean).join(' · ');
      return `⬇️ Скачивание${details ? ` · ${details}` : '…'}`;
    }
    case 'converting':
      return selection.kind === 'audio' ? '🎧 Конвертация в MP3…' : '🎛 Обработка видео…';
    case 'merging':
      return '🎬 Объединение видео и аудио…';
    case 'uploading': {
      const percent = update.percent === undefined ? undefined : `${update.percent.toFixed(1)}%`;
      return `📤 Отправка в Telegram${percent ? ` · ${percent}` : '…'}`;
    }
  }
}

export function renderNoFormats(metadata: VideoMetadata): string {
  return [
    titleHeader(metadata),
    '',
    '❌ Для этого видео нет ни MP3, ни MP4-вариантов H.264. Скачивать нечего.',
  ].join('\n');
}

export function renderError(message: string): string {
  return `❌ ${escapeHtml(message)}`;
}

export function renderProgress(
  metadata: VideoMetadata | undefined,
  selection: MediaSelection,
  update: ProgressUpdate,
): string {
  return `${titleHeader(metadata)}\n${escapeHtml(selectionLabel(selection))}\n\n${renderStage(update, selection)}`;
}

export function renderCompleted(metadata: VideoMetadata | undefined, selection: MediaSelection): string {
  return `${titleHeader(metadata)}\n${escapeHtml(selectionLabel(selection))}\n\n✅ Отправлено.`;
}

export function renderCancelled(metadata: VideoMetadata | undefined, selection: MediaSelection): string {
  return `${titleHeader(metadata)}\n${escapeHtml(selectionLabel(selection))}\n\n⛔ Задача отменена. Временные файлы удалены.`;
}

export function renderFailed(metadata: VideoMetadata | undefined, selection: MediaSelection, message: string): string {
  return `${titleHeader(metadata)}\n${escapeHtml(selectionLabel(selection))}\n\n❌ ${escapeHtml(message)}`;
}

export function renderStartMessage(uploadLimitBytes: number): string {
  return [
    '👋 <b>YouTube Download Bot</b>',
    'Пришлите ссылку на отдельное видео YouTube — предложу MP3 или MP4 с выбором качества.',
    '',
    renderHelpMessage(uploadLimitBytes),
  ].join('\n');
}

export function renderQueueFull(): string {
  return `❌ ${QUEUE_FULL_MESSAGE}`;
}

export function renderHelpMessage(uploadLimitBytes: number): string {
  return [
    '<b>Как пользоваться</b>',
    '1. Пришлите ссылку на отдельное видео YouTube (/watch, /shorts, youtu.be).',
    '2. Выберите MP3 или вариант MP4.',
    '3. Следите за прогрессом; если передумали — нажмите «Отмена».',
    '',
    `Плейлисты и прямые трансляции не поддерживаются. Лимит отправки в Telegram: ${formatBytes(uploadLimitBytes)}.`,
  ].join('\n');
}
