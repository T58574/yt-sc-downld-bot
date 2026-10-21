import { loadConfig } from './config.js';
import { asError } from './errors.js';
import { cleanupStaleTaskDirs, prepareWorkRoot } from './files.js';
import { createLogger, redactText, type Logger } from './logger.js';
import { startBot } from './telegram/bot.js';
import { verifyTools } from './ytdlp/tools.js';

const REQUIRED_NODE_MAJOR = 24;
const SHUTDOWN_TIMEOUT_MS = 30_000;

function nodeMajor(): number {
  const raw = process.versions.node.split('.')[0] ?? '';
  return Number.parseInt(raw, 10);
}

function reportStartupFailure(error: unknown): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level: 'error',
    event: 'startup_failed',
    message: redactText(asError(error).message),
  });
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger: Logger = createLogger(config.logLevel);

  if (!Number.isInteger(nodeMajor()) || nodeMajor() < REQUIRED_NODE_MAJOR) {
    throw new Error(`Требуется Node.js ${REQUIRED_NODE_MAJOR}+, сейчас ${process.versions.node}`);
  }
  for (const warning of config.warnings) logger.warn('config_warning', { message: warning });

  const workRoot = await prepareWorkRoot(config.workDir);
  const removedDirs = await cleanupStaleTaskDirs(workRoot);
  if (removedDirs > 0) logger.info('stale_task_dirs_removed', { count: removedDirs });

  const tools = await verifyTools(config, logger);
  const runtime = await startBot({ config, logger, workRoot });
  logger.info('startup_complete', {
    node: process.versions.node,
    workDir: workRoot,
    ytdlp: tools.ytdlp,
    ffmpeg: tools.ffmpeg,
    concurrency: config.maxConcurrentDownloads,
    queueLimit: config.maxQueueSize,
    uploadLimitMb: config.uploadLimitMb,
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal });
    const forceTimer = setTimeout(() => {
      logger.error('shutdown_timeout', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();
    try {
      await runtime.shutdown();
    } catch (error) {
      logger.error('shutdown_failed', { error });
    }
    clearTimeout(forceTimer);
    logger.info('shutdown_complete', { signal });
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled_rejection', { error: asError(reason) });
  });
  process.on('uncaughtException', (error: Error) => {
    logger.error('uncaught_exception', { error });
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });
}

main().catch(reportStartupFailure);
