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

export type ExportFormat = 'SRT' | 'VTT';

export interface VideoMetadata {
  name: string;
  size: number;
  type: string;
  url: string; // Blob URL for preview
}

export type DownloadMode = 'bilingual' | 'original' | 'translated';