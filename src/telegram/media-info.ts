import { escapeHtml, formatDuration, truncate } from '../format.js';
import type { MediaSelection, VideoMetadata } from '../types.js';
import { selectionLabel } from './render.js';

const CAPTION_ESCAPED_LIMIT = 900;
const ATTRIBUTE_TITLE_LIMIT = 64;

/** Обрезает текст так, чтобы его HTML-экранированная длина укладывалась в лимит. */
export function safeEscapedText(value: string, maxEscapedLength: number): string {
  let length = Math.min(value.length, maxEscapedLength);
  while (length > 0) {
    const escaped = escapeHtml(value.slice(0, length));
    if (escaped.length <= maxEscapedLength) return escaped;
    length = Math.floor(length * 0.8);
  }
  return '';
}

/** Подпись к файлу: одинаковая для Bot API и MTProto. */
export function buildMediaCaption(metadata: VideoMetadata, selection: MediaSelection): string {
  const title = safeEscapedText(metadata.title, CAPTION_ESCAPED_LIMIT - 60);
  const duration = formatDuration(metadata.durationSec);
  return `<b>${title}</b>\n${escapeHtml(selectionLabel(selection))} · ${duration}`;
}

/** Размеры кадра по данным метаданных: undefined, если формат не найден. */
export function findVideoDimensions(metadata: VideoMetadata, height: number): { width?: number; height?: number } {
  const formats = metadata.formats.filter(
    (format) => format.ext === 'mp4' && format.vcodec?.startsWith('avc1') && format.height === height,
  );
  const chosen = formats.find((format) => !format.acodec || format.acodec === 'none') ?? formats[0];
  return {
    ...(chosen?.width !== undefined ? { width: chosen.width } : {}),
    ...(chosen?.height !== undefined ? { height: chosen.height } : {}),
  };
}

/** Размеры кадра для DocumentAttributeVideo: Telegram показывает превью по этим числам. */
export function videoDimensions(metadata: VideoMetadata, height: number): { width: number; height: number } {
  const found = findVideoDimensions(metadata, height);
  return {
    width: found.width ?? Math.round((height * 16) / 9),
    height: found.height ?? height,
  };
}

/** Название файла, которое увидит пользователь в Telegram. */
export function mediaFileName(metadata: VideoMetadata, extension: string): string {
  return `${metadata.id}.${extension}`;
}

/** Название трека для DocumentAttributeAudio. */
export function audioTitle(metadata: VideoMetadata): string {
  return truncate(metadata.title, ATTRIBUTE_TITLE_LIMIT);
}

/** Исполнитель для DocumentAttributeAudio. */
export function audioPerformer(metadata: VideoMetadata): string | undefined {
  return metadata.uploader ? truncate(metadata.uploader, ATTRIBUTE_TITLE_LIMIT) : undefined;
}
