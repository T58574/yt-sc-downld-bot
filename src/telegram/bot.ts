import { randomUUID } from 'node:crypto';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot, type BotError } from 'grammy';
import type { Update } from 'grammy/types';
import type { AppConfig } from '../config.js';
import { TelegramStartupError, userMessageForError } from '../errors.js';
import type { Logger } from '../logger.js';
import { TaskQueue, type QueueEvent } from '../queue.js';
import type { MediaSelection, Task, VideoMetadata } from '../types.js';
import { buildVideoQualities, hasDownloadableAudio } from '../youtube/formats.js';
import { parseYouTubeUrl, urlRejectionMessage } from '../youtube/url.js';
import { fetchVideoMetadata } from '../ytdlp/metadata.js';
import { parseCallbackData } from './callbacks.js';
import { createDownloadTask } from './job.js';
import type { MtprotoClient } from './mtproto-client.js';
import { StatusMessage } from './progress-message.js';
import {
  cancelKeyboard,
  formatSelectionKeyboard,
  QUEUE_FULL_MESSAGE,
  renderCancelled,
  renderCompleted,
  renderError,
  renderFailed,
  renderNoFormats,
  renderProgress,
  renderQueueFull,
  renderStartMessage,
  renderVideoInfo,
} from './render.js';
import { SelectionStore } from './selection-store.js';
import { createMediaSender } from './sender.js';
import { toTelegramSignal } from './telegram-signal.js';

const SELECTION_TTL_MS = 30 * 60 * 1000;
const MAX_SELECTIONS = 200;
const QUEUE_DRAIN_TIMEOUT_MS = 10_000;
const POLLING_TIMEOUT_SEC = 30;
const STARTUP_API_TIMEOUT_MS = 30_000;
const ALLOWED_UPDATES: ReadonlyArray<'message' | 'callback_query'> = ['message', 'callback_query'];
const METADATA_PLACEHOLDER = '🔎 Получаю информацию о видео…';
const BUSY_REPLY = '⏳ Уже получаю данные по предыдущей ссылке. Дождитесь ответа.';
const STALE_SELECTION_REPLY = 'Эта клавиатура устарела. Пришлите ссылку заново.';
const TEXT_ONLY_REPLY = 'Пришлите ссылку на видео YouTube обычным текстом.';

interface MetadataBox {
  current?: VideoMetadata;
}

interface TaskState {
  chatId: number;
  selection: MediaSelection;
  metadata: MetadataBox;
  status: StatusMessage;
}

export interface StartBotOptions {
  config: AppConfig;
  logger: Logger;
  workRoot: string;
  mtproto?: MtprotoClient;
}

export interface BotRuntime {
  bot: Bot;
  queue: TaskQueue;
  shutdown: () => Promise<void>;
}

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

/** Тип апдейта для логов: message, callback_query и прочие. */
function updateType(update: Update): string {
  for (const key of Object.keys(update)) {
    if (key !== 'update_id') return key;
  }
  return 'unknown';
}

export async function startBot(options: StartBotOptions): Promise<BotRuntime> {
  const { config, logger, workRoot, mtproto } = options;
  const bot = new Bot(config.botToken, { client: { apiRoot: config.telegramApiRoot } });
  const sender = createMediaSender({ api: bot.api, ...(mtproto ? { mtproto } : {}), config, logger });
  const selections = new SelectionStore(SELECTION_TTL_MS, MAX_SELECTIONS);
  const tasks = new Map<string, TaskState>();
  const busyChats = new Set<number>();

  async function handleQueueEvent(event: QueueEvent): Promise<void> {
    const state = tasks.get(event.task.id);
    switch (event.type) {
      case 'queued':
      case 'position':
        state?.status.update({ stage: 'queued', queuePosition: event.position });
        return;
      case 'started':
        state?.status.update({ stage: 'metadata' });
        return;
      case 'progress':
        state?.status.update(event.update);
        return;
      case 'finished':
        state?.status.finish(renderCompleted(state.metadata.current, state.selection));
        break;
      case 'failed':
        state?.status.finish(
          renderFailed(state.metadata.current, state.selection, userMessageForError(event.error, config.uploadLimitBytes)),
        );
        break;
      case 'cancelled':
        state?.status.finish(renderCancelled(state.metadata.current, state.selection));
        break;
    }
    tasks.delete(event.task.id);
  }

  const queue = new TaskQueue({
    concurrency: config.maxConcurrentDownloads,
    maxQueueSize: config.maxQueueSize,
    logger,
    onEvent: handleQueueEvent,
  });

  bot.use(async (ctx, next) => {
    logger.debug('update_received', { updateId: ctx.update.update_id, type: updateType(ctx.update) });
    await next();
  });

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId === undefined || !config.allowedIds.has(userId)) {
      if (userId !== undefined) {
        logger.warn('access_denied', { userId, chatType: ctx.chat?.type ?? 'unknown' });
      }
      if (userId !== undefined && ctx.chat?.type === 'private') {
        ignoreFailure(ctx.reply('⛔ Нет доступа: ваш Telegram ID не указан в ALLOWED_TELEGRAM_IDS.'));
      }
      return;
    }
    if (ctx.chat?.type !== 'private') {
      if (ctx.chat) ignoreFailure(ctx.reply('Я работаю только в личном чате.'));
      return;
    }
    await next();
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(renderStartMessage(config.uploadLimitBytes), { parse_mode: 'HTML' });
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (chatId === undefined || userId === undefined) return;
    const parsed = parseYouTubeUrl(ctx.message.text);
    if (!parsed.ok) {
      await ctx.reply(urlRejectionMessage(parsed.reason));
      return;
    }
    if (busyChats.has(chatId)) {
      await ctx.reply(BUSY_REPLY);
      return;
    }

    busyChats.add(chatId);
    const placeholder = await ctx.reply(METADATA_PLACEHOLDER);
    try {
      const metadata = await fetchVideoMetadata({
        config: { ...config, workDir: workRoot },
        videoId: parsed.value.videoId,
      });
      logger.info('metadata_ready', {
        chatId,
        videoId: parsed.value.videoId,
        durationSec: metadata.durationSec,
        formats: metadata.formats.length,
      });

      const qualities = buildVideoQualities(metadata, config.uploadLimitBytes);
      const hasAudio = hasDownloadableAudio(metadata);
      if (!hasAudio && qualities.length === 0) {
        await ctx.api.editMessageText(chatId, placeholder.message_id, renderNoFormats(metadata), { parse_mode: 'HTML' });
        return;
      }

      selections.set(placeholder.message_id, {
        chatId,
        userId,
        videoId: parsed.value.videoId,
        metadata,
      });
      await ctx.api.editMessageText(
        chatId,
        placeholder.message_id,
        renderVideoInfo(metadata, qualities, hasAudio, parsed.value.hadPlaylistParam, config.uploadLimitBytes),
        { parse_mode: 'HTML', reply_markup: formatSelectionKeyboard(parsed.value.videoId, qualities, hasAudio) },
      );
    } catch (error) {
      logger.warn('metadata_failed', { chatId, videoId: parsed.value.videoId, error });
      ignoreFailure(
        ctx.api.editMessageText(chatId, placeholder.message_id, renderError(userMessageForError(error, config.uploadLimitBytes)), {
          parse_mode: 'HTML',
        }),
      );
    } finally {
      busyChats.delete(chatId);
    }
  });

  bot.on('message', async (ctx) => {
    await ctx.reply(TEXT_ONLY_REPLY);
  });

  function startTask(state: TaskState, task: Task): void {
    tasks.set(task.id, state);
    const result = queue.add(task);
    if (result.accepted) return;
    tasks.delete(task.id);
    state.status.finish(
      renderFailed(
        state.metadata.current,
        state.selection,
        result.reason === 'queue_full' ? QUEUE_FULL_MESSAGE : 'Такая задача уже выполняется.',
      ),
    );
  }

  bot.on('callback_query:data', async (ctx) => {
    const action = parseCallbackData(ctx.callbackQuery.data);
    const message = ctx.callbackQuery.message;
    const chatId = message?.chat.id;
    const userId = ctx.from?.id;
    if (!action || chatId === undefined || userId === undefined || message === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (action.kind === 'cancel') {
      const result = queue.cancel(action.taskId, userId);
      const text =
        result === 'cancelled'
          ? 'Задача отменена.'
          : result === 'cancel_requested'
            ? 'Останавливаю загрузку…'
            : result === 'forbidden'
              ? 'Это чужая задача.'
              : 'Задача уже завершена.';
      await ctx.answerCallbackQuery(result === 'forbidden' || result === 'not_found' ? { text, show_alert: true } : { text });
      return;
    }

    const entry = selections.get(message.message_id);
    if (!entry || entry.videoId !== action.videoId || entry.chatId !== chatId) {
      await ctx.answerCallbackQuery({ text: STALE_SELECTION_REPLY, show_alert: true });
      return;
    }
    if (queue.pendingCount >= config.maxQueueSize) {
      await ctx.answerCallbackQuery({ text: renderQueueFull(), show_alert: true });
      return;
    }

    selections.take(message.message_id);
    const taskId = randomUUID();
    const metadata: MetadataBox = { current: entry.metadata };
    const status = new StatusMessage(
      bot.api,
      chatId,
      message.message_id,
      (update) => renderProgress(metadata.current, action.selection, update),
      cancelKeyboard(taskId),
      config.progressUpdateIntervalMs,
      logger,
    );
    const task = createDownloadTask({
      id: taskId,
      ownerId: userId,
      chatId,
      videoId: action.videoId,
      selection: action.selection,
      config,
      sender,
      logger,
      workRoot,
      onMetadata: (fresh) => {
        metadata.current = fresh;
      },
    });

    startTask({ chatId, selection: action.selection, metadata, status }, task);
    await ctx.answerCallbackQuery();
  });

  bot.catch((error: BotError) => {
    logger.error('update_failed', { error: error.error, updateId: error.ctx.update.update_id });
  });

  // bot.init() в grammY ретраит сетевые ошибки бесконечно, поэтому ограничиваем
  // весь стартовый обмен с Bot API общим таймаутом — иначе процесс висит молча.
  const startupSignal = AbortSignal.timeout(STARTUP_API_TIMEOUT_MS);
  const telegramSignal = toTelegramSignal(startupSignal);
  try {
    await bot.init(telegramSignal);
    await bot.api.deleteWebhook({ drop_pending_updates: true }, telegramSignal);
    await bot.api.setMyCommands(
      [
        { command: 'start', description: 'Начало работы' },
        { command: 'help', description: 'Как пользоваться ботом' },
      ],
      undefined,
      telegramSignal,
    );
  } catch (error) {
    throw new TelegramStartupError(config.telegramApiRoot, startupSignal.aborted, error);
  }

  const runner: RunnerHandle = run(bot, {
    runner: {
      fetch: { timeout: POLLING_TIMEOUT_SEC, allowed_updates: [...ALLOWED_UPDATES] },
      retryInterval: 'exponential',
    },
  });
  logger.info('bot_started', { username: bot.botInfo.username, concurrency: config.maxConcurrentDownloads });

  let stopped = false;
  async function shutdown(): Promise<void> {
    if (stopped) return;
    stopped = true;
    await runner.stop().catch((error: unknown) => logger.warn('runner_stop_failed', { error }));
    queue.cancelAll();
    const drained = await queue.waitForIdle(QUEUE_DRAIN_TIMEOUT_MS);
    if (!drained) {
      logger.warn('shutdown_drain_timeout', { pending: queue.pendingCount, running: queue.runningCount });
    }
    for (const state of tasks.values()) state.status.dispose();
    const aborted = tasks.size;
    tasks.clear();
    logger.info('bot_stopped', { abortedTasks: aborted });
  }

  return { bot, queue, shutdown };
}
