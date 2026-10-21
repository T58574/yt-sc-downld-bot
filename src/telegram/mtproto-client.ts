import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Logger as GramLogger, TelegramClient, sessions } from 'telegram';
import { MtprotoStartupError } from '../errors.js';
import type { Logger } from '../logger.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

type GramLogLevel = ConstructorParameters<typeof GramLogger>[0];

/** Внутренние сообщения GramJS уводим в наш JSON-лог на уровне debug. */
class MtprotoLogger extends GramLogger {
  constructor(private readonly sink: Logger) {
    super('debug' as GramLogLevel);
  }

  override log(level: string, message: string): void {
    this.sink.debug('mtproto', { level, message });
  }
}

export interface MtprotoClientOptions {
  apiId: number;
  apiHash: string;
  botToken: string;
  sessionFile: string;
  logger: Logger;
}

export interface MtprotoClient {
  readonly client: TelegramClient;
  close: () => Promise<void>;
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'errorMessage' in error) {
    return String((error as { errorMessage?: unknown }).errorMessage ?? '');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Сессия отозвана Telegram (смена api_id, релогин бота, истечение сессии). */
export function isAuthKeyError(error: unknown): boolean {
  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|AUTH_KEY_PERM_EMPTY/i.test(errorText(error));
}

async function readSession(file: string): Promise<string> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function writeSession(file: string, value: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: SESSION_DIR_MODE });
  await writeFile(file, value, { encoding: 'utf8', mode: SESSION_FILE_MODE });
  // mode из writeFile действует только при создании файла — права выставляем явно.
  await chmod(file, SESSION_FILE_MODE);
}

/** Битая строка сессии не должна ронять старт: просто заходим заново. */
function buildSession(value: string): sessions.StringSession {
  try {
    return new sessions.StringSession(value);
  } catch {
    return new sessions.StringSession('');
  }
}

function buildClient(options: MtprotoClientOptions, session: sessions.StringSession): TelegramClient {
  return new TelegramClient(session, options.apiId, options.apiHash, {
    baseLogger: new MtprotoLogger(options.logger),
    deviceModel: 'youtube-download-bot',
    systemVersion: 'Linux',
    appVersion: '1.0.0',
    langCode: 'ru',
    systemLangCode: 'ru',
  });
}

/**
 * Вход в бота по токену через MTProto (auth.importBotAuthorization).
 * Готовую сессию переиспользуем: каждый новый importBotAuthorization — это
 * новая авторизация бота, а Telegram ставит на них flood-лимит.
 */
async function authorize(
  client: TelegramClient,
  session: sessions.StringSession,
  hadSavedKey: boolean,
  options: MtprotoClientOptions,
): Promise<void> {
  if (hadSavedKey) {
    try {
      await client.getMe();
      return;
    } catch (error) {
      if (!isAuthKeyError(error)) throw error;
      options.logger.warn('mtproto_session_stale', { error: errorText(error) });
    }
  }
  await client.signInBot({ apiId: options.apiId, apiHash: options.apiHash }, { botAuthToken: options.botToken });
  await writeSession(options.sessionFile, session.save());
  options.logger.info('mtproto_signed_in', { apiId: options.apiId });
}

/**
 * Поднимает MTProto-клиента бота. Бросает MtprotoStartupError, если Telegram
 * не пускает: без рабочей MTProto-сессии большие файлы отправлять нечем.
 */
export async function createMtprotoClient(options: MtprotoClientOptions): Promise<MtprotoClient> {
  const saved = await readSession(options.sessionFile);
  const attempts = saved ? [saved, ''] : [''];
  let lastError: unknown;

  for (const value of attempts) {
    const session = buildSession(value);
    // Ключ лежит в файле сессии, но появляется в объекте только после load().
    await session.load();
    const hadSavedKey = Boolean(session.authKey);
    const client = buildClient(options, session);
    try {
      await client.connect();
      await authorize(client, session, hadSavedKey, options);
      return {
        client,
        close: async () => {
          // destroy(), а не disconnect(): останавливает ping-loop GramJS,
          // иначе он успевает выстрелить таймаутом в консоль на выходе.
          await client.destroy();
        },
      };
    } catch (error) {
      lastError = error;
      await client.disconnect().catch(() => undefined);
      if (!isAuthKeyError(error)) break;
      options.logger.warn('mtproto_retry_with_new_session', { error: errorText(error) });
    }
  }

  throw new MtprotoStartupError(lastError);
}
