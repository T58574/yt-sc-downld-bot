/**
 * Замер скорости отправки файла в Telegram через MTProto.
 *
 * Запуск (из корня репозитория):
 *   node --env-file=.env scripts/bench/upload-throughput-bench.mjs <файл> [воркеров]
 *
 * Пример:
 *   dd if=/dev/urandom of=/tmp/bench-200mb.bin bs=1M count=200
 *   node --env-file=.env scripts/bench/upload-throughput-bench.mjs /tmp/bench-200mb.bin 16
 *
 * Сессия MTProto копируется в отдельный файл — боевая не трогается.
 * Файл уходит в первый чат из ALLOWED_TELEGRAM_IDS (тестовая отправка).
 */
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramClient, client as gram, sessions } from 'telegram';

const [filePath, workersArg] = process.argv.slice(2);
if (!filePath) {
  console.error('usage: upload-throughput-bench.mjs <file> [workers]');
  process.exit(1);
}
const workers = Number(workersArg ?? 16);

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const chatId = Number(process.env.ALLOWED_TELEGRAM_IDS?.split(/[\s,;]+/)[0]);
const sourceSession =
  process.env.MPROTO_SESSION_FILE ?? join(process.cwd(), 'data', 'mtproto-session.txt');

if (!apiId || !apiHash || !chatId) {
  console.error('Нужны TELEGRAM_API_ID, TELEGRAM_API_HASH и ALLOWED_TELEGRAM_IDS в .env');
  process.exit(1);
}

const workDir = await mkdtemp(join(tmpdir(), 'mtproto-bench-'));
const sessionFile = join(workDir, 'session.txt');
await copyFile(sourceSession, sessionFile);

const session = new sessions.StringSession((await readFile(sessionFile, 'utf8')).trim());
await session.load();

const client = new TelegramClient(session, apiId, apiHash, {
  deviceModel: 'ytbot-bench',
  systemVersion: 'Linux',
  appVersion: '1.0.0',
});

try {
  await client.connect();
  const me = await client.getMe();
  const size = (await stat(filePath)).size;
  const mib = size / 1048576;
  console.log(`bot: @${me.username}  chat: ${chatId}  size: ${mib.toFixed(1)} MiB  workers: ${workers}`);

  let lastPercent = -1;
  const startedAt = Date.now();
  await client.sendFile(chatId, {
    file: new gram.uploads.CustomFile(filePath.split('/').pop(), size, filePath),
    forceDocument: true,
    workers,
    progressCallback: (progress) => {
      const percent = Math.min(100, Math.round(progress * 100));
      if (percent === lastPercent || percent % 20 !== 0) return;
      lastPercent = percent;
      const seconds = (Date.now() - startedAt) / 1000;
      console.log(`${percent}%  ${((percent / 100) * mib / seconds).toFixed(1)} MiB/s  (${seconds.toFixed(1)}s)`);
    },
  });

  const seconds = (Date.now() - startedAt) / 1000;
  console.log(`DONE ${mib.toFixed(1)} MiB in ${seconds.toFixed(1)}s = ${(mib / seconds).toFixed(1)} MiB/s`);
} finally {
  await client.destroy().catch(() => undefined);
  await rm(workDir, { recursive: true, force: true });
}
