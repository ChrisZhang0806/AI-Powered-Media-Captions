import { CaptionSegment, ProgressInfo, SegmentStyle } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { UserFacingError } from '../utils/userFacingError';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const UPLOAD_CONCURRENCY = 2;
const UPLOAD_SESSION_PREFIX = 'caption_upload_session_v2:';
const MAX_FULL_VIDEO_UPLOAD_BYTES = 256 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts', 'mts', 'm2ts']);
const USER_CANCEL_REASON = { cancelServerTask: true } as const;

export const cancelServerTranscription = (controller: AbortController | null | undefined) => {
    controller?.abort(USER_CANCEL_REASON);
};

interface UploadSession {
    taskId: string;
    uploadToken: string;
    chunkSize: number;
    totalChunks: number;
    receivedChunks: number[];
    uploadedBytes: number;
    uploadComplete: boolean;
    status: TaskStatus['status'];
    storageKey: string;
}

interface TaskStatus {
    status: 'uploading' | 'processing' | 'completed' | 'error' | 'cancelled';
    progress: number;
    stage: 'uploading' | 'queued' | 'streaming' | 'extracting' | 'splitting' | 'transcribing' | 'done';
    captions: CaptionSegment[];
    revision?: number;
    captionCount?: number;
    error: string | null;
    uploadedBytes?: number;
    totalBytes?: number;
    uploadComplete?: boolean;
    decodedSeconds?: number;
}

interface CaptionEvent {
    captions?: CaptionSegment[];
    replace?: boolean;
    totalCount?: number;
}

interface TaskSubscription {
    done: Promise<TaskStatus>;
    close: () => void;
}

const formatFileSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const isVideoFile = (file: File): boolean => {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension);
};

const hashString = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const getUploadStorageKey = (
    file: File,
    segmentStyle: SegmentStyle,
    contextPrompt: string,
    uiLanguage: Language
) => `${UPLOAD_SESSION_PREFIX}${hashString(JSON.stringify({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type,
    segmentStyle,
    contextPrompt,
    uiLanguage,
    serverUrl: SERVER_URL
}))}`;

const readStoredSession = (storageKey: string): Pick<UploadSession, 'taskId' | 'uploadToken'> | null => {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (typeof value?.taskId !== 'string' || typeof value?.uploadToken !== 'string') return null;
        return { taskId: value.taskId, uploadToken: value.uploadToken };
    } catch {
        return null;
    }
};

const storeUploadSession = (session: UploadSession) => {
    try {
        localStorage.setItem(session.storageKey, JSON.stringify({
            taskId: session.taskId,
            uploadToken: session.uploadToken
        }));
    } catch {
        // Upload still works when storage is unavailable; only cross-attempt resume is disabled.
    }
};

const clearUploadSession = (session: UploadSession) => {
    try {
        localStorage.removeItem(session.storageKey);
    } catch {
        // Nothing else is required when browser storage is unavailable.
    }
};

const localizeServerMessage = (message: unknown, fallback: string, uiLanguage: Language): string => {
    if (typeof message !== 'string' || !message.trim()) return fallback;
    if (uiLanguage === 'zh-TW') return fallback;
    const containsChinese = /[\u3400-\u9fff]/.test(message);
    if ((uiLanguage === 'en' && containsChinese) || (uiLanguage === 'zh' && !containsChinese)) return fallback;
    return message;
};

const readError = async (response: Response, fallback: string, uiLanguage: Language): Promise<Error> => {
    try {
        const body = await response.json();
        return new UserFacingError(localizeServerMessage(body.error, fallback, uiLanguage));
    } catch {
        return new UserFacingError(fallback);
    }
};

const createUploadSession = async (
    file: File,
    segmentStyle: SegmentStyle,
    contextPrompt: string,
    apiKey: string | undefined,
    signal: AbortSignal | undefined,
    uiLanguage: Language
): Promise<UploadSession> => {
    const t = getTranslation(uiLanguage);
    const storageKey = getUploadStorageKey(file, segmentStyle, contextPrompt, uiLanguage);
    const storedSession = readStoredSession(storageKey);

    const requestSession = async (resume: Pick<UploadSession, 'taskId' | 'uploadToken'> | null) => {
        const response = await fetch(`${SERVER_URL}/api/uploads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || 'application/octet-stream',
                segmentStyle,
                contextPrompt,
                uiLanguage,
                apiKey,
                resumeTaskId: resume?.taskId,
                uploadToken: resume?.uploadToken
            }),
            signal
        });
        return response;
    };

    let response = await requestSession(storedSession);
    if (storedSession && [403, 404, 409].includes(response.status)) {
        try {
            localStorage.removeItem(storageKey);
        } catch {
            // Continue by creating a fresh session.
        }
        response = await requestSession(null);
    }

    if (!response.ok) {
        throw await readError(response, t.errorCreateUpload, uiLanguage);
    }
    const body = await response.json();
    const session: UploadSession = {
        taskId: String(body.taskId),
        uploadToken: String(body.uploadToken),
        chunkSize: Number(body.chunkSize),
        totalChunks: Number(body.totalChunks),
        receivedChunks: Array.isArray(body.receivedChunks)
            ? body.receivedChunks.filter((value: unknown) => Number.isInteger(value))
            : [],
        uploadedBytes: Number(body.uploadedBytes) || 0,
        uploadComplete: Boolean(body.uploadComplete),
        status: body.status || 'uploading',
        storageKey
    };
    if (!session.taskId || !session.uploadToken || !Number.isSafeInteger(session.chunkSize) || session.chunkSize <= 0) {
        throw new UserFacingError(t.errorCreateUpload);
    }
    storeUploadSession(session);
    return session;
};

const uploadInWorker = (
    file: File,
    session: UploadSession,
    onProgress: (loaded: number, total: number, percent: number) => void,
    uiLanguage: Language,
    signal?: AbortSignal
): Promise<void> => new Promise((resolve, reject) => {
    const t = getTranslation(uiLanguage);
    const worker = new Worker(new URL('./upload.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;

    const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        worker.terminate();
        callback();
    };

    const handleAbort = () => {
        worker.postMessage({ type: 'cancel' });
        finish(() => reject(new DOMException('Upload cancelled', 'AbortError')));
    };

    worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'progress') {
            onProgress(message.loaded, message.total, message.percent);
        } else if (message.type === 'complete') {
            finish(resolve);
        } else if (message.type === 'cancelled') {
            finish(() => reject(new DOMException('Upload cancelled', 'AbortError')));
        } else if (message.type === 'error') {
            const errorMessage = uiLanguage === 'zh'
                ? localizeServerMessage(message.error, t.errorUpload, uiLanguage)
                : t.errorUpload;
            finish(() => reject(new UserFacingError(errorMessage)));
        }
    };

    worker.onerror = () => {
        finish(() => reject(new UserFacingError(t.errorUpload)));
    };

    if (signal?.aborted) {
        handleAbort();
        return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });

    worker.postMessage({
        type: 'start',
        file,
        serverUrl: SERVER_URL,
        ...session,
        concurrency: UPLOAD_CONCURRENCY
    });
});

const completeUpload = async (
    session: UploadSession,
    apiKey: string | undefined,
    signal: AbortSignal | undefined,
    uiLanguage: Language
) => {
    const t = getTranslation(uiLanguage);
    const response = await fetch(`${SERVER_URL}/api/uploads/${session.taskId}/complete`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Upload-Token': session.uploadToken
        },
        body: JSON.stringify({ apiKey }),
        signal
    });

    if (!response.ok) {
        throw await readError(response, t.errorCompleteUpload, uiLanguage);
    }
};

const cancelTask = async (session: UploadSession) => {
    try {
        await fetch(`${SERVER_URL}/api/task/${session.taskId}/cancel`, {
            method: 'POST',
            headers: { 'X-Upload-Token': session.uploadToken },
            keepalive: true
        });
    } catch {
        // Cancellation is best effort; the server also expires abandoned tasks.
    }
};

const subscribeToTask = (
    taskId: string,
    onUpdate: (task: TaskStatus) => void,
    uiLanguage: Language,
    signal?: AbortSignal
): TaskSubscription => {
    const t = getTranslation(uiLanguage);
    let source: EventSource | null = new EventSource(`${SERVER_URL}/api/task/${taskId}/stream`);
    let settled = false;
    let fallbackTimer: number | null = null;
    let resolveDone!: (task: TaskStatus) => void;
    let rejectDone!: (error: Error) => void;
    let currentTask: TaskStatus = {
        status: 'uploading',
        progress: 0,
        stage: 'uploading',
        captions: [],
        error: null
    };

    const done = new Promise<TaskStatus>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
    });
    // A failed upload can reject before the caller reaches `await done`.
    void done.catch(() => undefined);

    const cleanup = () => {
        source?.close();
        source = null;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
        signal?.removeEventListener('abort', handleAbort);
    };

    const finish = (task: TaskStatus) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (task.status === 'completed') {
            resolveDone(task);
        } else {
            const fallback = task.error?.includes('未检测到可转写的音频')
                ? t.errorNoAudio
                : task.status === 'cancelled'
                    ? t.errorTaskCancelled
                    : t.errorProcessFailed;
            rejectDone(new UserFacingError(localizeServerMessage(task.error, fallback, uiLanguage)));
        }
    };

    const receive = (task: TaskStatus) => {
        currentTask = {
            ...currentTask,
            ...task,
            captions: Array.isArray(task.captions) ? task.captions : currentTask.captions
        };
        onUpdate(currentTask);
        if (currentTask.status === 'completed' || currentTask.status === 'error' || currentTask.status === 'cancelled') {
            finish(currentTask);
        }
    };

    const receiveState = (state: Omit<TaskStatus, 'captions'>) => {
        receive({ ...currentTask, ...state, captions: currentTask.captions });
    };

    const receiveCaptions = (event: CaptionEvent) => {
        const incoming = Array.isArray(event.captions) ? event.captions : [];
        const captions = event.replace ? incoming : [...currentTask.captions, ...incoming];
        currentTask = { ...currentTask, captions };
        onUpdate(currentTask);
    };

    const parseEvent = <T,>(event: Event): T | null => {
        try {
            return JSON.parse((event as MessageEvent<string>).data) as T;
        } catch {
            return null;
        }
    };

    const poll = async () => {
        if (settled || signal?.aborted) return;
        try {
            const response = await fetch(`${SERVER_URL}/api/task/${taskId}`, { signal });
            if (!response.ok) throw await readError(response, t.errorProcessFailed, uiLanguage);
            receive(await response.json());
        } catch (error) {
            if (signal?.aborted) return;
            // Brief network failures should not lose a long-running media task.
        }
        if (!settled) fallbackTimer = window.setTimeout(poll, 1500);
    };

    const handleAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectDone(new DOMException('Task cancelled', 'AbortError'));
    };

    source.addEventListener('snapshot', (event) => {
        const snapshot = parseEvent<TaskStatus>(event);
        if (snapshot) receive(snapshot);
    });
    source.addEventListener('task', (event) => {
        const state = parseEvent<Omit<TaskStatus, 'captions'>>(event);
        if (state) receiveState(state);
    });
    source.addEventListener('captions', (event) => {
        const captionsEvent = parseEvent<CaptionEvent>(event);
        if (captionsEvent) receiveCaptions(captionsEvent);
    });
    source.onmessage = (event) => {
        const legacyTask = parseEvent<TaskStatus>(event);
        if (legacyTask) receive(legacyTask);
    };
    source.onerror = () => {
        source?.close();
        source = null;
        if (fallbackTimer === null && !settled) poll();
    };

    if (signal?.aborted) {
        handleAbort();
    } else {
        signal?.addEventListener('abort', handleAbort, { once: true });
    }

    return { done, close: cleanup };
};

/**
 * Upload media in bounded chunks and stream server-side processing updates.
 */
export const transcribeWithServer = async (
    file: File,
    segmentStyle: SegmentStyle = 'natural',
    contextPrompt: string = '',
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    apiKey?: string,
    uiLanguage: Language = 'en',
    signal?: AbortSignal
): Promise<void> => {
    const t = getTranslation(uiLanguage);
    const fileSize = formatFileSize(file.size);
    let session: UploadSession | null = null;
    let subscription: TaskSubscription | null = null;
    let highestProgress = 0;
    let streamingStarted = false;
    let uploadFinished = false;
    let latestUploadProgress: { loaded: number; total: number; percent: number } | null = null;
    let latestTask: TaskStatus | null = null;
    let lastCaptions: CaptionSegment[] | null = null;
    let rearmingProcessing = false;
    let lastProgressSignature = '';

    const reportProgress = (info: ProgressInfo) => {
        highestProgress = Math.max(highestProgress, info.progress);
        const normalized = { ...info, progress: highestProgress };
        const signature = JSON.stringify(normalized);
        if (signature === lastProgressSignature) return;
        lastProgressSignature = signature;
        onProgress?.(normalized);
    };

    const stageLabels: Record<TaskStatus['stage'], string> = {
        uploading: t.progressUploading,
        queued: t.progressQueued,
        streaming: t.progressStreaming,
        extracting: t.progressExtracting,
        splitting: t.progressSegmenting,
        transcribing: t.progressTranscribing,
        done: t.progressDone
    };

    const renderUnifiedProgress = () => {
        if (!uploadFinished && latestUploadProgress) {
            const { loaded, percent } = latestUploadProgress;
            reportProgress({
                stage: streamingStarted ? 'transcribing' : 'uploading',
                stageLabel: streamingStarted ? t.progressStreaming : t.progressUploading,
                progress: Math.max(Math.round(percent * 0.2), latestTask?.progress || 0),
                detail: t.progressUploadDetail
                    .replace('{percent}', percent.toString())
                    .replace('{uploaded}', formatFileSize(loaded))
                    .replace('{total}', fileSize)
            });
            return;
        }

        if (!latestTask) return;
        reportProgress({
            stage: latestTask.stage === 'uploading'
                ? 'uploading'
                : latestTask.stage === 'transcribing' || latestTask.stage === 'done'
                    ? 'transcribing'
                    : 'extracting_audio',
            stageLabel: stageLabels[latestTask.stage] || latestTask.stage,
            progress: latestTask.progress,
            detail: latestTask.captions.length > 0
                ? t.progressGenerated.replace('{count}', latestTask.captions.length.toString())
                : undefined
        });
    };

    try {
        const { transcribeMp4AudioFastPath } = await import('./mp4AudioService');
        const usedAudioOnlyUpload = await transcribeMp4AudioFastPath(
            file,
            segmentStyle,
            contextPrompt,
            onChunk,
            reportProgress,
            apiKey,
            uiLanguage,
            signal
        );
        if (usedAudioOnlyUpload) return;
        if (isVideoFile(file) && file.size > MAX_FULL_VIDEO_UPLOAD_BYTES) {
            throw new UserFacingError(
                t.errorFastPathFormat.replace('{size}', formatFileSize(file.size))
            );
        }

        reportProgress({
            stage: 'uploading',
            stageLabel: t.progressUploading,
            progress: highestProgress
        });

        session = await createUploadSession(file, segmentStyle, contextPrompt, apiKey, signal, uiLanguage);
        uploadFinished = session.uploadComplete;
        latestUploadProgress = {
            loaded: session.uploadedBytes,
            total: file.size,
            percent: file.size > 0 ? Math.round((session.uploadedBytes / file.size) * 100) : 0
        };

        subscription = subscribeToTask(session.taskId, (task) => {
            latestTask = task;
            if (!['uploading', 'queued'].includes(task.stage)) streamingStarted = true;
            if (task.uploadComplete && task.status === 'processing' && task.stage === 'queued' && !rearmingProcessing) {
                rearmingProcessing = true;
                void completeUpload(session!, apiKey, signal, uiLanguage)
                    .catch(() => undefined)
                    .finally(() => { rearmingProcessing = false; });
            }
            if (task.captions !== lastCaptions) {
                lastCaptions = task.captions;
                onChunk(task.captions);
            }
            renderUnifiedProgress();
        }, uiLanguage, signal);

        if (!session.uploadComplete) {
            await uploadInWorker(file, session, (loaded, total, percent) => {
                latestUploadProgress = { loaded, total, percent };
                renderUnifiedProgress();
            }, uiLanguage, signal);
            uploadFinished = true;
            renderUnifiedProgress();
        }

        await completeUpload(session, apiKey, signal, uiLanguage);
        const completedTask = await subscription.done;
        if (completedTask.captions !== lastCaptions) onChunk(completedTask.captions);
        clearUploadSession(session);
    } catch (error) {
        const aborted = signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
        const shouldCancelServer = Boolean((signal?.reason as { cancelServerTask?: boolean } | undefined)?.cancelServerTask);
        if (aborted && shouldCancelServer && session) {
            clearUploadSession(session);
            void cancelTask(session);
        }
        if (aborted) throw error;
        if (error instanceof UserFacingError) throw error;
        throw new UserFacingError(t.errorProcessFailed);
    } finally {
        subscription?.close();
    }
};

/** Check if the backend server is available. */
export const checkServerHealth = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${SERVER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        return response.ok;
    } catch {
        return false;
    }
};
