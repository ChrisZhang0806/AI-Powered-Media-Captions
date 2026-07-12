import type { CaptionSegment, ProgressInfo, SegmentStyle } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { UserFacingError } from '../utils/userFacingError';
import {
    analyzeMp4Audio,
    buildAudioSegment,
    UnsupportedMp4AudioError
} from '../utils/mp4AudioDemux';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const FAST_PATH_CONCURRENCY = 3;
const FAST_PATH_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);
const MAX_SILENT_FULL_UPLOAD_BYTES = 256 * 1024 * 1024;

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

const readResponseError = async (response: Response, uiLanguage: Language): Promise<Error> => {
    const fallback = getTranslation(uiLanguage).errorAudioSegment;
    if (uiLanguage === 'zh-TW') return new UserFacingError(fallback);
    try {
        const body = await response.json();
        const message = typeof body.error === 'string' ? body.error : '';
        const containsChinese = /[\u3400-\u9fff]/.test(message);
        if ((uiLanguage === 'en' && containsChinese) || (uiLanguage === 'zh' && !containsChinese)) return new UserFacingError(fallback);
        return new UserFacingError(message || fallback);
    } catch {
        return new UserFacingError(fallback);
    }
};

const isFastPathCandidate = (file: File): boolean => {
    const extensionIndex = file.name.lastIndexOf('.');
    const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : '';
    return FAST_PATH_EXTENSIONS.has(extension);
};

const supportsAudioSegmentEndpoint = async (signal?: AbortSignal): Promise<boolean> => {
    try {
        const response = await fetch(`${SERVER_URL}/health`, {
            method: 'GET',
            cache: 'no-store',
            signal
        });
        if (!response.ok) return false;
        const health = await response.json();
        return health?.features?.audioTrackSegments === true;
    } catch {
        return false;
    }
};

const createProtectedFallbackError = (
    file: File,
    uiLanguage: Language,
    cause: 'service' | 'format'
) => {
    const t = getTranslation(uiLanguage);
    const template = cause === 'service' ? t.errorFastPathUnavailable : t.errorFastPathFormat;
    return new UserFacingError(template.replace('{size}', formatFileSize(file.size)));
};

/**
 * Upload only the audio track from a local MP4-family file. Each request is
 * stateless, so Cloud Run can route segments to different instances safely.
 */
export const transcribeMp4AudioFastPath = async (
    file: File,
    segmentStyle: SegmentStyle,
    contextPrompt: string,
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress: ((info: ProgressInfo) => void) | undefined,
    apiKey: string | undefined,
    uiLanguage: Language,
    signal?: AbortSignal
): Promise<boolean> => {
    if (!isFastPathCandidate(file)) return false;
    const t = getTranslation(uiLanguage);

    const internalController = new AbortController();
    const forwardAbort = () => internalController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    const endpointAvailable = await supportsAudioSegmentEndpoint(internalController.signal);
    if (!endpointAvailable) {
        signal?.removeEventListener('abort', forwardAbort);
        if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
            throw createProtectedFallbackError(
                file,
                uiLanguage,
                'service'
            );
        }
        return false;
    }

    let plan;
    try {
        plan = await analyzeMp4Audio(file, {
            signal: internalController.signal,
            onProgress: (progress) => onProgress?.({
                stage: 'extracting_audio',
                stageLabel: t.progressPreparing,
                progress: Math.max(1, Math.round(progress * 0.1))
            })
        });
    } catch (error) {
        signal?.removeEventListener('abort', forwardAbort);
        if (error instanceof UnsupportedMp4AudioError) {
            if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
                throw createProtectedFallbackError(file, uiLanguage, 'format');
            }
            return false;
        }
        throw error;
    }

    const totalAudioSize = formatFileSize(plan.encodedBytes);
    let nextSegmentIndex = 0;
    let completedSegments = 0;
    let uploadedAudioBytes = 0;
    let allCaptions: CaptionSegment[] = [];

    const uploadSegment = async (segmentIndex: number): Promise<CaptionSegment[]> => {
        const segment = plan.segments[segmentIndex];
        const audioBlob = await buildAudioSegment(file, plan, segment, {
            signal: internalController.signal
        });

        const formData = new FormData();
        formData.append('file', audioBlob, `audio-segment-${segmentIndex}.${plan.fileExtension}`);
        formData.append('startTime', String(segment.startTime));
        formData.append('segmentStyle', segmentStyle);
        formData.append('contextPrompt', contextPrompt);
        formData.append('uiLanguage', uiLanguage);
        if (apiKey) formData.append('apiKey', apiKey);

        const response = await fetch(`${SERVER_URL}/api/audio-segments/transcribe`, {
            method: 'POST',
            body: formData,
            signal: internalController.signal
        });
        if ([404, 405, 501].includes(response.status)) {
            throw new FastPathEndpointUnavailableError();
        }
        if (!response.ok) throw await readResponseError(response, uiLanguage);

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
                stageLabel: t.progressTranscribing,
                progress: Math.min(100, progress),
                detail: t.progressSegmentsDetail
                    .replace('{completed}', completedSegments.toString())
                    .replace('{total}', plan.segments.length.toString())
                    .replace('{uploaded}', formatFileSize(uploadedAudioBytes))
                    .replace('{size}', totalAudioSize)
            });
        }
    };

    try {
        if (plan.segments.length === 0) {
            throw new UnsupportedMp4AudioError('No AAC audio segments were found');
        }
        onProgress?.({
            stage: 'transcribing',
            stageLabel: t.progressTranscribing,
            progress: 10,
            detail: t.progressAudioOnlyDetail.replace('{size}', totalAudioSize)
        });

        const runnerCount = Math.min(FAST_PATH_CONCURRENCY, plan.segments.length);
        await Promise.all(Array.from({ length: runnerCount }, () => runner()));
        return true;
    } catch (error) {
        internalController.abort(error);
        if (error instanceof FastPathEndpointUnavailableError && completedSegments === 0) {
            if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
                throw createProtectedFallbackError(
                    file,
                    uiLanguage,
                    'service'
                );
            }
            return false;
        }
        throw error;
    } finally {
        signal?.removeEventListener('abort', forwardAbort);
    }
};
