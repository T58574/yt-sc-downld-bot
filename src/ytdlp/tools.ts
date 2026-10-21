import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import { ToolNotFoundError } from '../errors.js';
import type { Logger } from '../logger.js';

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 15_000;
const VERSION_MAX_BUFFER = 1024 * 1024;

export interface ToolVersions {
  ytdlp: string;
  ffmpeg: string;
  ffprobe: string;
}

async function firstLine(binary: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: VERSION_MAX_BUFFER,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
      },
    });
    return stdout.split(/\r?\n/, 1)[0]?.trim() || 'unknown';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ToolNotFoundError(binary);
    throw error;
  }
}

export async function verifyTools(config: Pick<AppConfig, 'ytdlpBin' | 'ffmpegBin' | 'ffprobeBin'>, logger: Logger): Promise<ToolVersions> {
  const [ytdlp, ffmpeg, ffprobe] = await Promise.all([
    firstLine(config.ytdlpBin, ['--version']),
    firstLine(config.ffmpegBin, ['-version']),
    firstLine(config.ffprobeBin, ['-version']),
  ]);
  const versions = { ytdlp, ffmpeg, ffprobe };
  logger.info('tools_ready', versions);
  return versions;
}
