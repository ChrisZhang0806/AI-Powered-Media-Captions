import type { CaptionSegment, ProgressInfo, SegmentStyle } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { UserFacingError } from '../utils/userFacingError';
import {
    chooseAudioCompression,
    STANDARD_MP3_PROFILE,
    transcodeAudioSegment
} from './audioTranscodeService';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const FAST_PATH_CONCURRENCY = 2;
const MP4_FAST_PATH_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.m4a']);
const CONTAINER_FAST_PATH_EXTENSIONS = new Set(['.mkv', '.webm', '.ts', '.mts', '.m2ts']);
const MAX_SILENT_FULL_UPLOAD_BYTES = 256 * 1024 * 1024;

type AudioFormat = 'aac' | 'wav' | 'mp3' | 'ogg' | 'flac';
type AudioFileExtension = AudioFormat;
type AudioWorkerKind = 'mp4' | 'container';

interface AudioSegmentSummary {
    index: number;
    startTime: number;
    duration: number;
    encodedBytes: number;
    sampleStart?: number;
    sampleEnd?: number;
}

interface AudioPlanSummary {
    codec: string;
    audioFormat: AudioFormat;
    fileExtension: AudioFileExtension;
    mimeType: string;
    sampleRate: number;
    channelCount: number;
    duration: number;
    encodedBytes: number;
    segments: AudioSegmentSummary[];
}

interface BuiltAudioSegment {
    blob: Blob;
    startTime: number;
    encodedBytes: number;
    fileExtension: AudioFileExtension;
}

interface UploadAudioSegment {
    blob: Blob;
    startTime: number;
    encodedBytes: number;
    fileExtension: AudioFileExtension;
    audioProfile?: string;
}

interface SegmentResponse {
    captions?: CaptionSegment[];
}

class FastPathEndpointUnavailableError extends Error {
    constructor() {
        super('The deployed server does not support audio-track segment transcription');
        this.name = 'FastPathEndpointUnavailableError';
    }
}

class AudioExtractionWorkerError extends Error {
    unsupported: boolean;

    constructor(message: string, unsupported = false) {
        super(message);
        this.name = 'AudioExtractionWorkerError';
        this.unsupported = unsupported;
    }
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
        if ((uiLanguage === 'en' && containsChinese) || (uiLanguage === 'zh' && !containsChinese)) {
            return new UserFacingError(fallback);
        }
        return new UserFacingError(message || fallback);
    } catch {
        return new UserFacingError(fallback);
    }
};

const getAudioWorkerKind = (file: File): AudioWorkerKind | null => {
    const extensionIndex = file.name.lastIndexOf('.');
    const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : '';
    if (MP4_FAST_PATH_EXTENSIONS.has(extension)) return 'mp4';
    if (CONTAINER_FAST_PATH_EXTENSIONS.has(extension)) return 'container';
    return null;
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

const createAudioWorker = (
    file: File,
    workerKind: AudioWorkerKind,
    onAnalysisProgress: (progress: number) => void,
    signal?: AbortSignal
) => {
    const worker = workerKind === 'mp4'
        ? new Worker(new URL('./mp4Audio.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./containerAudio.worker.ts', import.meta.url), { type: 'module' });
    const pendingSegments = new Map<number, {
        resolve: (segment: BuiltAudioSegment) => void;
        reject: (error: Error) => void;
    }>();
    let closed = false;
    let resolvePlan!: (plan: AudioPlanSummary) => void;
    let rejectPlan!: (error: Error) => void;
    const plan = new Promise<AudioPlanSummary>((resolve, reject) => {
        resolvePlan = resolve;
        rejectPlan = reject;
    });
    void plan.catch(() => undefined);

    const toAbortError = () => signal?.reason instanceof Error
        ? signal.reason
        : new DOMException('Audio extraction cancelled', 'AbortError');

    const close = (error?: Error) => {
        if (closed) return;
        closed = true;
        signal?.removeEventListener('abort', handleAbort);
        worker.terminate();
        if (error) {
            rejectPlan(error);
            pendingSegments.forEach(({ reject }) => reject(error));
            pendingSegments.clear();
        }
    };
    const handleAbort = () => close(toAbortError());

    worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'analysis-progress') {
            onAnalysisProgress(Number(message.progress) || 0);
            return;
        }
        if (message.type === 'ready') {
            resolvePlan(message.plan as AudioPlanSummary);
            return;
        }
        if (message.type === 'segment') {
            const pending = pendingSegments.get(message.segmentIndex);
            if (!pending) return;
            pendingSegments.delete(message.segmentIndex);
            pending.resolve({
                blob: new Blob([message.buffer], { type: message.mimeType }),
                startTime: Number(message.startTime),
                encodedBytes: Number(message.encodedBytes),
                fileExtension: message.fileExtension
            });
            return;
        }
        if (message.type === 'error') {
            const error = new AudioExtractionWorkerError(message.message, Boolean(message.unsupported));
            if (message.phase === 'analyze') {
                close(error);
            } else {
                const pending = pendingSegments.get(message.segmentIndex);
                pendingSegments.delete(message.segmentIndex);
                pending?.reject(error);
            }
        }
    };
    worker.onerror = () => close(new AudioExtractionWorkerError('The browser could not extract the media audio track'));

    if (signal?.aborted) handleAbort();
    else signal?.addEventListener('abort', handleAbort, { once: true });
    if (!closed) worker.postMessage({ type: 'analyze', file });

    return {
        plan,
        buildSegment: (segmentIndex: number) => new Promise<BuiltAudioSegment>((resolve, reject) => {
            if (closed) {
                reject(toAbortError());
                return;
            }
            pendingSegments.set(segmentIndex, { resolve, reject });
            worker.postMessage({ type: 'build', segmentIndex });
        }),
        close: () => close()
    };
};

/**
 * Extract and upload only the audio track. Container parsing and segment
 * assembly stay inside a bounded worker, so large video never enters the
 * main-thread heap and video bytes never cross the network.
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
    const workerKind = getAudioWorkerKind(file);
    if (!workerKind) return false;
    const t = getTranslation(uiLanguage);

    const internalController = new AbortController();
    const forwardAbort = () => internalController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    const endpointAvailable = await supportsAudioSegmentEndpoint(internalController.signal);
    if (!endpointAvailable) {
        signal?.removeEventListener('abort', forwardAbort);
        if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
            throw createProtectedFallbackError(file, uiLanguage, 'service');
        }
        return false;
    }

    const reportAnalysisProgress = (progress: number) => onProgress?.({
        stage: 'extracting_audio',
        stageLabel: t.progressExtracting,
        progress: Math.max(1, Math.round(progress * 0.1))
    });
    let activeWorkerKind = workerKind;
    let audioWorker = createAudioWorker(
        file,
        activeWorkerKind,
        reportAnalysisProgress,
        internalController.signal
    );

    let plan!: AudioPlanSummary;
    while (true) {
        try {
            plan = await audioWorker.plan;
            break;
        } catch (error) {
            audioWorker.close();
            if (internalController.signal.aborted) throw error;
            if (
                error instanceof AudioExtractionWorkerError
                && error.unsupported
                && activeWorkerKind === 'mp4'
            ) {
                activeWorkerKind = 'container';
                audioWorker = createAudioWorker(
                    file,
                    activeWorkerKind,
                    reportAnalysisProgress,
                    internalController.signal
                );
                continue;
            }

            signal?.removeEventListener('abort', forwardAbort);
            if (error instanceof AudioExtractionWorkerError && error.unsupported) {
                if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
                    throw createProtectedFallbackError(file, uiLanguage, 'format');
                }
                return false;
            }
            throw error;
        }
    }

    const compression = chooseAudioCompression(plan);
    const sourceAlreadyStandard = plan.audioFormat === 'mp3'
        && plan.sampleRate === 16_000
        && plan.channelCount === 1
        && compression.sourceBitrate > 0
        && compression.sourceBitrate <= 80_000;
    let compressionEnabled = compression.enabled;
    let expectedUploadBytes = compressionEnabled ? compression.estimatedBytes : plan.encodedBytes;
    let nextSegmentIndex = 0;
    let completedSegments = 0;
    let uploadedAudioBytes = 0;
    let allCaptions: CaptionSegment[] = [];

    const prepareSegment = async (segmentIndex: number): Promise<UploadAudioSegment> => {
        const original = await audioWorker.buildSegment(segmentIndex);
        if (!compressionEnabled) {
            return sourceAlreadyStandard
                ? { ...original, audioProfile: STANDARD_MP3_PROFILE }
                : original;
        }

        try {
            const compressed = await transcodeAudioSegment(
                original.blob,
                original.fileExtension,
                {
                    signal: internalController.signal,
                    onProgress: (progress) => {
                        const completedProgress = completedSegments / plan.segments.length;
                        const partialProgress = (progress / 100) / plan.segments.length;
                        onProgress?.({
                            stage: 'loading_ffmpeg',
                            stageLabel: t.progressStreaming,
                            progress: Math.min(99, 10 + Math.round((completedProgress + partialProgress) * 90)),
                            detail: t.progressCompressionDetail.replace(
                                '{size}',
                                formatFileSize(expectedUploadBytes)
                            )
                        });
                    }
                }
            );
            return {
                ...compressed,
                startTime: original.startTime,
                audioProfile: compressed.profile
            };
        } catch (error) {
            if (internalController.signal.aborted) throw error;
            compressionEnabled = false;
            expectedUploadBytes = plan.encodedBytes;
            console.warn('[Audio compression] Falling back to the extracted audio segment');
            return original;
        }
    };

    const uploadSegment = async (segmentIndex: number): Promise<CaptionSegment[]> => {
        const audioSegment = await prepareSegment(segmentIndex);
        const formData = new FormData();
        formData.append(
            'file',
            audioSegment.blob,
            `audio-segment-${segmentIndex}.${audioSegment.fileExtension}`
        );
        formData.append('startTime', String(audioSegment.startTime));
        formData.append('segmentStyle', segmentStyle);
        formData.append('contextPrompt', contextPrompt);
        formData.append('uiLanguage', uiLanguage);
        if (audioSegment.audioProfile) formData.append('audioProfile', audioSegment.audioProfile);
        if (apiKey) formData.append('apiKey', apiKey);

        const response = await fetch(`${SERVER_URL}/api/audio-segments/transcribe`, {
            method: 'POST',
            body: formData,
            signal: internalController.signal
        });
        if ([404, 405, 501].includes(response.status)) throw new FastPathEndpointUnavailableError();
        if (!response.ok) throw await readResponseError(response, uiLanguage);

        const body = await response.json() as SegmentResponse;
        uploadedAudioBytes += audioSegment.encodedBytes;
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
                stageLabel: t.progressStreaming,
                progress: Math.min(100, progress),
                detail: t.progressSegmentsDetail
                    .replace('{completed}', completedSegments.toString())
                    .replace('{total}', plan.segments.length.toString())
                    .replace('{uploaded}', formatFileSize(uploadedAudioBytes))
                    .replace('{size}', formatFileSize(expectedUploadBytes))
            });
        }
    };

    try {
        if (plan.segments.length === 0) {
            throw new AudioExtractionWorkerError('No supported audio segments were found', true);
        }
        onProgress?.({
            stage: compressionEnabled ? 'loading_ffmpeg' : 'transcribing',
            stageLabel: t.progressStreaming,
            progress: 10,
            detail: compressionEnabled
                ? t.progressCompressionDetail.replace('{size}', formatFileSize(expectedUploadBytes))
                : t.progressAudioOnlyDetail.replace('{size}', formatFileSize(expectedUploadBytes))
        });

        const runnerCount = Math.min(FAST_PATH_CONCURRENCY, plan.segments.length);
        await Promise.all(Array.from({ length: runnerCount }, () => runner()));
        return true;
    } catch (error) {
        internalController.abort(error);
        if (error instanceof FastPathEndpointUnavailableError && completedSegments === 0) {
            if (file.size > MAX_SILENT_FULL_UPLOAD_BYTES) {
                throw createProtectedFallbackError(file, uiLanguage, 'service');
            }
            return false;
        }
        throw error;
    } finally {
        audioWorker.close();
        signal?.removeEventListener('abort', forwardAbort);
    }
};
