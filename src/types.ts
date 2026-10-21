export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MediaFormat {
  formatId: string;
  ext: string;
  width?: number;
  height?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesizeApprox?: number;
  tbr?: number;
  abr?: number;
}

export interface VideoMetadata {
  id: string;
  title: string;
  durationSec?: number;
  uploader?: string;
  formats: MediaFormat[];
  hasAudio: boolean;
}

export interface VideoQuality {
  height: number;
  estimatedBytes?: number;
  estimateSource?: 'reported' | 'bitrate';
  selector: string;
  exceedsLimit: boolean;
  /** true — выбранный формат видео-only, к нему догрузится отдельная аудиодорожка. */
  needsAudio: boolean;
}

export type MediaSelection =
  | { kind: 'audio' }
  | { kind: 'video'; height: number };

export type DownloadStage =
  | 'queued'
  | 'metadata'
  | 'downloading'
  | 'converting'
  | 'merging'
  | 'uploading';

export interface ProgressUpdate {
  stage: DownloadStage;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  estimatedTotalBytes?: number;
  speedBps?: number;
  etaSec?: number;
  queuePosition?: number;
  formatId?: string;
}

export interface TaskContext {
  signal: AbortSignal;
  report: (update: ProgressUpdate) => void;
}

export interface Task {
  id: string;
  ownerId: number;
  label: string;
  run: (context: TaskContext) => Promise<void>;
}

export interface ParsedYouTubeUrl {
  videoId: string;
  canonicalUrl: string;
  hadPlaylistParam: boolean;
}
