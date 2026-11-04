import type { ParsedYouTubeUrl } from './types.js';
import {
  looksLikeSoundCloudUrl,
  parseSoundCloudUrl,
  soundCloudRejectionMessage,
  type ParsedSoundCloudTrack,
} from './soundcloud/url.js';
import { parseYouTubeUrl, urlRejectionMessage } from './youtube/url.js';

export type ParsedLink =
  | { provider: 'youtube'; youtube: ParsedYouTubeUrl }
  | { provider: 'soundcloud'; soundcloud: ParsedSoundCloudTrack };

export type LinkParseResult =
  | { ok: true; value: ParsedLink }
  | { ok: false; message: string };

/**
 * Разбирает ссылку YouTube или SoundCloud. Провайдер выбирается по хосту,
 * чтобы сообщение об ошибке было про тот сервис, ссылку на который прислали.
 */
export function parseMediaLink(input: string): LinkParseResult {
  if (looksLikeSoundCloudUrl(input)) {
    const parsed = parseSoundCloudUrl(input);
    if (!parsed.ok) return { ok: false, message: soundCloudRejectionMessage(parsed.reason) };
    return { ok: true, value: { provider: 'soundcloud', soundcloud: parsed.value } };
  }

  const parsed = parseYouTubeUrl(input);
  if (!parsed.ok) return { ok: false, message: urlRejectionMessage(parsed.reason) };
  return { ok: true, value: { provider: 'youtube', youtube: parsed.value } };
}
