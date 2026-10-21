import type { MediaSelection } from '../types.js';

export type CallbackAction =
  | { kind: 'format'; videoId: string; selection: MediaSelection }
  | { kind: 'cancel'; taskId: string };

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORMAT_PREFIX = 'fmt:';
const CANCEL_PREFIX = 'cancel:';
const MAX_HEIGHT = 4320;

export function formatCallbackData(videoId: string, selection: MediaSelection): string {
  return selection.kind === 'audio'
    ? `${FORMAT_PREFIX}${videoId}:a`
    : `${FORMAT_PREFIX}${videoId}:v:${selection.height}`;
}

export function cancelCallbackData(taskId: string): string {
  return `${CANCEL_PREFIX}${taskId}`;
}

export function parseCallbackData(data: string): CallbackAction | null {
  if (data.startsWith(FORMAT_PREFIX)) {
    const parts = data.slice(FORMAT_PREFIX.length).split(':');
    const videoId = parts[0] ?? '';
    if (!VIDEO_ID_PATTERN.test(videoId)) return null;
    if (parts.length === 2 && parts[1] === 'a') {
      return { kind: 'format', videoId, selection: { kind: 'audio' } };
    }
    if (parts.length === 3 && parts[1] === 'v') {
      const rawHeight = parts[2] ?? '';
      if (!/^\d{1,4}$/.test(rawHeight)) return null;
      const height = Number(rawHeight);
      if (height < 1 || height > MAX_HEIGHT) return null;
      return { kind: 'format', videoId, selection: { kind: 'video', height } };
    }
    return null;
  }

  if (data.startsWith(CANCEL_PREFIX)) {
    const taskId = data.slice(CANCEL_PREFIX.length);
    if (!TASK_ID_PATTERN.test(taskId)) return null;
    return { kind: 'cancel', taskId };
  }

  return null;
}
