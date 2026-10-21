import { describe, expect, it } from 'vitest';
import type { TelegramClient } from 'telegram';
import { loadConfig } from '../src/config.js';
import { FileTooLargeError } from '../src/errors.js';
import { silentLogger } from '../src/logger.js';
import { createMediaSender, selectTransport, type MediaSender } from '../src/telegram/sender.js';
import type { MtprotoClient } from '../src/telegram/mtproto-client.js';
import type { MediaSelection, VideoMetadata } from '../src/types.js';
import type { DownloadedFile } from '../src/ytdlp/download.js';

const TOKEN = `123456789:${'A'.repeat(35)}`;
const API_ID = '123456';
const API_HASH = '0123456789abcdef0123456789abcdef';

function env(overrides: Record<string, string | undefined> = {}) {
  return { BOT_TOKEN: TOKEN, ALLOWED_TELEGRAM_IDS: '111', ...overrides };
}

function configWithMtproto(overrides: Record<string, string | undefined> = {}) {
  return loadConfig(env({ TELEGRAM_API_ID: API_ID, TELEGRAM_API_HASH: API_HASH, ...overrides }));
}

function file(sizeBytes: number, extension: 'mp3' | 'mp4' = 'mp4'): DownloadedFile {
  return { path: `/tmp/work/video.${extension}`, sizeBytes, extension };
}

const metadata: VideoMetadata = {
  id: 'dQw4w9WgXcQ',
  title: 'Тестовое видео',
  durationSec: 125,
  uploader: 'Канал',
  formats: [],
  hasAudio: true,
};

const selection: MediaSelection = { kind: 'video', height: 1080 };

function fakeApi() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api = {
    sendAudio: async (...args: unknown[]) => {
      calls.push({ method: 'sendAudio', args });
      return {};
    },
    sendVideo: async (...args: unknown[]) => {
      calls.push({ method: 'sendVideo', args });
      return {};
    },
  };
  return { api: api as never, calls };
}

function fakeMtproto() {
  const calls: Array<{ chatId: number; params: Record<string, unknown> }> = [];
  const client = {
    sendFile: async (chatId: number, params: Record<string, unknown>) => {
      calls.push({ chatId, params });
      return {};
    },
  } as unknown as TelegramClient;
  const mtproto: MtprotoClient = { client, close: async () => undefined };
  return { mtproto, calls };
}

describe('selectTransport', () => {
  it('без MTProto всегда идёт в Bot API', () => {
    expect(selectTransport(10, { mtprotoAvailable: false, thresholdBytes: 50 * 1024 * 1024 })).toBe('bot-api');
  });

  it('файлы больше порога уходят в MTProto', () => {
    const threshold = 50 * 1024 * 1024;
    expect(selectTransport(threshold + 1, { mtprotoAvailable: true, thresholdBytes: threshold })).toBe('mtproto');
    expect(selectTransport(threshold, { mtprotoAvailable: true, thresholdBytes: threshold })).toBe('bot-api');
  });
});

describe('createMediaSender', () => {
  it('мелкий файл уходит через Bot API', async () => {
    const { api, calls } = fakeApi();
    const sender: MediaSender = createMediaSender({
      api,
      config: configWithMtproto(),
      logger: silentLogger,
    });

    await sender.send({ chatId: 111, file: file(1024), metadata, selection, signal: new AbortController().signal });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('sendVideo');
  });

  it('крупный файл уходит через MTProto с правильными атрибутами', async () => {
    const { api, calls } = fakeApi();
    const { mtproto, calls: mtprotoCalls } = fakeMtproto();
    const sender = createMediaSender({ api, mtproto, config: configWithMtproto(), logger: silentLogger });

    await sender.send({
      chatId: 111,
      file: file(120 * 1024 * 1024),
      metadata,
      selection,
      signal: new AbortController().signal,
    });

    expect(calls).toHaveLength(0);
    expect(mtprotoCalls).toHaveLength(1);
    expect(mtprotoCalls[0]?.chatId).toBe(111);
    expect(mtprotoCalls[0]?.params.parseMode).toBe('html');
  });

  it('без MTProto файл больше лимита Bot API отклоняется с понятной ошибкой', async () => {
    const { api, calls } = fakeApi();
    const sender = createMediaSender({ api, config: loadConfig(env()), logger: silentLogger });

    await expect(
      sender.send({
        chatId: 111,
        file: file(60 * 1024 * 1024),
        metadata,
        selection,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(calls).toHaveLength(0);
  });

  it('порог можно опустить, чтобы проверить MTProto на маленьком файле', async () => {
    const { api } = fakeApi();
    const { mtproto, calls } = fakeMtproto();
    const sender = createMediaSender({
      api,
      mtproto,
      config: configWithMtproto({ MTPROTO_THRESHOLD_MB: '1' }),
      logger: silentLogger,
    });

    await sender.send({
      chatId: 111,
      file: file(2 * 1024 * 1024),
      metadata,
      selection,
      signal: new AbortController().signal,
    });

    expect(calls).toHaveLength(1);
  });
});
