import { describe, expect, it } from 'vitest';
import {
  ExternalCommandError,
  FileTooLargeError,
  OutputFileMissingError,
  ProcessTimeoutError,
  TelegramStartupError,
  ToolNotFoundError,
  UnsupportedVideoError,
  classifyYtDlpFailure,
  userMessageForError,
} from '../src/errors.js';

const MIB = 1024 * 1024;
const LIMIT = 50 * MIB;

describe('classifyYtDlpFailure', () => {
  it('распознаёт типовые ошибки yt-dlp', () => {
    expect(classifyYtDlpFailure('ERROR: Sign in to confirm you’re not a bot. Use --cookies')).toBe('youtube_blocked');
    expect(classifyYtDlpFailure('ERROR: This video is unavailable')).toBe('unavailable');
    expect(classifyYtDlpFailure('ERROR: Private video. Sign in if you have been granted access')).toBe('private');
    expect(classifyYtDlpFailure('ERROR: Video is age-restricted')).toBe('age_restricted');
    expect(classifyYtDlpFailure('ERROR: Join this channel to get access')).toBe('members_only');
    expect(classifyYtDlpFailure('ERROR: This live event will begin in 3 hours')).toBe('live');
    expect(classifyYtDlpFailure('ERROR: Requested format is not available')).toBe('format_unavailable');
    expect(classifyYtDlpFailure('ERROR: File is larger than max-filesize')).toBe('too_large');
    expect(classifyYtDlpFailure('ERROR: HTTP Error 429: Too Many Requests')).toBe('rate_limited');
    expect(classifyYtDlpFailure('ERROR: Unable to download webpage: [Errno 111] Connection refused')).toBe('network');
    expect(classifyYtDlpFailure('ERROR: ffmpeg exited with code 1')).toBe('conversion');
  });

  it('возвращает unknown для незнакомого текста', () => {
    expect(classifyYtDlpFailure('ERROR: something strange')).toBe('unknown');
  });
});

describe('userMessageForError', () => {
  it('объясняет превышение лимита и предлагает выбор', () => {
    const message = userMessageForError(new FileTooLargeError(120 * MIB, LIMIT), LIMIT);
    expect(message).toContain('120.0 МиБ');
    expect(message).toContain('50.0 МиБ');
    expect(message).toContain('качество ниже');
    expect(userMessageForError(new FileTooLargeError(120 * MIB, LIMIT, true), LIMIT)).toContain('Ожидаемый размер');
  });

  it('переводит технические ошибки в человеческий текст', () => {
    expect(userMessageForError(new ProcessTimeoutError(1000), LIMIT)).toContain('слишком много времени');
    expect(userMessageForError(new ToolNotFoundError('yt-dlp'), LIMIT)).toContain('yt-dlp');
    expect(userMessageForError(new OutputFileMissingError('mp4'), LIMIT)).toContain('не нашёлся готовый файл');
    expect(userMessageForError(new UnsupportedVideoError('no_audio', 'нет звука'), LIMIT)).toContain('MP3 недоступен');
    expect(userMessageForError(new UnsupportedVideoError('live', 'эфир'), LIMIT)).toContain('трансляции');
  });

  it('использует stderr внешней команды для диагностики', () => {
    const error = new ExternalCommandError('yt-dlp', 1, 'ERROR: Video is age-restricted');
    expect(userMessageForError(error, LIMIT)).toContain('возрастное ограничение');
  });

  it('не раскрывает детали неизвестной ошибки', () => {
    expect(userMessageForError(new Error('internal stack'), LIMIT)).toContain('логах сервера');
    expect(userMessageForError('строка', LIMIT)).not.toContain('строка');
  });
});

describe('TelegramStartupError', () => {
  it('подсказывает про адрес Bot API при таймауте', () => {
    const error = new TelegramStartupError('http://127.0.0.1:8081', true, new DOMException('timed out', 'TimeoutError'));
    expect(error.message).toContain('http://127.0.0.1:8081');
    expect(error.message).toContain('не ответил');
    expect(error.timedOut).toBe(true);
  });

  it('подсказывает про токен при 401 и передаёт детали в остальных случаях', () => {
    expect(new TelegramStartupError('https://api.telegram.org', false, { error_code: 401 }).message).toContain('BOT_TOKEN');
    const error = new TelegramStartupError('http://127.0.0.1:8081', false, new Error('fetch failed'));
    expect(error.message).toContain('fetch failed');
    expect(error.name).toBe('TelegramStartupError');
  });
});
