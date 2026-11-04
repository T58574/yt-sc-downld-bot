# Как воспроизвести замеры

Скрипты лежат в `scripts/bench/`. Запускаются на VPS.

## 1. Скорость отправки в Telegram

```bash
cd /home/alex/dev/youtube-download-bot
npm run build
node scripts/bench/upload-throughput-bench.mjs <файл> [воркеров]
```

Скрипт:
- копирует MTProto-сессию в отдельный файл (боевую не трогает),
- подключается GramJS по `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` из `.env`,
- отправляет файл в чат из `ALLOWED_TELEGRAM_IDS` (первый ID),
- печатает скорость по каждому 20% прогресса.

Переменные окружения берутся из `.env` — запускать так:
`node --env-file=.env scripts/bench/upload-throughput-bench.mjs <файл> 16`

Подготовка файла:
```bash
dd if=/dev/urandom of=/tmp/bench-200mb.bin bs=1M count=200
```

⚠️ Файл уйдёт в личный чат из `.env` — это тестовая отправка.

## 2. Тайминг пайплайна (скачивание + склейка + MP3 + транскод)

```bash
scripts/bench/pipeline-bench.sh
```

Скрипт скачивает Big Buck Bunny (1080p60), замеряет:
- скачивание + склейку,
- извлечение MP3,
- перекодирование в 360p (только для сравнения — в проде не делаем).

Исходники удаляются в конце.

## 3. Проверка нативных форматов

```bash
yt-dlp --ignore-config --no-playlist --js-runtimes "node:$(which node)" -F "<url>"
```

Смотреть строки с `mp4` + `avc1` на высоте 144/240/360.

## Куда писать результаты

Новый замер → `docs/benchmarks/YYYY-MM-DD-<что>.md` + ссылка в
`docs/20-unit-economics.md` и `docs/40-telegram-limits.md`.
