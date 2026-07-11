import { CaptionSegment, CaptionMode, ProgressInfo, SegmentStyle } from '../types';
import { Language, getTranslation } from '../utils/i18n';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const UPLOAD_CONCURRENCY = 2;

interface UploadSession {
    taskId: string;
    uploadToken: string;
    chunkSize: number;
    totalChunks: number;
}

interface TaskStatus {
    status: 'uploading' | 'processing' | 'completed' | 'error' | 'cancelled';
    progress: number;
    stage: 'uploading' | 'queued' | 'extracting' | 'splitting' | 'transcribing' | 'translating' | 'done';
    captions: CaptionSegment[];
    error: string | null;
    uploadedBytes?: number;
    totalBytes?: number;
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

const readError = async (response: Response, fallback: string): Promise<Error> => {
    try {
        const body = await response.json();
        return new Error(body.error || fallback);
    } catch {
        return new Error(fallback);
    }
};

const createUploadSession = async (
    file: File,
    segmentStyle: SegmentStyle,
    contextPrompt: string,
    targetLanguage: string,
    captionMode: CaptionMode,
    signal: AbortSignal | undefined,
    uiLanguage: Language
): Promise<UploadSession> => {
    const response = await fetch(`${SERVER_URL}/api/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            segmentStyle,
            contextPrompt,
            targetLanguage,
            captionMode
        }),
        signal
    });

    if (!response.ok) {
        throw await readError(response, uiLanguage === 'zh' ? '无法创建上传任务' : 'Could not create upload task');
    }
    return response.json();
};

const uploadInWorker = (
    file: File,
    session: UploadSession,
    onProgress: (loaded: number, total: number, percent: number) => void,
    signal?: AbortSignal
): Promise<void> => new Promise((resolve, reject) => {
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
            finish(() => reject(new Error(message.error)));
        }
    };

    worker.onerror = (event) => {
        finish(() => reject(new Error(event.message || 'Upload worker failed')));
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
        throw await readError(response, uiLanguage === 'zh' ? '无法完成上传' : 'Could not finalize upload');
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
    signal?: AbortSignal
): TaskSubscription => {
    let source: EventSource | null = new EventSource(`${SERVER_URL}/api/task/${taskId}/stream`);
    let settled = false;
    let fallbackTimer: number | null = null;
    let resolveDone!: (task: TaskStatus) => void;
    let rejectDone!: (error: Error) => void;

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
            rejectDone(new Error(task.error || (task.status === 'cancelled' ? 'Task cancelled' : 'Processing failed')));
        }
    };

    const receive = (task: TaskStatus) => {
        onUpdate(task);
        if (task.status === 'completed' || task.status === 'error' || task.status === 'cancelled') {
            finish(task);
        }
    };

    const poll = async () => {
        if (settled || signal?.aborted) return;
        try {
            const response = await fetch(`${SERVER_URL}/api/task/${taskId}`, { signal });
            if (!response.ok) throw await readError(response, 'Task status unavailable');
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

    source.onmessage = (event) => {
        try {
            receive(JSON.parse(event.data));
        } catch {
            // Ignore malformed proxy heartbeat data and keep the stream open.
        }
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
    targetLanguage: string = 'English',
    mode: CaptionMode = 'Original',
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
    const reserveTranslation = mode !== 'Original';
    let session: UploadSession | null = null;
    let subscription: TaskSubscription | null = null;
    let highestProgress = 0;

    const reportProgress = (info: ProgressInfo) => {
        highestProgress = Math.max(highestProgress, info.progress);
        onProgress?.({ ...info, progress: highestProgress });
    };

    const stageLabels: Record<TaskStatus['stage'], string> = {
        uploading: t.uploading,
        queued: uiLanguage === 'zh' ? '等待服务端处理...' : 'Waiting for server...',
        extracting: t.extractingAudio,
        splitting: t.segmenting,
        transcribing: t.transcribing,
        translating: t.translating,
        done: t.done
    };

    try {
        const { transcribeMp4AudioFastPath } = await import('./mp4AudioService');
        const usedAudioFastPath = await transcribeMp4AudioFastPath(
            file,
            targetLanguage,
            mode,
            segmentStyle,
            contextPrompt,
            onChunk,
            reportProgress,
            apiKey,
            uiLanguage,
            signal
        );
        if (usedAudioFastPath) return;

        reportProgress({
            stage: 'uploading',
            stageLabel: t.uploading,
            progress: highestProgress,
            detail: uiLanguage === 'zh'
                ? '当前容器或音频编码不支持音轨快速路径，改用兼容上传'
                : 'This container or audio codec needs the compatible full-file upload path'
        });

        session = await createUploadSession(file, segmentStyle, contextPrompt, targetLanguage, mode, signal, uiLanguage);

        subscription = subscribeToTask(session.taskId, (task) => {
            if (task.captions.length > 0) onChunk(task.captions);

            const progress = reserveTranslation
                ? Math.min(90, Math.round(task.progress * 0.9))
                : task.progress;
            reportProgress({
                stage: task.stage === 'uploading'
                    ? 'uploading'
                    : task.stage === 'transcribing' || task.stage === 'translating' || task.stage === 'done'
                        ? 'transcribing'
                        : 'extracting_audio',
                stageLabel: stageLabels[task.stage] || task.stage,
                progress,
                detail: task.captions.length > 0
                    ? t.capturedInfo.replace('{count}', task.captions.length.toString())
                    : t.analyzing
            });
        }, signal);

        await uploadInWorker(file, session, (loaded, total, percent) => {
            const uploadProgress = Math.round(percent * 0.2);
            reportProgress({
                stage: 'uploading',
                stageLabel: t.uploading,
                progress: reserveTranslation ? Math.round(uploadProgress * 0.9) : uploadProgress,
                detail: uiLanguage === 'zh'
                    ? `${percent}% · ${formatFileSize(loaded)} / ${fileSize}`
                    : `${percent}% · ${formatFileSize(loaded)} / ${fileSize}`
            });
        }, signal);

        await completeUpload(session, apiKey, signal, uiLanguage);
        const completedTask = await subscription.done;
        if (completedTask.captions.length > 0) onChunk(completedTask.captions);
    } catch (error) {
        if (session) void cancelTask(session);
        throw error;
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
