export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function truncate(value: string, maxLength: number): string {
  if (maxLength < 1) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatDuration(totalSeconds: number | undefined): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds === undefined || totalSeconds < 0) {
    return 'неизвестно';
  }
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'неизвестно';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 2 : 1)} КиБ`;
  const mib = kib / 1024;
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} ГиБ`;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} МиБ`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string | undefined {
  if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return undefined;
  }
  return `${formatBytes(bytesPerSecond)}/с`;
}

export function formatEta(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return formatDuration(seconds);
}
