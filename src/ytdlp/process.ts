import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import {
  ExternalCommandError,
  ProcessTimeoutError,
  TaskCancelledError,
  ToolNotFoundError,
  asError,
} from '../errors.js';

const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 512 * 1024;
const KILL_GRACE_MS = 5_000;
const LINE_BREAK_PATTERN = /\r\n|\n|\r/;

export interface RunProcessOptions {
  bin: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new TaskCancelledError();
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Процесс уже завершился.
    }
  }
}

function childEnv(overrides: NodeJS.ProcessEnv | undefined, cwd: string | undefined): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  if (cwd) {
    base.HOME = cwd;
    base.TMPDIR = cwd;
    base.XDG_CACHE_HOME = cwd;
  }
  return { ...base, ...overrides };
}

export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));

  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    let abortError: Error | undefined;
    let spawnError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let stdout = '';
    let stderr = '';
    const stdoutLimit = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    const stderrLimit = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const child = spawn(options.bin, [...options.args], {
      cwd: options.cwd,
      env: childEnv(options.env, options.cwd),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    });

    function emitLine(rawLine: string): void {
      const line = rawLine.trimEnd();
      if (!line || !options.onLine) return;
      try {
        options.onLine(line);
      } catch {
        // Ошибка обработчика строки не должна ломать управление процессом.
      }
    }

    function feed(kind: 'stdout' | 'stderr', chunk: string): void {
      if (kind === 'stdout') stdoutBuffer += chunk;
      else stderrBuffer += chunk;

      let match = LINE_BREAK_PATTERN.exec(kind === 'stdout' ? stdoutBuffer : stderrBuffer);
      while (match) {
        const buffer = kind === 'stdout' ? stdoutBuffer : stderrBuffer;
        const line = buffer.slice(0, match.index);
        const rest = buffer.slice(match.index + match[0].length);
        if (kind === 'stdout') stdoutBuffer = rest;
        else stderrBuffer = rest;
        emitLine(line);
        if (kind === 'stdout') appendStdout(line);
        else appendStderr(line);
        match = LINE_BREAK_PATTERN.exec(kind === 'stdout' ? stdoutBuffer : stderrBuffer);
      }
    }

    function appendStdout(chunk: string): void {
      if (stdout.length >= stdoutLimit) return;
      stdout += chunk.slice(0, stdoutLimit - stdout.length);
      if (!stdout.endsWith('\n') && stdout.length < stdoutLimit) stdout += '\n';
    }

    function appendStderr(chunk: string): void {
      stderr += `${chunk}\n`;
      if (stderr.length > stderrLimit) stderr = stderr.slice(-stderrLimit);
    }

    function cleanup(): void {
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    function finish(error: Error | undefined, code: number | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      if (stdoutBuffer) {
        emitLine(stdoutBuffer);
        appendStdout(stdoutBuffer);
      }
      if (stderrBuffer) {
        emitLine(stderrBuffer);
        appendStderr(stderrBuffer);
      }
      if (error) {
        reject(error);
        return;
      }
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new ExternalCommandError(options.bin, code, stderr));
    }

    function onAbort(): void {
      if (options.signal?.aborted && !abortError) {
        abortError = abortReason(options.signal);
        signalChild(child, 'SIGTERM');
        killTimer = setTimeout(() => signalChild(child, 'SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) feed('stdout', text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) feed('stderr', text);
    });

    child.once('error', (error) => {
      spawnError =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new ToolNotFoundError(options.bin)
          : new Error(`Не удалось запустить ${options.bin}: ${asError(error).message}`);
      finish(spawnError, null);
    });

    child.once('close', (code) => {
      const stdoutRest = stdoutDecoder.end();
      if (stdoutRest) feed('stdout', stdoutRest);
      const stderrRest = stderrDecoder.end();
      if (stderrRest) feed('stderr', stderrRest);
      finish(abortError ?? spawnError, code);
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });

    if (options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (abortError) return;
        abortError = new ProcessTimeoutError(options.timeoutMs);
        signalChild(child, 'SIGTERM');
        killTimer = setTimeout(() => signalChild(child, 'SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
      }, options.timeoutMs);
    }
  });
}
