import type { VideoMetadata } from '../types.js';

export interface SelectionEntry {
  chatId: number;
  userId: number;
  videoId: string;
  metadata: VideoMetadata;
  createdAt: number;
}

export interface SelectionInput {
  chatId: number;
  userId: number;
  videoId: string;
  metadata: VideoMetadata;
}

/**
 * Хранит разобранные видео в ожидании нажатия кнопки формата.
 * Ключ — id сообщения с клавиатурой, поэтому устаревшие записи не могут
 * быть переиспользованы другим чатом.
 */
export class SelectionStore {
  private readonly entries = new Map<number, SelectionEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {
    if (ttlMs <= 0) throw new Error('ttlMs должен быть > 0');
    if (maxEntries < 1) throw new Error('maxEntries должен быть >= 1');
  }

  get size(): number {
    return this.entries.size;
  }

  set(messageId: number, input: SelectionInput): void {
    this.prune();
    this.entries.set(messageId, { ...input, createdAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get(messageId: number): SelectionEntry | undefined {
    this.prune();
    return this.entries.get(messageId);
  }

  take(messageId: number): SelectionEntry | undefined {
    const entry = this.get(messageId);
    if (entry) this.entries.delete(messageId);
    return entry;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [messageId, entry] of this.entries) {
      if (entry.createdAt >= cutoff) break;
      this.entries.delete(messageId);
    }
  }
}
