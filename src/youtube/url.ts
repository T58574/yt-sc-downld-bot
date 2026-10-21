import type { ParsedYouTubeUrl } from '../types.js';

export type UrlRejectionReason =
  | 'empty'
  | 'too_long'
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'unsupported_host'
  | 'unsupported_path'
  | 'playlist_only'
  | 'live_unsupported'
  | 'invalid_video_id';

export type UrlParseResult =
  | { ok: true; value: ParsedYouTubeUrl }
  | { ok: false; reason: UrlRejectionReason };

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const MAX_INPUT_LENGTH = 2048;

function reject(reason: UrlRejectionReason): UrlParseResult {
  return { ok: false, reason };
}

function validateId(rawId: string | null): string | null {
  if (!rawId) return null;
  const id = rawId.trim();
  return VIDEO_ID_PATTERN.test(id) ? id : null;
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function fromVideoId(videoId: string, hadPlaylistParam: boolean): UrlParseResult {
  return {
    ok: true,
    value: {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      hadPlaylistParam,
    },
  };
}

function parseYoutuBe(url: URL): UrlParseResult {
  const segments = pathSegments(url.pathname);
  if (segments.length !== 1) return reject('unsupported_path');
  const videoId = validateId(segments[0] ?? null);
  if (!videoId) return reject('invalid_video_id');
  return fromVideoId(videoId, url.searchParams.has('list'));
}

function parseYouTube(url: URL): UrlParseResult {
  const segments = pathSegments(url.pathname);
  const first = segments[0]?.toLowerCase();
  const hadPlaylistParam = url.searchParams.has('list');

  if (!first) return reject('unsupported_path');

  if (first === 'watch') {
    if (segments.length !== 1) return reject('unsupported_path');
    const videoId = validateId(url.searchParams.get('v'));
    if (!videoId) {
      return url.searchParams.has('list') ? reject('playlist_only') : reject('invalid_video_id');
    }
    return fromVideoId(videoId, hadPlaylistParam);
  }

  if (first === 'shorts' || first === 'embed' || first === 'v') {
    if (segments.length !== 2) return reject('unsupported_path');
    const videoId = validateId(segments[1] ?? null);
    if (!videoId) return reject('invalid_video_id');
    return fromVideoId(videoId, hadPlaylistParam);
  }

  if (first === 'live') return reject('live_unsupported');
  if (first === 'playlist') return reject('playlist_only');
  return reject('unsupported_path');
}

export function parseYouTubeUrl(input: string): UrlParseResult {
  const trimmed = input.trim();
  if (!trimmed) return reject('empty');
  if (trimmed.length > MAX_INPUT_LENGTH) return reject('too_long');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return reject('invalid_url');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return reject('unsupported_scheme');
  if (url.username || url.password) return reject('invalid_url');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'youtu.be') return parseYoutuBe(url);
  if (!YOUTUBE_HOSTS.has(host)) return reject('unsupported_host');
  return parseYouTube(url);
}

export function urlRejectionMessage(reason: UrlRejectionReason): string {
  switch (reason) {
    case 'empty':
      return 'Пришлите ссылку на видео YouTube.';
    case 'too_long':
      return 'Ссылка слишком длинная.';
    case 'invalid_url':
      return 'Это не похоже на корректную ссылку. Пришлите ссылку вида https://www.youtube.com/watch?v=…';
    case 'unsupported_scheme':
      return 'Поддерживаются только обычные http/https-ссылки.';
    case 'unsupported_host':
      return 'Поддерживаются только ссылки youtube.com и youtu.be.';
    case 'unsupported_path':
      return 'Это не ссылка на отдельное видео. Пришлите /watch?v=…, /shorts/… или youtu.be/…';
    case 'playlist_only':
      return 'Плейлисты пока не поддерживаются. Пришлите ссылку на отдельное видео.';
    case 'live_unsupported':
      return 'Прямые трансляции не поддерживаются. Дождитесь окончания эфира.';
    case 'invalid_video_id':
      return 'В ссылке нет корректного ID видео (11 символов).';
  }
}
