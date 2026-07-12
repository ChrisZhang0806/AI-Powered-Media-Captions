export interface CaptionSegment {
  id: number;
  startTime: string; // Format: HH:MM:SS,mmm
  endTime: string;   // Format: HH:MM:SS,mmm
  text: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export type ExportFormat = 'SRT' | 'VTT' | 'TXT';

export interface VideoMetadata {
  name: string;
  size: number;
  type: string;
  url: string; // Blob URL for preview
  previewAvailable?: boolean;
  container?: string;
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  audioChannels?: number;
  bitrate?: number;
  videoBitrate?: number;
  audioBitrate?: number;
}

export type SegmentStyle = 'compact' | 'natural' | 'detailed';

export interface ProgressInfo {
  stage: 'uploading' | 'queued' | 'loading_ffmpeg' | 'extracting_audio' | 'segmenting' | 'transcribing' | 'refining';
  stageLabel: string;
  progress: number; // 0-100
  detail?: string;
}
