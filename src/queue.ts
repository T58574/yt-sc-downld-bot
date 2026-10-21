import { TaskCancelledError } from './errors.js';
import type { Logger } from './logger.js';
import type { ProgressUpdate, Task } from './types.js';

export type QueueEvent =
  | { type: 'queued'; task: Task; position: number }
  | { type: 'position'; task: Task; position: number }
  | { type: 'started'; task: Task }
  | { type: 'progress'; task: Task; update: ProgressUpdate }
  | { type: 'finished'; task: Task }
  | { type: 'failed'; task: Task; error: unknown }
  | { type: 'cancelled'; task: Task; wasRunning: boolean };

export type QueueEventSink = (event: QueueEvent) => void | Promise<void>;
export type AddResult =
  | { accepted: true; taskId: string }
  | { accepted: false; reason: 'queue_full' | 'duplicate' };
export type CancelResult = 'cancelled' | 'cancel_requested' | 'not_found' | 'forbidden';

export interface TaskQueueOptions {
  concurrency: number;
  maxQueueSize: number;
  logger: Logger;
  onEvent: QueueEventSink;
}

interface RunningTask {
  task: Task;
  controller: AbortController;
}

export class TaskQueue {
  private readonly pending: Task[] = [];
  private readonly running = new Map<string, RunningTask>();
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly logger: Logger;
  private readonly onEvent: QueueEventSink;

  constructor(options: TaskQueueOptions) {
    if (options.concurrency < 1) throw new Error('concurrency должен быть >= 1');
    if (options.maxQueueSize < 1) throw new Error('maxQueueSize должен быть >= 1');
    this.concurrency = options.concurrency;
    this.maxQueueSize = options.maxQueueSize;
    this.logger = options.logger;
    this.onEvent = options.onEvent;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get runningCount(): number {
    return this.running.size;
  }

  get idle(): boolean {
    return this.pending.length === 0 && this.running.size === 0;
  }

  add(task: Task): AddResult {
    if (this.pending.some((entry) => entry.id === task.id) || this.running.has(task.id)) {
      return { accepted: false, reason: 'duplicate' };
    }
    if (this.pending.length >= this.maxQueueSize) return { accepted: false, reason: 'queue_full' };
    this.pending.push(task);
    this.emit({ type: 'queued', task, position: this.pending.length });
    this.pump();
    return { accepted: true, taskId: task.id };
  }

  cancel(taskId: string, ownerId: number): CancelResult {
    const pendingIndex = this.pending.findIndex((task) => task.id === taskId);
    if (pendingIndex >= 0) {
      const task = this.pending[pendingIndex];
      if (!task) return 'not_found';
      if (task.ownerId !== ownerId) return 'forbidden';
      this.pending.splice(pendingIndex, 1);
      this.emit({ type: 'cancelled', task, wasRunning: false });
      this.emitPositions();
      return 'cancelled';
    }

    const running = this.running.get(taskId);
    if (!running) return 'not_found';
    if (running.task.ownerId !== ownerId) return 'forbidden';
    running.controller.abort(new TaskCancelledError('Отменено пользователем'));
    return 'cancel_requested';
  }

  cancelAll(): void {
    const pending = this.pending.splice(0, this.pending.length);
    for (const task of pending) this.emit({ type: 'cancelled', task, wasRunning: false });
    for (const running of this.running.values()) {
      running.controller.abort(new TaskCancelledError('Остановка бота'));
    }
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.idle) return true;
    const startedAt = Date.now();
    return new Promise<boolean>((resolve) => {
      const timer = setInterval(() => {
        if (this.idle) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 50);
      timer.unref();
    });
  }

  private emit(event: QueueEvent): void {
    try {
      const result = this.onEvent(event);
      if (result instanceof Promise) {
        result.catch((error: unknown) => this.logger.error('queue_event_failed', { error, event: event.type }));
      }
    } catch (error) {
      this.logger.error('queue_event_failed', { error, event: event.type });
    }
  }

  private emitPositions(): void {
    this.pending.forEach((task, index) => this.emit({ type: 'position', task, position: index + 1 }));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) return;
      const controller = new AbortController();
      this.running.set(task.id, { task, controller });
      this.emit({ type: 'started', task });
      this.emitPositions();
      void this.execute(task, controller);
    }
  }

  private async execute(task: Task, controller: AbortController): Promise<void> {
    this.logger.info('task_started', { taskId: task.id, ownerId: task.ownerId, label: task.label });
    try {
      await task.run({
        signal: controller.signal,
        report: (update) => this.emit({ type: 'progress', task, update }),
      });
      if (controller.signal.aborted) throw new TaskCancelledError();
      this.emit({ type: 'finished', task });
      this.logger.info('task_finished', { taskId: task.id, ownerId: task.ownerId, label: task.label });
    } catch (error) {
      if (controller.signal.aborted || error instanceof TaskCancelledError) {
        this.emit({ type: 'cancelled', task, wasRunning: true });
        this.logger.info('task_cancelled', { taskId: task.id, ownerId: task.ownerId, label: task.label });
      } else {
        this.emit({ type: 'failed', task, error });
        this.logger.error('task_failed', { taskId: task.id, ownerId: task.ownerId, label: task.label, error });
      }
    } finally {
      this.running.delete(task.id);
      this.pump();
    }
  }
}
