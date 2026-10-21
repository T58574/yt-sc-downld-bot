import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/logger.js';
import { TaskQueue, type QueueEvent } from '../src/queue.js';
import type { Task } from '../src/types.js';

const TICK_MS = 5;

function task(id: string, run: Task['run'], ownerId = 1): Task {
  return { id, ownerId, label: id, run };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createQueue(concurrency: number, maxQueueSize = 10) {
  const events: QueueEvent[] = [];
  const queue = new TaskQueue({
    concurrency,
    maxQueueSize,
    logger: silentLogger,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { queue, events };
}

describe('TaskQueue', () => {
  it('запускает не больше задач, чем позволяет concurrency', async () => {
    const { queue, events } = createQueue(1);
    const first = deferred();
    const second = deferred();
    queue.add(task('a', () => first.promise));
    queue.add(task('b', () => second.promise));
    await wait(TICK_MS);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    first.resolve();
    await wait(TICK_MS);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(0);
    second.resolve();
    await queue.waitForIdle(1000);

    const started = events.filter((event) => event.type === 'started').map((event) => event.task.id);
    expect(started).toEqual(['a', 'b']);
    expect(events.filter((event) => event.type === 'finished').length).toBe(2);
  });

  it('сообщает позицию в очереди и обновляет её после старта', async () => {
    const { queue, events } = createQueue(1);
    const gate = deferred();
    const queued = queue.add(task('a', () => gate.promise));
    expect(queued).toEqual({ accepted: true, taskId: 'a' });
    queue.add(task('b', () => Promise.resolve()));
    queue.add(task('c', () => Promise.resolve()));
    await wait(TICK_MS);

    const positions = () =>
      events.flatMap((event) =>
        event.type === 'queued' || event.type === 'position' ? [`${event.task.id}:${event.position}`] : [],
      );
    expect(positions()).toContain('b:1');
    expect(positions()).toContain('c:2');
    expect(positions()).not.toContain('b:2');

    gate.resolve();
    await queue.waitForIdle(1000);
    expect(positions()).toContain('c:1');
  });

  it('передаёт обновления прогресса с идентификатором задачи', async () => {
    const { queue, events } = createQueue(1);
    const gate = deferred();
    queue.add(
      task('a', async (context) => {
        context.report({ stage: 'downloading', percent: 42 });
        await gate.promise;
      }),
    );
    await wait(TICK_MS);
    const progress = events.find((event) => event.type === 'progress');
    expect(progress).toMatchObject({ task: { id: 'a' }, update: { stage: 'downloading', percent: 42 } });
    gate.resolve();
    await queue.waitForIdle(1000);
  });

  it('не принимает дубликаты и переполнение очереди', async () => {
    const { queue } = createQueue(1, 1);
    const gate = deferred();
    queue.add(task('a', () => gate.promise));
    expect(queue.add(task('b', () => Promise.resolve()))).toEqual({ accepted: true, taskId: 'b' });
    expect(queue.add(task('c', () => Promise.resolve()))).toEqual({ accepted: false, reason: 'queue_full' });
    expect(queue.add(task('b', () => Promise.resolve()))).toEqual({ accepted: false, reason: 'duplicate' });
    gate.resolve();
    await queue.waitForIdle(1000);
  });

  it('изолирует падение одной задачи', async () => {
    const { queue, events } = createQueue(2);
    queue.add(task('bad', () => Promise.reject(new Error('boom'))));
    queue.add(task('good', () => Promise.resolve()));
    await queue.waitForIdle(1000);
    expect(events.filter((event) => event.type === 'failed').map((event) => event.task.id)).toEqual(['bad']);
    expect(events.filter((event) => event.type === 'finished').map((event) => event.task.id)).toEqual(['good']);
  });

  it('отменяет задачу в очереди и сообщает об этом', async () => {
    const { queue, events } = createQueue(1);
    const gate = deferred();
    queue.add(task('a', () => gate.promise));
    queue.add(task('b', () => Promise.resolve(), 7));
    await wait(TICK_MS);

    expect(queue.cancel('b', 999)).toBe('forbidden');
    expect(queue.cancel('b', 7)).toBe('cancelled');
    expect(queue.cancel('b', 7)).toBe('not_found');
    gate.resolve();
    await queue.waitForIdle(1000);
    expect(events.filter((event) => event.type === 'cancelled')).toHaveLength(1);
  });

  it('прерывает выполняющуюся задачу через AbortSignal', async () => {
    const { queue, events } = createQueue(1);
    const started = deferred();
    const aborted = deferred();
    queue.add(
      task('a', async (context) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => {
            aborted.resolve();
            resolve();
          });
        });
        throw context.signal.reason;
      }),
    );
    await started.promise;
    expect(queue.cancel('a', 1)).toBe('cancel_requested');
    await aborted.promise;
    await queue.waitForIdle(1000);
    const cancelled = events.find((event) => event.type === 'cancelled');
    expect(cancelled).toMatchObject({ task: { id: 'a' }, wasRunning: true });
  });

  it('cancelAll останавливает очередь целиком', async () => {
    const { queue, events } = createQueue(1);
    const gate = deferred();
    queue.add(
      task('a', async (context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve());
        });
      }),
    );
    queue.add(task('b', () => gate.promise));
    await wait(TICK_MS);
    queue.cancelAll();
    expect(await queue.waitForIdle(1000)).toBe(true);
    expect(events.filter((event) => event.type === 'cancelled')).toHaveLength(2);
    expect(queue.idle).toBe(true);
  });

  it('сообщает, что очередь не опустошилась за отведённое время', async () => {
    const { queue } = createQueue(1);
    const gate = deferred();
    queue.add(task('a', () => gate.promise));
    await wait(TICK_MS);
    expect(await queue.waitForIdle(30)).toBe(false);
    gate.resolve();
    await queue.waitForIdle(1000);
  });
});
