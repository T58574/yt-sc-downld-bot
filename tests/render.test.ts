import { describe, expect, it } from 'vitest';
import {
  cancelKeyboard,
  formatSelectionKeyboard,
  renderCancelled,
  renderCompleted,
  renderError,
  renderFailed,
  renderNoFormats,
  renderProgress,
  renderQueueFull,
  renderStartMessage,
  renderVideoInfo,
  selectionLabel,
} from '../src/telegram/render.js';
import type { VideoMetadata, VideoQuality } from '../src/types.js';

const MIB = 1024 * 1024;
const metadata: VideoMetadata = {
  id: 'dQw4w9WgXcQ',
  title: 'Rick <Astley> & "friends"',
  durationSec: 213,
  uploader: 'Rick Astley',
  formats: [],
  hasAudio: true,
};

const qualities: VideoQuality[] = [
  {
    height: 720,
    estimatedBytes: 20 * MIB,
    estimateSource: 'reported',
    selector: '137+bestaudio[ext=m4a]',
    exceedsLimit: false,
    needsAudio: true,
  },
  {
    height: 1080,
    estimatedBytes: 90 * MIB,
    estimateSource: 'reported',
    selector: '137+bestaudio[ext=m4a]',
    exceedsLimit: true,
    needsAudio: true,
  },
];

describe('selectionLabel', () => {
  it('подписывает выбранный формат', () => {
    expect(selectionLabel({ kind: 'audio' })).toBe('MP3');
    expect(selectionLabel({ kind: 'video', height: 1080 })).toBe('MP4 1080p');
  });
});

describe('renderVideoInfo', () => {
  it('показывает заголовок, канал и предупреждения', () => {
    const text = renderVideoInfo(metadata, qualities, true, true, 50 * MIB);
    expect(text).toContain('&lt;Astley&gt; &amp; &quot;friends&quot;');
    expect(text).toContain('3:33');
    expect(text).toContain('🎵 MP3');
    expect(text).toContain('50.0 МиБ');
    expect(text).toContain('параметр playlist');
  });

  it('сообщает, когда MP4-вариантов нет', () => {
    const text = renderVideoInfo(metadata, [], true, false, 50 * MIB);
    expect(text).toContain('MP4-варианты H.264 для этого видео недоступны');
    expect(text).not.toContain('⚠️');
  });
});

describe('клавиатуры', () => {
  function callbackData(keyboard: ReturnType<typeof formatSelectionKeyboard>): Array<string | undefined> {
    return keyboard.inline_keyboard.flat().map((button) => ('callback_data' in button ? button.callback_data : undefined));
  }

  it('ставит MP3 отдельной строкой и группирует качества по два', () => {
    const keyboard = formatSelectionKeyboard('dQw4w9WgXcQ', qualities, true);
    expect(keyboard.inline_keyboard.map((row) => row.length)).toEqual([1, 2]);
    expect(callbackData(keyboard)).toEqual(['fmt:dQw4w9WgXcQ:a', 'fmt:dQw4w9WgXcQ:v:720', 'fmt:dQw4w9WgXcQ:v:1080']);
  });

  it('не добавляет MP3, если звука нет', () => {
    const keyboard = formatSelectionKeyboard('dQw4w9WgXcQ', qualities, false);
    expect(keyboard.inline_keyboard.map((row) => row.length)).toEqual([2]);
  });

  it('в кнопке отмены лежит id задачи', () => {
    const keyboard = cancelKeyboard('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(callbackData(keyboard)).toEqual(['cancel:3f2504e0-4f89-41d3-9a0c-0305e82c3301']);
  });
});

describe('renderProgress', () => {
  it('показывает позицию в очереди', () => {
    expect(renderProgress(metadata, { kind: 'audio' }, { stage: 'queued', queuePosition: 3 })).toContain('позиция 3');
  });

  it('показывает реальные байты, скорость и остаток', () => {
    const text = renderProgress(
      metadata,
      { kind: 'video', height: 720 },
      { stage: 'downloading', percent: 42.5, downloadedBytes: 10 * MIB, totalBytes: 20 * MIB, speedBps: 2 * MIB, etaSec: 5 },
    );
    expect(text).toContain('42.5%');
    expect(text).toContain('10.0 МиБ из 20.0 МиБ');
    expect(text).toContain('2.00 МиБ/с');
    expect(text).toContain('0:05');
    expect(text).toContain('MP4 720p');
  });

  it('не показывает проценты, если их нет в выводе yt-dlp', () => {
    const text = renderProgress(metadata, { kind: 'audio' }, { stage: 'downloading', downloadedBytes: 1024 });
    expect(text).not.toContain('%');
    expect(text).toContain('Скачано 1.00 КиБ');
  });

  it('показывает оценку размера с пометкой "~", когда точного нет', () => {
    const text = renderProgress(
      metadata,
      { kind: 'video', height: 720 },
      { stage: 'downloading', downloadedBytes: 10 * MIB, estimatedTotalBytes: 20 * MIB, speedBps: MIB },
    );
    expect(text).toContain('Скачано 10.0 МиБ из ~20.0 МиБ');
    expect(text).toContain('1.00 МиБ/с');
    expect(text).not.toContain('%');
  });

  it('подписывает этапы обработки', () => {
    expect(renderProgress(metadata, { kind: 'audio' }, { stage: 'converting' })).toContain('Конвертация в MP3');
    expect(renderProgress(metadata, { kind: 'video', height: 720 }, { stage: 'merging' })).toContain('Объединение');
    expect(renderProgress(metadata, { kind: 'video', height: 720 }, { stage: 'uploading' })).toContain('Отправка в Telegram');
    expect(renderProgress(undefined, { kind: 'audio' }, { stage: 'metadata' })).toContain('YouTube');
  });
});

describe('финальные сообщения', () => {
  it('рисует успех, отмену и ошибку', () => {
    expect(renderCompleted(metadata, { kind: 'audio' })).toContain('✅ Отправлено');
    expect(renderCancelled(metadata, { kind: 'audio' })).toContain('⛔');
    expect(renderFailed(metadata, { kind: 'audio' }, '<сломалось>')).toContain('&lt;сломалось&gt;');
    expect(renderError('плохо & больно')).toBe('❌ плохо &amp; больно');
    expect(renderNoFormats(metadata)).toContain('Скачивать нечего');
    expect(renderQueueFull()).toContain('Очередь заполнена');
  });

  it('в справке указан лимит отправки', () => {
    const start = renderStartMessage(50 * MIB);
    expect(start).toContain('YouTube Download Bot');
    expect(start).toContain('50.0 МиБ');
  });
});
