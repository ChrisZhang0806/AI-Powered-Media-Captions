import type { CaptionMode, CaptionSegment, ProgressInfo, SegmentStyle } from '../types';
import type { Language } from '../utils/i18n';
import {
    analyzeMp4Audio,
    buildAacSegment,
    UnsupportedMp4AudioError
} from '../utils/mp4AudioDemux';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const FAST_PATH_CONCURRENCY = 3;
const FAST_PATH_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);

class FastPathEndpointUnavailableError extends Error {
    constructor() {
        super('The deployed server does not support audio-track segment transcription');
        this.name = 'FastPathEndpointUnavailableError';
    }
}

interface SegmentResponse {
    captions?: CaptionSegment[];
}

const formatFileSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const parseTimestamp = (timestamp: string): number => {
    const [time, milliseconds = '0'] = timestamp.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(milliseconds) / 1000;
};

const mergeCaptions = (captions: CaptionSegment[]): CaptionSegment[] => {
    const sorted = [...captions].sort((a, b) => parseTimestamp(a.startTime) - parseTimestamp(b.startTime));
    const unique: CaptionSegment[] = [];

    for (const caption of sorted) {
        const last = unique[unique.length - 1];
        if (!last || parseTimestamp(caption.startTime) >= parseTimestamp(last.endTime) - 0.5) {
            unique.push(caption);
        }
    }

    return unique.map((caption, index) => ({ ...caption, id: index }));
};

const readResponseError = async (response: Response): Promise<Error> => {
    try {
        const body = await response.json();
        return new Error(body.error || `Audio segment request failed (${response.status})`);
    } catch {
        return new Error(`Audio segment request failed (${response.status})`);
    }
};

const isFastPathCandidate = (file: File): boolean => {
    const extensionIndex = file.name.lastIndexOf('.');
    const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : '';
    return FAST_PATH_EXTENSIONS.has(extension);
};

/**
 * Upload only the AAC track from a local MP4-family file. Each request is
 * stateless, so Cloud Run can route segments to different instances safely.
 */
export const transcribeMp4AudioFastPath = async (
    file: File,
    targetLanguage: string,
    mode: CaptionMode,
    segmentStyle: SegmentStyle,
    contextPrompt: string,
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress: ((info: ProgressInfo) => void) | undefined,
    apiKey: string | undefined,
    uiLanguage: Language,
    signal?: AbortSignal
): Promise<boolean> => {
    if (!isFastPathCandidate(file)) return false;

    const internalController = new AbortController();
    const forwardAbort = () => internalController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    let plan;
    try {
        plan = await analyzeMp4Audio(file, {
            signal: internalController.signal,
            onProgress: (progress) => onProgress?.({
                stage: 'extracting_audio',
                stageLabel: uiLanguage === 'zh' ? '分析本地音轨...' : 'Analyzing local audio track...',
                progress: Math.max(1, Math.round(progress * 0.1)),
                detail: uiLanguage === 'zh'
                    ? `仅扫描本地文件索引，不上传 ${formatFileSize(file.size)} 的视频画面`
                    : `Scanning the local index only; ${formatFileSize(file.size)} of video is not uploaded`
            })
        });
    } catch (error) {
        signal?.removeEventListener('abort', forwardAbort);
        if (error instanceof UnsupportedMp4AudioError) return false;
        throw error;
    }

    const totalAudioSize = formatFileSize(plan.encodedBytes);
    let nextSegmentIndex = 0;
    let completedSegments = 0;
    let uploadedAudioBytes = 0;
    let allCaptions: CaptionSegment[] = [];

    const uploadSegment = async (segmentIndex: number): Promise<CaptionSegment[]> => {
        const segment = plan.segments[segmentIndex];
        const audioBlob = await buildAacSegment(file, plan, segment, {
            signal: internalController.signal
        });

        const formData = new FormData();
        formData.append('file', audioBlob, `audio-segment-${segmentIndex}.aac`);
        formData.append('startTime', String(segment.startTime));
        formData.append('segmentStyle', segmentStyle);
        formData.append('contextPrompt', contextPrompt);
        formData.append('targetLanguage', targetLanguage);
        formData.append('captionMode', mode);
        if (apiKey) formData.append('apiKey', apiKey);

        const response = await fetch(`${SERVER_URL}/api/audio-segments/transcribe`, {
            method: 'POST',
            body: formData,
            signal: internalController.signal
        });
        if ([404, 405, 501].includes(response.status)) {
            throw new FastPathEndpointUnavailableError();
        }
        if (!response.ok) throw await readResponseError(response);

        const body = await response.json() as SegmentResponse;
        uploadedAudioBytes += audioBlob.size;
        return Array.isArray(body.captions) ? body.captions : [];
    };

    const runner = async () => {
        while (!internalController.signal.aborted) {
            const segmentIndex = nextSegmentIndex++;
            if (segmentIndex >= plan.segments.length) return;

            const captions = await uploadSegment(segmentIndex);
            allCaptions = mergeCaptions([...allCaptions, ...captions]);
            completedSegments++;
            onChunk(allCaptions);

            const progress = 10 + Math.round((completedSegments / plan.segments.length) * 90);
            onProgress?.({
                stage: 'transcribing',
                stageLabel: uiLanguage === 'zh' ? '音轨分段转写中...' : 'Transcribing audio segments...',
                progress: Math.min(100, progress),
                detail: uiLanguage === 'zh'
                    ? `${completedSegments}/${plan.segments.length} 段 · 已传音轨 ${formatFileSize(uploadedAudioBytes)} / ${totalAudioSize}`
                    : `${completedSegments}/${plan.segments.length} segments · audio ${formatFileSize(uploadedAudioBytes)} / ${totalAudioSize}`
            });
        }
    };

    try {
        if (plan.segments.length === 0) {
            throw new UnsupportedMp4AudioError('No AAC audio segments were found');
        }
        onProgress?.({
            stage: 'extracting_audio',
            stageLabel: uiLanguage === 'zh' ? '音轨快速路径已启用' : 'Audio fast path enabled',
            progress: 10,
            detail: uiLanguage === 'zh'
                ? `视频 ${formatFileSize(file.size)}，实际只需上传约 ${totalAudioSize} 音轨`
                : `Video ${formatFileSize(file.size)}; only about ${totalAudioSize} of audio will be uploaded`
        });

        const runnerCount = Math.min(FAST_PATH_CONCURRENCY, plan.segments.length);
        await Promise.all(Array.from({ length: runnerCount }, () => runner()));
        return true;
    } catch (error) {
        internalController.abort(error);
        if (error instanceof FastPathEndpointUnavailableError && completedSegments === 0) return false;
        throw error;
    } finally {
        signal?.removeEventListener('abort', forwardAbort);
    }
};
