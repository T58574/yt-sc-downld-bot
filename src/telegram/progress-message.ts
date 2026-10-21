import type { Api, InlineKeyboard } from 'grammy';
import type { Logger } from '../logger.js';
import type { ProgressUpdate } from '../types.js';

export type ProgressRenderer = (update: ProgressUpdate) => string;

export class StatusMessage {
  private current: ProgressUpdate | null = null;
  private finalPayload: { text: string; keyboard?: InlineKeyboard } | null = null;
  private timer: NodeJS.Timeout | undefined;
  private sending = false;
  private lastSentAt = 0;
  private closed = false;

  constructor(
    private readonly api: Api,
    private readonly chatId: number,
    private readonly messageId: number,
    private readonly render: ProgressRenderer,
    private readonly keyboard: InlineKeyboard,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  update(update: ProgressUpdate): void {
    if (this.closed) return;
    this.current = update;
    this.schedule(false);
  }

  finish(text: string, keyboard?: InlineKeyboard): void {
    if (this.closed) return;
    this.finalPayload = { text, ...(keyboard ? { keyboard } : {}) };
    this.current = null;
    this.schedule(true);
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(force: boolean): void {
    if (this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.sending) return;
    const wait = force || this.finalPayload ? 0 : Math.max(0, this.lastSentAt + this.intervalMs - Date.now());
    if (wait === 0) {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.closed || this.sending) return;
    const finalPayload = this.finalPayload;
    const snapshot = this.current;
    if (!finalPayload && !snapshot) return;
    this.sending = true;
    try {
      if (finalPayload) {
        await this.edit(finalPayload.text, finalPayload.keyboard);
        this.finalPayload = null;
        this.current = null;
        this.closed = true;
      } else if (snapshot) {
        await this.edit(this.render(snapshot), this.keyboard);
        if (this.current === snapshot) this.current = null;
        this.lastSentAt = Date.now();
      }
    } catch (error) {
      this.handleEditError(error);
    } finally {
      this.sending = false;
      if (!this.closed && (this.current || this.finalPayload)) {
        this.schedule(Boolean(this.finalPayload));
      }
    }
  }

  private async edit(text: string, keyboard: InlineKeyboard | undefined): Promise<void> {
    await this.api.editMessageText(this.chatId, this.messageId, text, {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  private handleEditError(error: unknown): void {
    const description =
      typeof error === 'object' && error !== null && 'description' in error
        ? String((error as { description?: unknown }).description ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    if (/message is not modified/i.test(description)) return;
    if (/message to edit not found|message can't be edited|bot was blocked|chat not found/i.test(description)) {
      this.closed = true;
      return;
    }
    this.logger.warn('status_edit_failed', { error });
  }
}
