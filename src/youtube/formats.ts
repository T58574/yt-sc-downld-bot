import type { MediaFormat, MediaSelection, VideoMetadata, VideoQuality } from '../types.js';

const MAX_QUALITY_OPTIONS = 8;
const MAX_HEIGHT = 4320;
const KILO = 1000;
const BITS_PER_BYTE = 8;

export const AUDIO_FORMAT_SELECTOR = 'bestaudio[ext=m4a]/bestaudio/best';

export function buildVideoQualities(metadata: VideoMetadata, uploadLimitBytes: number): VideoQuality[] {
  const bestM4aAudio = metadata.formats
    .filter((format) => format.acodec?.startsWith('mp4a') && format.ext === 'm4a')
    .sort((left, right) => (right.abr ?? 0) - (left.abr ?? 0))[0];

  const byHeight = new Map<number, MediaFormat>();
  for (const format of metadata.formats) {
    if (format.ext !== 'mp4') continue;
    if (!format.vcodec?.startsWith('avc1')) continue;
    if (!format.height || format.height < 1 || format.height > MAX_HEIGHT) continue;
    const current = byHeight.get(format.height);
    if (!current) {
      byHeight.set(format.height, format);
      continue;
    }
    const currentIsVideoOnly = isVideoOnly(current);
    const nextIsVideoOnly = isVideoOnly(format);
    if (
      (nextIsVideoOnly && !currentIsVideoOnly) ||
      (nextIsVideoOnly === currentIsVideoOnly && (format.tbr ?? 0) > (current.tbr ?? 0))
    ) {
      byHeight.set(format.height, format);
    }
  }

  const qualities: VideoQuality[] = [];
  for (const [height, format] of byHeight) {
    const videoOnly = isVideoOnly(format);
    const videoBytes = estimateFormatBytes(format, metadata.durationSec);
    const audioBytes = videoOnly && bestM4aAudio ? estimateFormatBytes(bestM4aAudio, metadata.durationSec) : undefined;
    const estimatedBytes = videoBytes === undefined ? undefined : videoBytes.bytes + (audioBytes?.bytes ?? 0);
    const estimateSource =
      videoBytes === undefined
        ? undefined
        : videoBytes.source === 'reported' && (audioBytes === undefined || audioBytes.source === 'reported')
          ? 'reported'
          : 'bitrate';
    const pinned = videoOnly ? `${format.formatId}+bestaudio[ext=m4a]` : format.formatId;
    qualities.push({
      height,
      ...(estimatedBytes !== undefined ? { estimatedBytes } : {}),
      ...(estimateSource !== undefined ? { estimateSource } : {}),
      selector: [pinned, formatSelector({ kind: 'video', height })].join('/'),
      exceedsLimit: estimatedBytes !== undefined && estimatedBytes > uploadLimitBytes,
      needsAudio: videoOnly,
    });
  }

  return qualities.sort((left, right) => right.height - left.height).slice(0, MAX_QUALITY_OPTIONS);
}

function isVideoOnly(format: MediaFormat): boolean {
  return !format.acodec || format.acodec === 'none';
}

interface ByteEstimate {
  bytes: number;
  source: 'reported' | 'bitrate';
}

function estimateFormatBytes(format: MediaFormat, durationSec: number | undefined): ByteEstimate | undefined {
  const reported = format.filesize ?? format.filesizeApprox;
  if (reported !== undefined) return { bytes: reported, source: 'reported' };
  if (durationSec === undefined || durationSec <= 0) return undefined;
  const kbps = format.tbr ?? format.abr;
  if (kbps === undefined || kbps <= 0) return undefined;
  return { bytes: Math.round(((kbps * KILO) / BITS_PER_BYTE) * durationSec), source: 'bitrate' };
}

export function hasDownloadableAudio(metadata: VideoMetadata): boolean {
  return metadata.hasAudio;
}

export function formatSelector(selection: MediaSelection): string {
  if (selection.kind === 'audio') return AUDIO_FORMAT_SELECTOR;
  if (!Number.isInteger(selection.height) || selection.height < 1 || selection.height > MAX_HEIGHT) {
    throw new Error('Некорректная высота видео');
  }
  const height = selection.height;
  return [
    `bestvideo[height=${height}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]`,
    `best[height=${height}][ext=mp4][vcodec^=avc1]`,
    `best[height<=${height}][ext=mp4][vcodec^=avc1]`,
    `best[height<=${height}][ext=mp4]`,
  ].join('/');
}

export function qualityLabel(quality: VideoQuality): string {
  const size = quality.estimatedBytes === undefined ? '' : ` · ~${Math.round(quality.estimatedBytes / (1024 * 1024))} МиБ`;
  const warning = quality.exceedsLimit ? ' ⚠️' : '';
  return `${quality.height}p${size}${warning}`;
}
