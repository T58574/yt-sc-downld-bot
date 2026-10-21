# YouTube Download Bot

A TypeScript Telegram bot that downloads **single YouTube videos** and sends them as **MP3** or **MP4** (H.264/AAC) with quality selection, real `yt-dlp` progress, and task cancellation.

[Русская версия →](README.md)

## Features

- accepts `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/embed/…`, `/v/…` links; the `list=` parameter is ignored — only the linked video is downloaded;
- format selection via inline buttons: MP3 (LAME V0) or MP4 H.264/AAC with up to 8 quality options;
- progress from actual `yt-dlp` output: percentages only when the exact size is known, otherwise downloaded bytes; speed and ETA come from `yt-dlp` as well;
- cancellation button: the `yt-dlp` process tree is stopped, temporary files are removed;
- download queue with configurable concurrency and length;
- access restricted to Telegram IDs from the config, private chats only;
- JSON logs with secret redaction, graceful shutdown on `SIGTERM`/`SIGINT`, systemd unit included.

## Requirements

| Component | Version used in development | Source | Why |
|---|---|---|---|
| Node.js | 24.22.1 LTS (Krypton), `engines: ^24` | [nodejs.org](https://nodejs.org/en/download) | bot runtime; the `yt-dlp` EJS JavaScript runtime requires Node ≥ 22 |
| yt-dlp | nightly `2026.10.10.233141` | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases), `nightly` channel | the downloader itself; nightlies get YouTube fixes faster |
| yt-dlp-ejs | 0.8.0 (bundled in the official `yt-dlp` binary) | [yt-dlp/ejs](https://github.com/yt-dlp/ejs) | required for full YouTube support; without a JS runtime some formats are missing |
| ffmpeg / ffprobe | 5.1.9-0+deb12u1 (Debian bookworm) | `apt` | merging video+audio and MP3 conversion |
| grammY | 1.46.0 | npm | Telegram framework (long polling) |
| @grammyjs/runner | 2.0.3 | npm | concurrent update processing so long tasks don't stall the bot |
| telegram (GramJS) | 2.26.22 | npm | MTProto client: bot login by token and file uploads up to 2000 MiB |
| TypeScript / vitest / tsx / @types/node | 7.0.2 / 5.0.5 / 4.23.15 / 24.19.2 | npm (dev) | build, tests, dev runs |

All npm dependencies are pinned to exact versions (no `^` or `~`); the dependency tree lives in `package-lock.json` (lockfileVersion 3), reproducible installs use `npm ci`.

### Why these versions

- **Node.js 24 LTS** — current LTS. The bot passes its own Node path to `yt-dlp` explicitly (`--js-runtimes node:<process.execPath>`), so Deno is not needed.
- **yt-dlp nightly** — YouTube regularly breaks format extraction; nightlies ship fixes earlier than stable. The official binary already bundles `yt-dlp-ejs`.
- **ffmpeg/ffprobe** — without them `yt-dlp` can neither merge separate streams into MP4 nor produce MP3; the Debian build is stable and sufficient for H.264/AAC.

## Installing external tools

### Node.js (x86_64 Linux example)

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

nvm or NodeSource work just as well — the major version must be ≥ 24.

### yt-dlp (official binary, nightly)

```bash
curl -fsSLO https://github.com/yt-dlp/yt-dlp/releases/download/nightly/yt-dlp_linux
curl -fsSLO https://github.com/yt-dlp/yt-dlp/releases/download/nightly/SHA2-256SUMS
grep ' yt-dlp_linux$' SHA2-256SUMS | sha256sum -c -
sudo install -m 0755 yt-dlp_linux /usr/local/bin/yt-dlp
yt-dlp --version
```

pip alternative:

```bash
python3 -m pip install -U --pre "yt-dlp[default]"
```

Both the official binary and the `[default]` extra include `yt-dlp-ejs`.

### ffmpeg and ffprobe

```bash
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -version | head -1
```

## Quick start

```bash
git clone git@github.com:T58574/youtube-download-bot.git
cd youtube-download-bot
npm ci
cp .env.example .env
# set BOT_TOKEN and ALLOWED_TELEGRAM_IDS
npm run build
npm start
```

For development: `npm run dev` (tsx watch, loads `.env` automatically). Both scripts load `.env` via `node --env-file-if-exists=.env`, so in systemd deployments variables can come from the environment directly.

If `npm` warns that the `esbuild` install script is not approved, ignore it — build and tests work fine (verified on a clean `npm ci`). To silence it: `npm install-scripts approve esbuild`.

## Configuration

All variables go into `.env` (locally) or `/etc/youtube-download-bot.env` (systemd). Only the first two are required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | yes | — | bot token from @BotFather |
| `ALLOWED_TELEGRAM_IDS` | yes | — | user IDs, comma/space separated; nobody else gets a reply |
| `TELEGRAM_API_ROOT` | no | `https://api.telegram.org` | Bot API address; set your own for a self-hosted server |
| `TELEGRAM_UPLOAD_LIMIT_MB` | no | `50` / `2000` | file size limit, 1..2000 (see "Telegram limits") |
| `TELEGRAM_API_ID` | no | — | api_id from my.telegram.org; together with `TELEGRAM_API_HASH` enables MTProto |
| `TELEGRAM_API_HASH` | no | — | api_hash from my.telegram.org (32 characters) |
| `MTPROTO_THRESHOLD_MB` | no | Bot API limit | file size from which uploads switch to MTProto, 1..2000 |
| `MTPROTO_SESSION_FILE` | no | next to `WORK_DIR` | MTProto session file (auth key, mode 0600) |
| `MTPROTO_UPLOAD_TIMEOUT_MS` | no | `7200000` | MTProto upload timeout (2 hours) |
| `MAX_CONCURRENT_DOWNLOADS` | no | `2` | concurrent downloads, 1..10 |
| `MAX_QUEUE_SIZE` | no | `20` | queue length, 1..200 |
| `PROGRESS_UPDATE_INTERVAL_MS` | no | `2000` | progress message edit interval, 1000..10000 |
| `METADATA_TIMEOUT_MS` | no | `60000` | metadata fetch timeout |
| `DOWNLOAD_TIMEOUT_MS` | no | `1800000` | download timeout (30 minutes) |
| `UPLOAD_TIMEOUT_MS` | no | `600000` | upload timeout |
| `WORK_DIR` | no | `data/work` | temp file directory (each task gets a subdirectory) |
| `YTDLP_BIN` | no | `yt-dlp` | path to the yt-dlp binary |
| `FFMPEG_BIN` / `FFPROBE_BIN` | no | `ffmpeg` / `ffprobe` | binary paths (checked at startup) |
| `FFMPEG_LOCATION` | no | — | directory for `yt-dlp --ffmpeg-location`; defaults to the `FFMPEG_BIN` directory when the path is absolute |
| `YTDLP_COOKIES_FILE` | no | — | Netscape cookies file for `yt-dlp --cookies` |
| `YTDLP_SLEEP_REQUESTS` | no | `1` | pause between yt-dlp network requests, 0..60 seconds |
| `YTDLP_IMPERSONATE` | no | — | browser impersonation for `yt-dlp --impersonate` |
| `YTDLP_LIMIT_RATE` | no | — | speed cap for `yt-dlp --limit-rate`, e.g. `5M` |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

At startup the bot checks the Node.js version and verifies that `yt-dlp`, `ffmpeg`, and `ffprobe` are available, removes stale task directories from previous runs, and clears the webhook with dropped pending updates (long polling is used). If the Bot API is unreachable, startup aborts after 30 seconds with a clear log message (systemd restarts the process) instead of hanging silently.

## Running on a server (systemd)

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

The unit runs `dist/index.js` from `/opt/youtube-download-bot`, reads `/etc/youtube-download-bot.env`, restarts on failure, and confines disk writes to `/var/lib/youtube-download-bot`. Updating:

```bash
cd /opt/youtube-download-bot && sudo git pull && sudo npm ci && sudo npm run build
sudo systemctl restart youtube-download-bot
```

## Telegram limits and file delivery

The cloud Bot API (`api.telegram.org`) accepts files up to **50 MiB**: 10 MiB for photos and 50 MiB for everything else via multipart, 5/20 MiB via URL. The limit is controlled by `TELEGRAM_UPLOAD_LIMIT_MB`; if a reliable size estimate exceeds it, the download never starts, and if the finished file turns out to be too big, the bot reports it and skips the upload.

Files up to **2000 MiB** (4000 parts of 512 KiB) can be delivered in two ways.

### 1. MTProto (recommended)

The bot signs in to Telegram with its own token over MTProto (`auth.importBotAuthorization`) and sends large files directly, bypassing the 50 MiB Bot API limit. All you need is `api_id` and `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps):

```bash
# .env
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

What this changes:

- updates, buttons and messages still flow through the Bot API — the bot code is untouched there;
- files bigger than `MTPROTO_THRESHOLD_MB` (by default the Bot API limit, i.e. 50 MiB) go over MTProto, smaller ones via the Bot API;
- with MTProto enabled the overall upload limit becomes 2000 MiB automatically and the bot offers higher video qualities;
- the session (auth key) is stored in `MTPROTO_SESSION_FILE` with mode 0600 and reused across restarts, so no new authorizations pile up;
- the MTProto session never fetches updates (`updates.getDifference` is not called), so the bot does not steal the updates the Bot API picks up.

To try the channel with a small file, set `MTPROTO_THRESHOLD_MB=1` — everything then goes over MTProto.

### 2. Self-hosted Bot API server

A [self-hosted Bot API server](https://github.com/tdlib/telegram-bot-api) (`telegram-bot-api --local`, also requires `api_id`/`api_hash`) raises the limit to **2000 MiB**: set `TELEGRAM_API_ROOT=http://127.0.0.1:8081` and `TELEGRAM_UPLOAD_LIMIT_MB=2000`. Run `logOut` on the cloud `api.telegram.org` before switching, otherwise updates may get lost.

### Notes

- Progress is delivered by editing a single message no more often than once per `PROGRESS_UPDATE_INTERVAL_MS`, which respects Telegram rate limits. MTProto uploads additionally report the upload percentage.
- The "Cancel" button also stops an MTProto upload: part uploads are interrupted at the next 512 KiB boundary.

## Protecting against YouTube blocks

Google rarely bans an outright IP for "human-scale" downloading. The real problem for a server IP is the "confirm you're not a bot" check on some videos (it comes from the address reputation, not from request rate) and, less often, HTTP 429.

What the bot already does:

- access is limited to `ALLOWED_TELEGRAM_IDS`, so strangers cannot hammer YouTube;
- `MAX_CONCURRENT_DOWNLOADS=2` plus a queue means no bursts;
- each video costs two `yt-dlp` runs (metadata, then download) and a few player-API requests; the media itself comes from `googlevideo.com`, a separate system;
- `yt-dlp` nightly ships the freshest player clients and workarounds, and gets fixed faster than stable builds;
- the "I'm not a bot" failure is recognised (`classifyYtDlpFailure`) and reported honestly instead of as "unknown error".

Four settings in `.env` add protection without a proxy or any spending:

| Variable | Default | What it buys |
|---|---|---|
| `YTDLP_COOKIES_FILE` | — | a Netscape cookies file exported from a browser logged into Google. The most effective one: it removes most "confirm you're not a bot" checks and unlocks age-restricted videos |
| `YTDLP_IMPERSONATE` | — | impersonates a browser TLS/HTTP fingerprint (`chrome`, `safari`…). List: `yt-dlp --list-impersonate-targets` |
| `YTDLP_SLEEP_REQUESTS` | `1` | pause between network requests, in seconds. Makes the traffic pattern look human; the cost is a few seconds per video |
| `YTDLP_LIMIT_RATE` | — | download speed cap (`5M`). Not about blocks, but about bandwidth and disk |

Recommended minimum for a datacentre IP: cookies plus `--impersonate chrome`. The one-second pause is already on by default.

If the cookies live in `/etc/youtube-download-bot/cookies.txt` and the bot runs as `youtube-bot`, that user needs read access to the file (`chown youtube-bot` or a group with read permission). The format is Netscape (`cookies.txt`), not the JSON some browser extensions export.

A proxy is only needed if "confirm you're not a bot" still shows up on most videos after cookies and impersonation, or the address is blacklisted for specific videos. Then changing the address helps: a residential or mobile one.

## Updating dependencies

```bash
npm outdated
npm update --save-exact     # update npm dependencies and pin exact versions
npm ci                      # reproducible install strictly from the lockfile
npm run typecheck && npm test
```

```bash
sudo yt-dlp --update-to nightly          # GitHub binary: switch to the nightly channel and update
python3 -m pip install -U --pre "yt-dlp[default]"   # alternative for pip installs
sudo apt update && sudo apt upgrade ffmpeg
```

After updating `yt-dlp`, run a couple of videos manually: YouTube changes more often than anything else in this stack.

## Limitations

### Downloading

- Single videos only: `/playlist` and URLs with `list=` are rejected, so are `/live/…` streams.
- MP4 is H.264 (avc1) + m4a only: AV1/VP9 are deliberately not offered for maximum Telegram client compatibility. If a video has no H.264 variant and no audio, the bot says there is nothing to download.
- Private, age-restricted and region-locked videos, as well as "confirm you're not a bot" checks, may be unavailable: by default the bot passes neither cookies nor PO tokens (intentionally — cookies grant account access and have no place in a shared service). If the bot check gets in the way, see "Protecting against YouTube blocks".
- Size estimates are approximate: they come from `filesize`/`filesize_approx`, otherwise from bitrate and duration, and are shown with a "~". A reliable estimate blocks the download up front; the final decision is made on the actual file size.
- Percentages appear only when `yt-dlp` reports an exact stream size. YouTube DASH streams often provide only an estimate, so MP4 progress may run in bytes without percentages (the combined estimate is marked "~"); `total_bytes_estimate` is never used for percentages.
- For two-stream MP4 (video+audio) progress is combined: 100% is not shown until the whole set is done.
- Everything is written under `WORK_DIR` only; the task directory is removed on completion and stale directories are cleaned at startup.
- The default download timeout is 30 minutes (`DOWNLOAD_TIMEOUT_MS`); concurrent downloads share network and disk.

### Telegram

- The bot replies in private chats only, and only to IDs listed in `ALLOWED_TELEGRAM_IDS`.
- Attachments over the limit (50 MiB by default) are not sent — see the self-hosted Bot API section.
- Playlists, live streams, batch downloads and multiple files per request are not supported.

## Architecture

```
src/
  index.ts       entry point: config → environment checks → bot → graceful shutdown
  config.ts      environment parsing and validation
  queue.ts       task queue with concurrency and size limits
  files.ts       work directories, output lookup, cleanup
  logger.ts      JSON logs with token/secret redaction
  errors.ts      typed errors and user-facing messages
  format.ts      byte/duration formatting, HTML escaping
  youtube/       URL parsing, format and quality selection, metadata normalization
  ytdlp/         safe yt-dlp process launch, progress and metadata parsing, tool checks
  telegram/      bot, handlers, message rendering, file sending, progress message
tests/           14 unit test files (vitest)
deploy/          systemd unit
```

`yt-dlp` runs as a child process with an argument array (no shell), inside an isolated task directory, with capped output and a timeout; on cancellation the process tree is killed.

## Tests

```bash
npm test              # vitest run — 14 files, 124 tests
npm run typecheck     # tsc --noEmit
npm run typecheck:tests
```

Covered: YouTube URL parsing, callback data and selection storage, ID-based access, queueing and cancellation, size estimates and format selectors, `yt-dlp` progress parsing (including estimates and two-stream MP4), message rendering, config parsing, log redaction, file handling, `yt-dlp` launch arguments, error mapping.

## Real-world sample run

On the development machine (Debian bookworm, video `dQw4w9WgXcQ`, 213 seconds) metadata arrives in ~5 s; MP3 is 6.11 MiB (~13–14 s) and 144p MP4 is 5.35 MiB (~9–10 s). MP3 progress grew monotonically 0→100%; in the two-stream MP4 case percentages appeared once the exact size was known and climbed 44→100% without regressions. These numbers depend on network and settings and are provided as a reference, not a benchmark.
