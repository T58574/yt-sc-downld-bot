# Сырые замеры — 2026-10-21

Стенд: Франкфурт, 2 vCPU / 3.8 ГБ RAM, Debian 12, Node 24.22.1,
yt-dlp 2026.10.10.233141, ffmpeg 5.1.9, grammY 1.46.0, telegram (GramJS) 2.26.22.

Воспроизведение: [README.md](README.md).

---

## 1. Скачивание 1080p60 + склейка

```bash
yt-dlp --ignore-config --no-playlist --no-cache-dir \
  -f "bestvideo[height<=1080][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]" \
  --merge-output-format mp4 -o "bb.%(ext)s" \
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
```

Вывод:

```
[info] aqz-KE-bpKQ: Downloading 1 format(s): 299+140
[download] 100% of 245.69MiB in 00:00:07 at 32.36MiB/s
[download] 100% of  9.80MiB in 00:00:00 at 36.50MiB/s
[Merger] Merging formats into "bb.mp4"

real	0m12.122s
user	0m2.529s
sys	0m2.166s
```

`ffprobe` результата:

```
codec_name=h264   width=1920 height=1080 r_frame_rate=60/1 bit_rate=3241874
codec_name=aac    bit_rate=127999
duration=634.625   size=268281285   bit_rate=3381918
```

Вывод: **12.1 с wall, 4.7 CPU-с, 256 МиБ на выходе**, скорость 32.4 МиБ/с.

---

## 2. Извлечение MP3 (LAME V0)

```bash
ffmpeg -y -v error -i bb.mp4 -vn -c:a libmp3lame -q:a 0 bb.mp3
```

```
real	0m8.416s
user	0m8.169s
sys	0m0.191s
-rw-r--r-- 1 alex alex 17992286 bb.mp3
```

Вывод: **8.4 с wall = 8.4 CPU-с, 17.2 МиБ**.

---

## 3. Перекодирование 1080p60 → 360p (НЕ ДЕЛАЕМ В ПРОДЕКТЕ, замер для сравнения)

```bash
ffmpeg -y -v error -i bb.mp4 -vf "scale=-2:360" \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart bb360.mp4
```

```
real	4m21.978s
user	6m58.827s
sys	0m10.162s
-rw-r--r-- 1 alex alex 24558653 bb360.mp4
```

Вывод: **262 с wall, 419 CPU-с, 23.4 МиБ**. В 70 раз дороже скачивания.
Плюс: YouTube всё равно отдаёт нативный 360p бесплатно → кодировать незачем.

---

## 4. Наличие нативного 360p (форматы 18/134/230)

```bash
yt-dlp --ignore-config --no-playlist --js-runtimes "node:$(which node)" -F "<url>"
```

| Видео | Нативные низкие качества (mp4/avc1) |
|---|---|
| `aqz-KE-bpKQ` | 144p (269/160), 240p (229/133), **360p (230/134/18)** |
| `9bZkp7q19f0` | 144p, 240p, **360p (230/134/18)** |
| `kJQP7kiw5Fk` | 144p, 240p, **360p (230/134/18)** |

Вывод: нативный 360p есть на всех трёх. Free-тариф «360p» = выбор формата, без перекодирования.

---

## 5. Скорость отправки в Telegram (MTProto)

Файл: 200 МиБ случайных данных (`dd if=/dev/urandom`), получатель — тестовый чат.
DC: `149.154.167.41` (DC3). GramJS `uploads.CustomFile`, `workers` — параметр.

| Воркеров | Время | Скорость |
|---|---|---|
| 4 | 99.6 с | 2.0 МиБ/с |
| 8 | 48.7 с | 4.1 МиБ/с |
| 16 | 13.6 с | 14.7 МиБ/с |
| 16 (повтор) | 15.8 с | 12.7 МиБ/с |
| 32 | 38.7 с | 5.2 МиБ/с |

Пример вывода (16 воркеров):

```
20% 13.7 MiB/s (2.9s)
40% 14.4 MiB/s (5.6s)
60% 14.8 MiB/s (8.1s)
80% 15.2 MiB/s (10.5s)
100% 15.0 MiB/s (13.3s)
DONE 200.0 MiB in 13.6s = 14.7 MiB/s
```

Вывод: **оптимум 16 воркеров (~13–15 МиБ/с), 32 — деградация**.
Текущее значение в коде — 4 (`src/telegram/send-mtproto.ts`), то есть доставка сейчас
в 6–7 раз медленнее возможного.

---

## 6. Окружение

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); \
  db.exec('create table t(a int)'); db.prepare('insert into t values (?)').run(1); \
  console.log('node:sqlite OK', db.prepare('select count(*) c from t').get());"
# node:sqlite OK { c: 1 }
```

Вывод: встроенный `node:sqlite` в Node 24.22.1 работает → **хранилище без новых зависимостей**.

---

## Что НЕ измерено (нужно отдельно)

- Реальный порог FLOOD_WAIT при параллельной отправке (нужен нагрузочный тест, Этап 0).
- Лимит трафика в тарифе VPS €7 (уточнить у провайдера).
- Поведение при 4K (трафик ~4 МиБ/с видео → 1.4 ГБ на 10 мин).
