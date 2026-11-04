import type { MediaFormat, VideoMetadata } from '../types.js';
import { UnsupportedVideoError } from '../errors.js';

interface RawFormat {
  format_id?: unknown;
  ext?: unknown;
  width?: unknown;
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  tbr?: unknown;
  abr?: unknown;
}

interface RawMetadata {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  uploader?: unknown;
  is_live?: unknown;
  live_status?: unknown;
  _type?: unknown;
  entries?: unknown;
  formats?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function textValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

function normalizeFormat(raw: RawFormat): MediaFormat | null {
  if (typeof raw.format_id !== 'string' && typeof raw.format_id !== 'number') return null;
  if (typeof raw.ext !== 'string' || !raw.ext) return null;
  const format: MediaFormat = {
    formatId: String(raw.format_id).slice(0, 64),
    ext: raw.ext.slice(0, 16),
  };
  const width = finiteNumber(raw.width);
  const height = finiteNumber(raw.height);
  const filesize = finiteNumber(raw.filesize);
  const filesizeApprox = finiteNumber(raw.filesize_approx);
  const tbr = finiteNumber(raw.tbr);
  const abr = finiteNumber(raw.abr);
  if (width !== undefined) format.width = width;
  if (height !== undefined) format.height = height;
  if (typeof raw.vcodec === 'string') format.vcodec = raw.vcodec.slice(0, 64);
  if (typeof raw.acodec === 'string') format.acodec = raw.acodec.slice(0, 64);
  if (filesize !== undefined) format.filesize = filesize;
  if (filesizeApprox !== undefined) format.filesizeApprox = filesizeApprox;
  if (tbr !== undefined) format.tbr = tbr;
  if (abr !== undefined) format.abr = abr;
  return format;
}

function metadataId(rawValue: unknown, expectedId: string | undefined): string {
  if (expectedId !== undefined) return expectedId;
  if (typeof rawValue === 'string' || typeof rawValue === 'number') {
    const cleaned = String(rawValue)
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 64);
    if (cleaned) return cleaned;
  }
  throw new UnsupportedVideoError('invalid_metadata', 'yt-dlp не вернул ID медиа');
}

export function normalizeMetadata(
  rawValue: unknown,
  expectedVideoId?: string,
  fallbackTitle = 'YouTube video',
): VideoMetadata {
  if (typeof rawValue !== 'object' || rawValue === null) {
    throw new UnsupportedVideoError('invalid_metadata', 'Пустой ответ yt-dlp');
  }
  const raw = rawValue as RawMetadata;
  if (raw._type === 'playlist' || Array.isArray(raw.entries)) {
    throw new UnsupportedVideoError('playlist', 'yt-dlp вернул playlist');
  }
  if (expectedVideoId !== undefined && raw.id !== expectedVideoId) {
    throw new UnsupportedVideoError('invalid_metadata', 'ID видео не совпал с ссылкой');
  }
  const id = metadataId(raw.id, expectedVideoId);
  if (raw.is_live === true || raw.live_status === 'is_live' || raw.live_status === 'is_upcoming') {
    throw new UnsupportedVideoError('live', 'Прямые трансляции не поддерживаются');
  }
  if (!Array.isArray(raw.formats) || raw.formats.length === 0) {
    throw new UnsupportedVideoError('invalid_metadata', 'yt-dlp не вернул форматы');
  }

  const formats = raw.formats
    .map((entry) => (typeof entry === 'object' && entry !== null ? normalizeFormat(entry as RawFormat) : null))
    .filter((entry): entry is MediaFormat => entry !== null);

  if (formats.length === 0) {
    throw new UnsupportedVideoError('invalid_metadata', 'yt-dlp не вернул пригодные форматы');
  }

  const duration = finiteNumber(raw.duration);
  return {
    id,
    title: textValue(raw.title, 300) ?? fallbackTitle,
    ...(duration !== undefined ? { durationSec: Math.floor(duration) } : {}),
    ...(textValue(raw.uploader, 200) ? { uploader: textValue(raw.uploader, 200) } : {}),
    formats,
    hasAudio: formats.some((format) => format.acodec !== undefined && format.acodec !== 'none'),
  };
}
