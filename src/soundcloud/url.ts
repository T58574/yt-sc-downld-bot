export type SoundCloudRejectionReason =
  | 'empty'
  | 'too_long'
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'unsupported_host'
  | 'unsupported_path'
  | 'playlist_only';

export interface ParsedSoundCloudTrack {
  /** Канонический URL трека без query/hash — его и получает yt-dlp. */
  url: string;
  /** on.soundcloud.com: редирект на полноценный трек разруливает сам yt-dlp. */
  shortLink: boolean;
}

export type SoundCloudParseResult =
  | { ok: true; value: ParsedSoundCloudTrack }
  | { ok: false; reason: SoundCloudRejectionReason };

const TRACK_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SHORT_LINK_HOSTS = new Set(['on.soundcloud.com']);
const MAX_INPUT_LENGTH = 2048;
const MAX_SEGMENT_LENGTH = 200;
const SEGMENT_PATTERN = /^[A-Za-z0-9._~%-]+$/;
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

/** Служебные маршруты SoundCloud, которые не являются треками. */
const RESERVED_FIRST_SEGMENTS = new Set([
  'albums',
  'charts',
  'creators',
  'discover',
  'feeds',
  'imprint',
  'jobs',
  'labels',
  'messages',
  'notifications',
  'pages',
  'people',
  'playlists',
  'premium',
  'search',
  'settings',
  'stations',
  'stream',
  'tags',
  'terms-of-use',
  'tracks',
  'upload',
  'you',
]);

function reject(reason: SoundCloudRejectionReason): SoundCloudParseResult {
  return { ok: false, reason };
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function isSoundCloudHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return TRACK_HOSTS.has(host) || SHORT_LINK_HOSTS.has(host);
}

/** Быстрая проверка до разбора: иначе невалидный URL уйдёт в YouTube-парсер. */
export function looksLikeSoundCloudUrl(input: string): boolean {
  try {
    return isSoundCloudHost(new URL(input.trim()).hostname);
  } catch {
    return false;
  }
}

function validSegment(segment: string | undefined): segment is string {
  if (segment === undefined || segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return (
    decoded.length > 0 &&
    decoded.length <= MAX_SEGMENT_LENGTH &&
    SEGMENT_PATTERN.test(decoded) &&
    decoded !== '.' &&
    decoded !== '..'
  );
}

function parseTrack(url: URL): SoundCloudParseResult {
  const segments = url.pathname.split('/').filter(Boolean);
  const [artist, slug] = segments;

  if (!validSegment(artist)) return reject('unsupported_path');
  if (!slug) return reject('unsupported_path');

  if (segments.length > 2) {
    return slug.toLowerCase() === 'sets' ? reject('playlist_only') : reject('unsupported_path');
  }
  if (slug.toLowerCase() === 'sets') return reject('playlist_only');
  if (RESERVED_FIRST_SEGMENTS.has(artist.toLowerCase())) return reject('unsupported_path');
  if (!validSegment(slug)) return reject('unsupported_path');

  return {
    ok: true,
    value: {
      url: `https://soundcloud.com/${artist}/${slug}`,
      shortLink: false,
    },
  };
}

function parseShortLink(url: URL): SoundCloudParseResult {
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[0];
  if (segments.length !== 1 || code === undefined || !SHORT_CODE_PATTERN.test(code)) {
    return reject('unsupported_path');
  }
  return {
    ok: true,
    value: {
      url: `https://on.soundcloud.com/${code}`,
      shortLink: true,
    },
  };
}

export function parseSoundCloudUrl(input: string): SoundCloudParseResult {
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

  const host = normalizedHost(url.hostname);
  if (SHORT_LINK_HOSTS.has(host)) return parseShortLink(url);
  if (!TRACK_HOSTS.has(host)) return reject('unsupported_host');
  return parseTrack(url);
}

/** Защита для слоя yt-dlp: туда должен попадать только URL SoundCloud. */
export function isSoundCloudMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    return isSoundCloudHost(url.hostname);
  } catch {
    return false;
  }
}

export function soundCloudRejectionMessage(reason: SoundCloudRejectionReason): string {
  switch (reason) {
    case 'empty':
      return 'Пришлите ссылку на трек SoundCloud.';
    case 'too_long':
      return 'Ссылка слишком длинная.';
    case 'invalid_url':
      return 'Это не похоже на корректную ссылку. Пришлите ссылку вида https://soundcloud.com/artist/track';
    case 'unsupported_scheme':
      return 'Поддерживаются только обычные http/https-ссылки.';
    case 'unsupported_host':
      return 'Поддерживаются только ссылки soundcloud.com и on.soundcloud.com.';
    case 'unsupported_path':
      return 'Это не ссылка на отдельный трек. Пришлите https://soundcloud.com/artist/track';
    case 'playlist_only':
      return 'Плейлисты и подборки SoundCloud не поддерживаются. Пришлите ссылку на отдельный трек.';
  }
}
