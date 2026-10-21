import type { ProgressUpdate } from '../types.js';

const PROGRESS_PATTERN = /^PROGRESS\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)(?:\|([^|]*))?$/;
const MAX_FORMAT_ID_LENGTH = 64;

function optionalNumber(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalText(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === 'NA') return undefined;
  return trimmed.slice(0, MAX_FORMAT_ID_LENGTH);
}

export function parseYtDlpLine(line: string): ProgressUpdate | null {
  const progressMatch = PROGRESS_PATTERN.exec(line);
  if (progressMatch) {
    const status = progressMatch[1] ?? '';
    if (status !== 'downloading' && status !== 'finished') return null;
    const downloadedBytes = optionalNumber(progressMatch[2]);
    const totalBytes = optionalNumber(progressMatch[3]);
    const estimatedTotalBytes = optionalNumber(progressMatch[4]);
    const speedBps = optionalNumber(progressMatch[5]);
    const etaSec = optionalNumber(progressMatch[6]);
    const formatId = optionalText(progressMatch[7]);

    // Проценты и ETA считаем только по достоверному total_bytes: оценка
    // total_bytes_estimate у DASH-потоков скачет и даёт неверную картину.
    let percent: number | undefined;
    if (status === 'finished') {
      percent = 100;
    } else if (downloadedBytes !== undefined && totalBytes !== undefined && totalBytes > 0) {
      percent = Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100));
    }

    return {
      stage: 'downloading',
      ...(percent !== undefined ? { percent } : {}),
      ...(downloadedBytes !== undefined ? { downloadedBytes } : {}),
      ...(totalBytes !== undefined ? { totalBytes } : {}),
      ...(totalBytes === undefined && estimatedTotalBytes !== undefined ? { estimatedTotalBytes } : {}),
      ...(speedBps !== undefined ? { speedBps } : {}),
      ...(totalBytes !== undefined && etaSec !== undefined ? { etaSec } : {}),
      ...(formatId !== undefined ? { formatId } : {}),
    };
  }

  if (/\[(ExtractAudio|VideoConvertor|VideoRemuxer|FixupM3u8)\]/i.test(line)) {
    return { stage: 'converting' };
  }
  if (/\[Merger\]|Merging formats into/i.test(line)) {
    return { stage: 'merging' };
  }
  return null;
}
