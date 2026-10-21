import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupStaleTaskDirs, createTaskDir, findOutputFile, isPathInside, prepareWorkRoot, removeTaskDir } from '../src/files.js';

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'ydb-files-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('isPathInside', () => {
  it('разрешает вложенные пути и запрещает выход за корень', () => {
    expect(isPathInside('/data/work', '/data/work/job-1')).toBe(true);
    expect(isPathInside('/data/work', '/data/work')).toBe(true);
    expect(isPathInside('/data/work', '/data/worker/job-1')).toBe(false);
    expect(isPathInside('/data/work', '/data/work/../secret')).toBe(false);
    expect(isPathInside('/data/work', '/etc/passwd')).toBe(false);
  });
});

describe('рабочие каталоги задач', () => {
  it('готовит корень и создаёт каталоги задач внутри него', async () => {
    const root = await prepareWorkRoot(join(base, 'nested', 'work'));
    const taskDir = await createTaskDir(root);
    expect(taskDir.startsWith(root)).toBe(true);
    expect((await stat(taskDir)).isDirectory()).toBe(true);

    await writeFile(join(taskDir, 'video.mp4'), 'data');
    await removeTaskDir(taskDir, root);
    await expect(stat(taskDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('не удаляет каталоги вне корня', async () => {
    const root = await prepareWorkRoot(join(base, 'guard', 'work'));
    const outside = await mkdtemp(join(base, 'guard-outside-'));
    await expect(removeTaskDir(outside, root)).resolves.toBeUndefined();
    expect((await stat(outside)).isDirectory()).toBe(true);
  });

  it('убирает только осиротевшие каталоги задач', async () => {
    const root = await prepareWorkRoot(join(base, 'stale', 'work'));
    const stale = await createTaskDir(root);
    await writeFile(join(root, 'keep.txt'), 'important');
    const other = join(root, 'not-a-job');
    await mkdir(other);

    const removed = await cleanupStaleTaskDirs(root);
    expect(removed).toBe(1);
    await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(other)).isDirectory()).toBe(true);
    expect((await stat(join(root, 'keep.txt'))).isFile()).toBe(true);
  });
});

describe('findOutputFile', () => {
  it('находит самый крупный файл с нужным расширением', async () => {
    const root = await prepareWorkRoot(join(base, 'find', 'work'));
    const taskDir = await createTaskDir(root);
    await writeFile(join(taskDir, 'a.mp4'), 'small');
    await writeFile(join(taskDir, 'b.mp4'), 'much bigger content');
    await writeFile(join(taskDir, 'c.webm'), 'webm content');

    expect(await findOutputFile(taskDir, 'mp4')).toBe(join(taskDir, 'b.mp4'));
  });

  it('игнорирует пустые файлы и возвращает пустую строку, если файла нет', async () => {
    const root = await prepareWorkRoot(join(base, 'empty', 'work'));
    const taskDir = await createTaskDir(root);
    await writeFile(join(taskDir, 'broken.mp3'), '');
    expect(await findOutputFile(taskDir, 'mp3')).toBe('');
    expect(await findOutputFile(taskDir, 'mp4')).toBe('');
  });

  it('не путает расширения по подстроке', async () => {
    const root = await prepareWorkRoot(join(base, 'suffix', 'work'));
    const taskDir = await createTaskDir(root);
    await writeFile(join(taskDir, 'video.mp4.part'), 'partial data');
    expect(await findOutputFile(taskDir, 'mp4')).toBe('');
  });
});
