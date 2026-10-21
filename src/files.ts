import { mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const TASK_DIR_PREFIX = 'job-';

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

export async function prepareWorkRoot(workDir: string): Promise<string> {
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const resolved = await realpath(workDir);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

export async function createTaskDir(workRoot: string): Promise<string> {
  const dir = await mkdtemp(join(workRoot, TASK_DIR_PREFIX));
  return realpath(dir);
}

export async function removeTaskDir(taskDir: string, workRoot: string): Promise<void> {
  if (!isPathInside(workRoot, taskDir)) return;
  await rm(taskDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export async function cleanupStaleTaskDirs(workRoot: string): Promise<number> {
  let removed = 0;
  let entries;
  try {
    entries = await readdir(workRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TASK_DIR_PREFIX)) continue;
    const path = join(workRoot, entry.name);
    if (!isPathInside(workRoot, path)) continue;
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      removed += 1;
    } catch {
      // Каталог мог быть удалён параллельно.
    }
  }
  return removed;
}

export async function findOutputFile(taskDir: string, extension: string): Promise<string> {
  const root = await realpath(taskDir);
  const entries = await readdir(root, { withFileTypes: true });
  const suffix = `.${extension.toLowerCase()}`;
  const candidates: Array<{ path: string; size: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(suffix)) continue;
    const candidatePath = join(root, entry.name);
    const candidateRealPath = await realpath(candidatePath);
    if (!isPathInside(root, candidateRealPath)) continue;
    const info = await stat(candidateRealPath);
    if (!info.isFile() || info.size <= 0) continue;
    candidates.push({ path: candidateRealPath, size: info.size });
  }

  if (candidates.length === 0) return '';
  candidates.sort((left, right) => right.size - left.size);
  return candidates[0]?.path ?? '';
}
