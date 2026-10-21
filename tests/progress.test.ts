import { describe, expect, it } from 'vitest';
import { parseYtDlpLine } from '../src/ytdlp/progress.js';
import { createProgressAggregator } from '../src/ytdlp/download.js';

describe('parseYtDlpLine', () => {
  it('разбирает строку прогресса загрузки', () => {
    const update = parseYtDlpLine('PROGRESS|downloading|1048576|10485760||524288|18');
    expect(update).toEqual({
      stage: 'downloading',
      percent: 10,
      downloadedBytes: 1048576,
      totalBytes: 10485760,
      speedBps: 524288,
      etaSec: 18,
    });
  });

  it('не подменяет точный размер оценкой', () => {
    const exact = parseYtDlpLine('PROGRESS|downloading|250|1000|2000|100|7');
    expect(exact?.totalBytes).toBe(1000);
    expect(exact?.estimatedTotalBytes).toBeUndefined();
    expect(exact?.percent).toBe(25);

    const estimated = parseYtDlpLine('PROGRESS|downloading|250||2000|100|7');
    expect(estimated?.totalBytes).toBeUndefined();
    expect(estimated?.estimatedTotalBytes).toBe(2000);
    expect(estimated?.percent).toBeUndefined();
  });

  it('не выдумывает процент, если размер неизвестен', () => {
    const update = parseYtDlpLine('PROGRESS|downloading|500|||NA|NA');
    expect(update?.percent).toBeUndefined();
    expect(update?.downloadedBytes).toBe(500);
    expect(update?.speedBps).toBeUndefined();
    expect(update?.etaSec).toBeUndefined();
  });

  it('на финальной строке ставит 100%', () => {
    const update = parseYtDlpLine('PROGRESS|finished|10485760|10485760|||');
    expect(update?.percent).toBe(100);
    expect(update?.totalBytes).toBe(10485760);
  });

  it('на finished без total_bytes не придумывает общий размер', () => {
    const update = parseYtDlpLine('PROGRESS|finished|500|||NA|NA');
    expect(update?.percent).toBe(100);
    expect(update?.downloadedBytes).toBe(500);
    expect(update?.totalBytes).toBeUndefined();
    expect(update?.estimatedTotalBytes).toBeUndefined();
  });

  it('ограничивает процент диапазоном 0..100', () => {
    const update = parseYtDlpLine('PROGRESS|downloading|2000|1000|||');
    expect(update?.percent).toBe(100);
  });

  it('игнорирует неизвестный статус и обычные строки', () => {
    expect(parseYtDlpLine('PROGRESS|error|||')).toBeNull();
    expect(parseYtDlpLine('[youtube] dQw4w9WgXcQ: Downloading webpage')).toBeNull();
    expect(parseYtDlpLine('')).toBeNull();
    expect(parseYtDlpLine('PROGRESS|downloading|1|2|3|4')).toBeNull();
  });

  it('распознаёт этапы конвертации и объединения', () => {
    expect(parseYtDlpLine('[ExtractAudio] Destination: video.mp3')?.stage).toBe('converting');
    expect(parseYtDlpLine('[Merger] Merging formats into "video.mp4"')?.stage).toBe('merging');
    expect(parseYtDlpLine('Merging formats into "video.mp4"')?.stage).toBe('merging');
  });

  it('вытаскивает id формата, чтобы различать потоки', () => {
    expect(parseYtDlpLine('PROGRESS|downloading|1|10||||269')?.formatId).toBe('269');
    expect(parseYtDlpLine('PROGRESS|downloading|1|10||||NA')?.formatId).toBeUndefined();
    expect(parseYtDlpLine('PROGRESS|downloading|1|10||||')?.formatId).toBeUndefined();
    expect(parseYtDlpLine('PROGRESS|downloading|1|10|||')?.formatId).toBeUndefined();
  });
});

describe('createProgressAggregator', () => {
  it('не трогает одиночный поток', () => {
    const aggregate = createProgressAggregator();
    const update = aggregate({ stage: 'downloading', formatId: '140', downloadedBytes: 50, totalBytes: 100, percent: 50 });
    expect(update).toMatchObject({ downloadedBytes: 50, totalBytes: 100, percent: 50 });
  });

  it('складывает видео и аудио, не сбрасывая прогресс в ноль', () => {
    const aggregate = createProgressAggregator();
    aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 9_000_000, totalBytes: 10_000_000, percent: 90 });
    const finished = aggregate({
      stage: 'downloading',
      formatId: '137',
      downloadedBytes: 10_000_000,
      totalBytes: 10_000_000,
      percent: 100,
    });
    expect(finished.percent).toBe(100);

    const audio = aggregate({ stage: 'downloading', formatId: '140', downloadedBytes: 1_000_000, totalBytes: 4_000_000, percent: 25 });
    expect(audio.percent).toBeCloseTo((11_000_000 / 14_000_000) * 100, 5);
    expect(audio.downloadedBytes).toBe(11_000_000);
    expect(audio.totalBytes).toBe(14_000_000);
  });

  it('не уменьшает общий размер ниже уже скачанного', () => {
    const aggregate = createProgressAggregator();
    aggregate({ stage: 'downloading', formatId: '269', downloadedBytes: 5_000_000, totalBytes: 4_000_000, percent: 100 });
    const update = aggregate({ stage: 'downloading', formatId: '269', downloadedBytes: 5_000_000, totalBytes: 1_000, percent: 100 });
    expect(update.totalBytes).toBe(5_000_000);
    expect(update.percent).toBe(100);
  });

  it('пропускает обновления без id формата и другие этапы', () => {
    const aggregate = createProgressAggregator();
    const withoutId = aggregate({ stage: 'downloading', downloadedBytes: 1, totalBytes: 2, percent: 50 });
    expect(withoutId.percent).toBe(50);
    expect(aggregate({ stage: 'merging' })).toEqual({ stage: 'merging' });
    expect(aggregate({ stage: 'converting' })).toEqual({ stage: 'converting' });
  });

  it('не считает проценты, пока у второго потока нет точного размера', () => {
    const aggregate = createProgressAggregator();
    aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 1_000, totalBytes: 2_000, percent: 50 });
    const unknown = aggregate({ stage: 'downloading', formatId: '140', downloadedBytes: 10 });
    expect(unknown.downloadedBytes).toBe(1_010);
    expect(unknown.totalBytes).toBeUndefined();
    expect(unknown.percent).toBeUndefined();

    const withEstimate = aggregate({
      stage: 'downloading',
      formatId: '140',
      downloadedBytes: 20,
      estimatedTotalBytes: 1_000,
    });
    expect(withEstimate.downloadedBytes).toBe(1_020);
    expect(withEstimate.estimatedTotalBytes).toBe(3_000);
    expect(withEstimate.percent).toBeUndefined();
  });

  it('берёт фактический размер потока после строки finished', () => {
    const aggregate = createProgressAggregator();
    aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 1_000_000 });
    const finished = aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 2_000_000, percent: 100 });
    expect(finished.totalBytes).toBe(2_000_000);
    expect(finished.percent).toBe(100);
  });

  it('не показывает 100% после finished видео, когда ждём ещё аудио', () => {
    const aggregate = createProgressAggregator(2);
    aggregate({ stage: 'downloading', formatId: '269', downloadedBytes: 2_000_000 });
    const videoDone = aggregate({ stage: 'downloading', formatId: '269', downloadedBytes: 2_500_000, percent: 100 });
    expect(videoDone.percent).toBeUndefined();
    expect(videoDone.totalBytes).toBeUndefined();
    expect(videoDone.downloadedBytes).toBe(2_500_000);

    const withAudio = aggregate({
      stage: 'downloading',
      formatId: '140',
      downloadedBytes: 1_000_000,
      totalBytes: 3_000_000,
      percent: 33,
    });
    expect(withAudio.percent).toBeCloseTo((3_500_000 / 5_500_000) * 100, 5);
    expect(withAudio.totalBytes).toBe(5_500_000);
  });

  it('после finished видео считает проценты по сумме с аудио', () => {
    const aggregate = createProgressAggregator();
    aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 9_500_000 });
    aggregate({ stage: 'downloading', formatId: '137', downloadedBytes: 10_000_000, percent: 100 });
    const audio = aggregate({
      stage: 'downloading',
      formatId: '140',
      downloadedBytes: 2_000_000,
      totalBytes: 4_000_000,
      percent: 50,
    });
    expect(audio.percent).toBeCloseTo((12_000_000 / 14_000_000) * 100, 5);
    expect(audio.totalBytes).toBe(14_000_000);
  });
});
