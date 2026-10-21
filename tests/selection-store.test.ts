import { describe, expect, it } from 'vitest';
import { SelectionStore } from '../src/telegram/selection-store.js';
import type { VideoMetadata } from '../src/types.js';

const metadata: VideoMetadata = { id: 'dQw4w9WgXcQ', title: 'Test', formats: [{ formatId: '18', ext: 'mp4' }], hasAudio: true };

function input(chatId = 1, userId = 1) {
  return { chatId, userId, videoId: 'dQw4w9WgXcQ', metadata };
}

describe('SelectionStore', () => {
  it('хранит и отдаёт запись по id сообщения', () => {
    const store = new SelectionStore(60_000, 10, () => 1000);
    store.set(42, input(7, 9));
    const entry = store.get(42);
    expect(entry).toMatchObject({ chatId: 7, userId: 9, videoId: 'dQw4w9WgXcQ', createdAt: 1000 });
    expect(store.size).toBe(1);
  });

  it('take удаляет запись, чтобы кнопку нельзя было нажать дважды', () => {
    const store = new SelectionStore(60_000, 10, () => 1000);
    store.set(42, input());
    expect(store.take(42)).toBeDefined();
    expect(store.take(42)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('убирает просроченные записи', () => {
    let now = 1000;
    const store = new SelectionStore(500, 10, () => now);
    store.set(1, input());
    now = 1400;
    expect(store.get(1)).toBeDefined();
    now = 1501;
    expect(store.get(1)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('вытесняет самые старые записи при переполнении', () => {
    const store = new SelectionStore(60_000, 2, () => 1000);
    store.set(1, input());
    store.set(2, input());
    store.set(3, input());
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeDefined();
    expect(store.get(3)).toBeDefined();
    expect(store.size).toBe(2);
  });

  it('проверяет параметры конструктора', () => {
    expect(() => new SelectionStore(0, 10)).toThrow();
    expect(() => new SelectionStore(1000, 0)).toThrow();
  });
});
