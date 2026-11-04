#!/usr/bin/env bash
# Замер таймингов пайплайна: скачивание + склейка, MP3, перекодирование в 360p.
#
# Запуск:  scripts/bench/pipeline-bench.sh [video_id]
# По умолчанию — Big Buck Bunny (1080p60, ~10.5 мин).
#
# Перекодирование в 360p делается ТОЛЬКО для сравнения с нативным 360p
# из YouTube: в проде мы не кодируем никогда (см. docs/20-unit-economics.md).
set -euo pipefail

VIDEO_ID="${1:-aqz-KE-bpKQ}"
WORK_DIR="$(mktemp -d /tmp/pipeline-bench.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> video: $VIDEO_ID"
echo "==> work dir: $WORK_DIR"
echo

echo "==> 1. download 1080p + merge (stream copy)"
time yt-dlp --ignore-config --no-playlist --no-cache-dir \
  -f "bestvideo[height<=1080][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]" \
  --merge-output-format mp4 \
  -o "$WORK_DIR/out.%(ext)s" \
  "https://www.youtube.com/watch?v=$VIDEO_ID" >/dev/null 2>&1

VIDEO_FILE="$(find "$WORK_DIR" -maxdepth 1 -name 'out.mp4' -print -quit)"
ls -lh "$VIDEO_FILE"
echo

echo "==> 2. extract MP3 (LAME V0)"
time ffmpeg -y -v error -i "$VIDEO_FILE" -vn -c:a libmp3lame -q:a 0 "$WORK_DIR/out.mp3"
ls -lh "$WORK_DIR/out.mp3"
echo

echo "==> 3. transcode to 360p (NOT used in production, for comparison only)"
time ffmpeg -y -v error -i "$VIDEO_FILE" -vf "scale=-2:360" \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart "$WORK_DIR/out360.mp4"
ls -lh "$WORK_DIR/out360.mp4"
echo

echo "==> 4. native low-quality formats available in YouTube"
yt-dlp --ignore-config --no-playlist --js-runtimes "node:$(command -v node)" -F \
  "https://www.youtube.com/watch?v=$VIDEO_ID" 2>/dev/null \
  | grep -E "mp4.*avc1" | awk '{print $1, $2, $3, $5}' | head -12
