# YouTube Download Bot

Telegram-бот на TypeScript: скачивает **одиночные видео YouTube** (MP3 или MP4 H.264/AAC с выбором качества) и **треки SoundCloud** (сразу в MP3) — с реальным прогрессом из `yt-dlp` и отменой задачи.

[English version →](README.en.md)

## Проектные документы

Продукт, монетизация, замеры себестоимости, лимиты Telegram и план работ — в [`docs/`](docs/README.md).
Журнал решений — [`docs/90-decisions.md`](docs/90-decisions.md). Скрипты замеров — в `scripts/bench/`.

## Возможности

- ссылки `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/embed/…`, `/v/…`; параметр `list=` игнорируется — скачивается только указанное видео;
- ссылки SoundCloud `soundcloud.com/artist/track` и короткие `on.soundcloud.com/…` — трек скачивается сразу в MP3, без выбора качества и MP4;
- выбор формата кнопками: MP3 (LAME V0) или MP4 H.264/AAC до 8 вариантов качества;
- прогресс из настоящего вывода `yt-dlp`: проценты считаются только по достоверному размеру, иначе показываются скачанные байты; скорость и ETA — из `yt-dlp`;
- отмена кнопкой: процесс `yt-dlp` останавливается, временные файлы удаляются;
- очередь загрузок с настраиваемым лимитом параллельности и длины;
- доступ только для Telegram ID из конфига, только в личных чатах;
- JSON-логи с редактированием секретов, корректное завершение по `SIGTERM`/`SIGINT`, systemd-юнит в комплекте.

## Требования

| Компонент | Версия в разработке | Источник | Зачем |
|---|---|---|---|
| Node.js | 24.22.1 LTS (Krypton), `engines: ^24` | [nodejs.org](https://nodejs.org/en/download) | среда выполнения бота; для JS-рантайма EJS у `yt-dlp` требуется Node ≥ 22 |
| yt-dlp | nightly `2026.10.10.233141` | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases), канал `nightly` | собственно скачивание; ночная сборка — быстрее чинятся поломки YouTube |
| yt-dlp-ejs | 0.8.0 (уже внутри официального бинарника `yt-dlp`) | [yt-dlp/ejs](https://github.com/yt-dlp/ejs) | «full YouTube support»; без JS-рантайма часть форматов не находится |
| ffmpeg / ffprobe | 5.1.9-0+deb12u1 (Debian bookworm) | `apt` | объединение видео+аудио и конвертация в MP3 |
| grammY | 1.46.0 | npm | Telegram-фреймворк (long polling) |
| @grammyjs/runner | 2.0.3 | npm | параллельная обработка апдейтов, чтобы долгие задачи не блокировали бота |
| telegram (GramJS) | 2.26.22 | npm | MTProto-клиент: вход бота по токену и отправка файлов до 2000 МиБ |
| TypeScript / vitest / tsx / @types/node | 7.0.2 / 5.0.5 / 4.23.15 / 24.19.2 | npm (dev) | сборка, тесты, dev-запуск |

Все npm-зависимости зафиксированы точными версиями (без `^` и `~`); дерево — в `package-lock.json` (lockfileVersion 3), воспроизводимая установка — `npm ci`.

### Почему именно так

- **Node.js 24 LTS** — актуальный LTS. Бот передаёт путь к своему Node в `yt-dlp` явно: `--js-runtimes node:<process.execPath>`, поэтому ставить Deno не нужно.
- **yt-dlp nightly** — YouTube регулярно ломает извлечение форматов; в nightly исправления попадают раньше, чем в stable. Официальный бинарник уже содержит `yt-dlp-ejs`.
- **ffmpeg/ffprobe** — без них `yt-dlp` не соберёт MP4 из отдельных потоков и не сделает MP3; версия из Debian стабильна и достаточна для H.264/AAC.

## Установка внешних инструментов

### Node.js (пример для x86_64 Linux)

```bash
NODE_VERSION=v24.22.1
curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
grep "node-${NODE_VERSION}-linux-x64.tar.xz" SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local/lib/nodejs
sudo ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-x64/bin/node" /usr/local/bin/node
sudo ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-x64/bin/npm" /usr/local/bin/npm
sudo ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-x64/bin/npx" /usr/local/bin/npx
node -v
```

Подойдёт и nvm/NodeSource — важно, чтобы major был ≥ 24.

### yt-dlp (официальный бинарник, nightly)

```bash
curl -fsSLO https://github.com/yt-dlp/yt-dlp/releases/download/nightly/yt-dlp_linux
curl -fsSLO https://github.com/yt-dlp/yt-dlp/releases/download/nightly/SHA2-256SUMS
grep ' yt-dlp_linux$' SHA2-256SUMS | sha256sum -c -
sudo install -m 0755 yt-dlp_linux /usr/local/bin/yt-dlp
yt-dlp --version
```

Альтернатива через pip:

```bash
python3 -m pip install -U --pre "yt-dlp[default]"
```

Официальный бинарник и extra `[default]` уже включают `yt-dlp-ejs`.

### ffmpeg и ffprobe

```bash
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -version | head -1
```

## Быстрый старт

```bash
git clone git@github.com:T58574/youtube-download-bot.git
cd youtube-download-bot
npm ci
cp .env.example .env
# отредактируйте BOT_TOKEN и ALLOWED_TELEGRAM_IDS
npm run build
npm start
```

Для разработки: `npm run dev` (tsx watch, `.env` подхватывается автоматически). Оба скрипта загружают `.env` через `node --env-file-if-exists=.env`, поэтому в systemd-окружении переменные можно задавать напрямую.

Если `npm` предупреждает, что install script у `esbuild` не одобрен, — это не мешает сборке и тестам (проверено на чистом `npm ci`). Чтобы убрать предупреждение: `npm install-scripts approve esbuild`.

## Конфигурация

Все переменные задаются в `.env` (локально) или в `/etc/youtube-download-bot.env` (systemd). Обязательные — только первые две.

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `BOT_TOKEN` | да | — | токен бота от @BotFather |
| `ALLOWED_TELEGRAM_IDS` | да | — | ID пользователей через запятую/пробел; остальным бот не отвечает |
| `TELEGRAM_API_ROOT` | нет | `https://api.telegram.org` | адрес Bot API; для self-hosted сервера укажите свой |
| `TELEGRAM_UPLOAD_LIMIT_MB` | нет | `50` / `2000` | лимит размера файла, 1..2000 (см. «Лимиты Telegram») |
| `TELEGRAM_API_ID` | нет | — | api_id с my.telegram.org; вместе с `TELEGRAM_API_HASH` включает MTProto |
| `TELEGRAM_API_HASH` | нет | — | api_hash с my.telegram.org (32 символа) |
| `MTPROTO_THRESHOLD_MB` | нет | лимит Bot API | начиная с какого размера файл уходит через MTProto, 1..2000 |
| `MTPROTO_SESSION_FILE` | нет | рядом с `WORK_DIR` | файл сессии MTProto (ключ авторизации, права 0600) |
| `MTPROTO_UPLOAD_TIMEOUT_MS` | нет | `7200000` | таймаут отправки через MTProto (2 часа) |
| `MAX_CONCURRENT_DOWNLOADS` | нет | `2` | одновременных загрузок, 1..10 |
| `MAX_QUEUE_SIZE` | нет | `20` | длина очереди задач, 1..200 |
| `PROGRESS_UPDATE_INTERVAL_MS` | нет | `2000` | частота правок прогресс-сообщения, 1000..10000 |
| `METADATA_TIMEOUT_MS` | нет | `60000` | таймаут получения метаданных |
| `DOWNLOAD_TIMEOUT_MS` | нет | `1800000` | таймаут скачивания (30 минут) |
| `UPLOAD_TIMEOUT_MS` | нет | `600000` | таймаут отправки в Telegram |
| `WORK_DIR` | нет | `data/work` | каталог временных файлов (каждая задача — подкаталог) |
| `YTDLP_BIN` | нет | `yt-dlp` | путь к бинарнику yt-dlp |
| `FFMPEG_BIN` / `FFPROBE_BIN` | нет | `ffmpeg` / `ffprobe` | пути к бинарникам (проверяются при старте) |
| `FFMPEG_LOCATION` | нет | — | каталог для `yt-dlp --ffmpeg-location`; по умолчанию — каталог `FFMPEG_BIN`, если путь абсолютный |
| `YTDLP_COOKIES_FILE` | нет | — | файл cookies (Netscape) для `yt-dlp --cookies` |
| `YTDLP_SLEEP_REQUESTS` | нет | `1` | пауза между сетевыми запросами yt-dlp, 0..60 секунд |
| `YTDLP_IMPERSONATE` | нет | — | маскировка под браузер для `yt-dlp --impersonate` |
| `YTDLP_LIMIT_RATE` | нет | — | ограничение скорости для `yt-dlp --limit-rate`, например `5M` |
| `LOG_LEVEL` | нет | `info` | `debug`, `info`, `warn`, `error` |

При старте бот проверяет версию Node.js и наличие `yt-dlp`, `ffmpeg`, `ffprobe`, удаляет «осиротевшие» каталоги прошлых запусков и очищает webhook с отброшенными апдейтами (используется long polling). Если Bot API недоступен, старт прерывается через 30 секунд с понятной ошибкой в логе (systemd перезапустит процесс сам), а не висит молча.

## Запуск на сервере (systemd)

```bash
sudo useradd --system --home /var/lib/youtube-download-bot --shell /usr/sbin/nologin youtube-bot
sudo install -d -o youtube-bot -g youtube-bot -m 700 /var/lib/youtube-download-bot

sudo git clone https://github.com/T58574/youtube-download-bot /opt/youtube-download-bot
cd /opt/youtube-download-bot
sudo npm ci && sudo npm run build

sudo install -m 600 .env.example /etc/youtube-download-bot.env
sudo editor /etc/youtube-download-bot.env   # BOT_TOKEN, ALLOWED_TELEGRAM_IDS, WORK_DIR=/var/lib/youtube-download-bot/work

sudo cp deploy/youtube-download-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now youtube-download-bot
journalctl -u youtube-download-bot -f
```

Юнит запускает `dist/index.js` из `/opt/youtube-download-bot`, читает `/etc/youtube-download-bot.env`, перезапускается при падении и ограничивает запись на диск каталогом `/var/lib/youtube-download-bot`. Обновление версии:

```bash
cd /opt/youtube-download-bot && sudo git pull && sudo npm ci && sudo npm run build
sudo systemctl restart youtube-download-bot
```

## Лимиты Telegram и отправка файлов

Облачный Bot API (`api.telegram.org`) принимает файлы до **50 МиБ**: multipart — 10 МБ для фото и 50 МБ для остального, по URL — 5/20 МБ. Лимит настраивается `TELEGRAM_UPLOAD_LIMIT_MB`; если достоверная оценка размера его превышает, загрузка не стартует, а если фактический файл оказался больше — бот сообщит об этом и не будет грузить его в Telegram.

Файлы до **2000 МиБ** (4000 частей по 512 КиБ) бот умеет отправлять двумя способами.

### 1. MTProto (рекомендуется)

Бот входит в Telegram по своему токену через MTProto (`auth.importBotAuthorization`) и отправляет крупные файлы напрямую, минуя 50-мегабайтный лимит Bot API. Всё, что нужно, — `api_id` и `api_hash` с [my.telegram.org/apps](https://my.telegram.org/apps):

```bash
# .env
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

Что происходит:

- апдейты, кнопки и сообщения по-прежнему идут через Bot API — код бота в этом плане не меняется;
- файлы больше `MTPROTO_THRESHOLD_MB` (по умолчанию — лимит Bot API, то есть 50 МБ) уходят через MTProto, остальные — через Bot API;
- при включённом MTProto общий лимит отправки автоматически становится 2000 МиБ, и бот предлагает более высокие качества;
- сессия (ключ авторизации) хранится в `MTPROTO_SESSION_FILE` с правами 0600 и переиспользуется при перезапусках, чтобы не плодить авторизации;
- апдейты MTProto-сессия не забирает (`updates.getDifference` не вызывается), поэтому бот не теряет сообщения, которые забирает Bot API.

Проверить канал на маленьком файле можно так: `MTPROTO_THRESHOLD_MB=1` — тогда через MTProto пойдёт всё, даже мелочь.

### 2. Self-hosted Bot API server

[Self-hosted Bot API server](https://github.com/tdlib/telegram-bot-api) (`telegram-bot-api --local`, тоже нужны `api_id`/`api_hash`) поднимает лимит до **2000 МиБ**: укажите `TELEGRAM_API_ROOT=http://127.0.0.1:8081` и `TELEGRAM_UPLOAD_LIMIT_MB=2000`. Перед переключением выполните `logOut` на облачном `api.telegram.org`, иначе апдейты могут теряться.

### Прочее

- Прогресс обновляется редактированием одного сообщения не чаще, чем раз в `PROGRESS_UPDATE_INTERVAL_MS` — это щадит лимиты Telegram. Для MTProto дополнительно показывается процент загрузки файла.
- Отправка файла отменяется кнопкой «Отмена» и на MTProto: загрузка частей прерывается на ближайшей границе 512 КиБ.

## Защита от блокировок YouTube

Прямого бана IP за «человеческий» объём скачиваний Google обычно не делает. Реальная проблема для серверного IP — проверка «подтвердите, что вы не робот» на части видео (она прилетает из-за репутации адреса, а не из-за частоты запросов) и реже — HTTP 429.

Что уже делает бот:

- доступ только по `ALLOWED_TELEGRAM_IDS` — посторонние не могут нагружать канал;
- `MAX_CONCURRENT_DOWNLOADS=2` и очередь — никаких залпов;
- на одно видео приходится два запуска `yt-dlp` (метаданные и загрузка) плюс несколько запросов к плеер-API, сам контент идёт с `googlevideo.com` — это отдельная система;
- `yt-dlp` nightly: в нём самые свежие player-клиенты и обходы проверок, чинится быстрее, чем у стабильных сборок;
- ошибка «я не робот» распознаётся (`classifyYtDlpFailure`) и показывается честным сообщением, а не «неизвестная ошибка».

Что добавить без прокси и без затрат — четыре переменные в `.env`:

| Переменная | По умолчанию | Что даёт |
|---|---|---|
| `YTDLP_COOKIES_FILE` | — | файл cookies в формате Netscape, экспортированный из браузера с залогиненным Google. Самое эффективное: снимает большинство проверок «я не робот» и открывает видео с возрастным ограничением |
| `YTDLP_IMPERSONATE` | — | маскировка TLS/HTTP-отпечатка под браузер (`chrome`, `safari`…). Список: `yt-dlp --list-impersonate-targets` |
| `YTDLP_SLEEP_REQUESTS` | `1` | пауза между сетевыми запросами, секунды. Рисунок трафика становится человеческим; цена — несколько секунд на видео |
| `YTDLP_LIMIT_RATE` | — | ограничение скорости (`5M`). Не про блокировки, а про канал и диск |

Рекомендуемый минимум для IP дата-центра: cookies + `--impersonate chrome`. Пауза в секунду уже включена по умолчанию.

Если cookies лежат в `/etc/youtube-download-bot/cookies.txt`, а бот работает от пользователя `youtube-bot`, файлу нужен доступ на чтение этому пользователю (`chown youtube-bot` или группа с чтением). Формат — Netscape (`cookies.txt`), а не JSON из расширений браузера.

Когда прокси всё-таки нужен: если после cookies и маскировки проверка «я не робот» появляется на большинстве видео, или IP попал в чёрный список у конкретных видео. Тогда помогает смена адреса — резидентный IP или мобильный.

## Обновление зависимостей

```bash
npm outdated
npm update --save-exact     # обновить npm-зависимости и зафиксировать точные версии
npm ci                      # воспроизводимая установка строго по lock-файлу
npm run typecheck && npm test
```

```bash
sudo yt-dlp --update-to nightly          # бинарник из GitHub: сменить канал на nightly и обновиться
python3 -m pip install -U --pre "yt-dlp[default]"   # альтернатива для pip-установки
sudo apt update && sudo apt upgrade ffmpeg
```

После обновления `yt-dlp` стоит прогнать пару видео вручную: YouTube меняется чаще, чем всё остальное в этом стеке.

## Ограничения

### Скачивание

- Только одиночные видео: `/playlist` и ссылки с `list=` отклоняются, `/live/…` (трансляции) — тоже.
- SoundCloud: только отдельные треки. Плейлисты и подборки (`/artist/sets/…`) отклоняются. SoundCloud сейчас отдаёт аудио как AAC/HLS, поэтому для mp3 выполняется один транскод через ffmpeg; если у трека когда-нибудь появится нативный mp3-поток, `yt-dlp` возьмёт его без перекодирования.
- MP4 только в H.264 (avc1) + m4a: AV1/VP9 намеренно не предлагаются ради совместимости с клиентами Telegram. Если у видео нет ни одного H.264-варианта и нет аудио — бот честно скажет, что скачивать нечего.
- Приватные, возрастные и регионально ограниченные видео, а также проверка «я не робот» могут быть недоступны: по умолчанию бот не подставляет cookies и PO tokens (cookies дают доступ к аккаунту, и в публичном сервисе им не место). Если проверка «я не робот» мешает — см. «Защита от блокировок YouTube».
- Оценки размера приблизительны: берутся из `filesize`/`filesize_approx`, иначе считаются по битрейту и длительности и показываются с «~». Достоверная оценка блокирует загрузку сразу, окончательное решение — по фактическому размеру файла.
- Проценты показываются только тогда, когда `yt-dlp` сообщает точный размер потока. DASH-потоки YouTube часто отдают только оценку, поэтому для MP4 прогресс может идти в байтах без процентов (общая оценка помечена «~»); `total_bytes_estimate` для расчёта процентов не используется.
- Для MP4 из двух потоков (видео+аудио) прогресс общий: 100% не показывается, пока не завершён весь комплект.
- Всё пишется только в `WORK_DIR`; каталог задачи удаляется после завершения, «осиротевшие» каталоги подчищаются при старте.
- Таймаут скачивания по умолчанию 30 минут (`DOWNLOAD_TIMEOUT_MS`); параллельные загрузки делят сеть и диск.

### Telegram

- Бот отвечает только в личных чатах и только ID из `ALLOWED_TELEGRAM_IDS`.
- Вложения больше лимита (по умолчанию 50 МиБ) не отправляются — см. раздел про self-hosted Bot API.
- Плейлисты, трансляции, пакетная загрузка и несколько файлов в одном запросе не поддерживаются.

## Архитектура

```
src/
  index.ts       точка входа: конфиг → проверка окружения → бот → graceful shutdown
  config.ts      разбор переменных окружения и валидация
  queue.ts       очередь задач с лимитами параллельности и размера
  files.ts       рабочие каталоги, поиск результата, очистка
  logger.ts      JSON-логи с редактированием токенов/секретов
  errors.ts      типизированные ошибки и тексты для пользователя
  format.ts      форматирование байт/длительности, HTML-escape
  links.ts       выбор провайдера ссылки: YouTube или SoundCloud
  youtube/       разбор ссылок, выбор форматов и качеств, нормализация метаданных
  soundcloud/    разбор ссылок на треки SoundCloud
  ytdlp/         безопасный запуск yt-dlp, парсинг прогресса и метаданных, проверка инструментов
  telegram/      bot, обработчики, рендер сообщений, отправка файлов, прогресс-сообщение
tests/           18 файлов unit-тестов (vitest)
deploy/          systemd-юнит
```

`yt-dlp` запускается дочерним процессом с аргументами-массивом (без shell), в изолированном каталоге задачи, с ограничением вывода и таймаутом; при отмене процесс убивается по группе.

## Тесты

```bash
npm test              # vitest run — 18 файлов, 174 теста
npm run typecheck     # tsc --noEmit
npm run typecheck:tests
```

Покрыто: разбор ссылок YouTube и SoundCloud, выбор провайдера, callback-данные и хранилище выборов, доступ по ID, очередь и отмена, оценки размеров и селекторы форматов, парсинг прогресса `yt-dlp` (включая оценки и двухпоточные MP4), рендер сообщений, конфиг, логи с редактированием, работа с файлами, аргументы запуска `yt-dlp`, ошибки.

## Пример реального прогона

На тестовой машине (Debian bookworm, видео `dQw4w9WgXcQ`, 213 секунд) метаданные приходят за ~5 с; MP3 — 6.11 МиБ (~13–14 с), MP4 144p — 5.35 МиБ (~9–10 с). Прогресс MP3 рос монотонно 0→100%; в двухпоточном MP4 проценты появились, когда стал известен точный размер, и выросли 44→100% без откатов. Цифры зависят от сети и настроек и приведены как ориентир, а не как норматив.
