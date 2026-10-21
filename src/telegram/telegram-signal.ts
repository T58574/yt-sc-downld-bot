import type { Api } from 'grammy';

/**
 * grammY описывает четвёртый аргумент методов Api типом AbortSignal из
 * abort-controller (своя реализация EventTarget), хотя в рантайме сигнал
 * просто прокидывается в HTTP-клиент и нативный AbortSignal подходит.
 * Держим приведение в одном месте, чтобы не разбрасывать касты по коду.
 */
export type TelegramAbortSignal = NonNullable<Parameters<Api['sendAudio']>[3]>;

export function toTelegramSignal(signal: AbortSignal): TelegramAbortSignal {
  return signal as unknown as TelegramAbortSignal;
}
