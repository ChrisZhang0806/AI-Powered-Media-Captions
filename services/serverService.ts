import { CaptionSegment, CaptionMode, ProgressInfo, SegmentStyle } from '../types';
import { Language, getTranslation } from '../utils/i18n';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

interface TaskStatus {
    status: 'processing' | 'completed' | 'error';
    progress: number;
    stage: string;
    captions: CaptionSegment[];
    error: string | null;
}

/**
 * Use backend service to process video/audio files
 * 10-50x faster than browser-side FFmpeg WASM
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
    uiLanguage: Language = 'en'
): Promise<void> => {
    const t = getTranslation(uiLanguage);

    // 1. Upload file
    onProgress?.({
        stage: 'extracting_audio',
        stageLabel: t.uploading,
        progress: 5,
        detail: uiLanguage === 'zh'
            ? `文件大小: ${(file.size / 1024 / 1024).toFixed(1)} MB`
            : `File size: ${(file.size / 1024 / 1024).toFixed(1)} MB`
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('segmentStyle', segmentStyle);
    formData.append('contextPrompt', contextPrompt);
    if (apiKey) formData.append('apiKey', apiKey);

    const uploadResponse = await fetch(`${SERVER_URL}/api/transcribe`, {
        method: 'POST',
        body: formData
    });

    if (!uploadResponse.ok) {
        try {
            const errorData = await uploadResponse.json();
            throw new Error(errorData.error || (uiLanguage === 'zh' ? '上传失败' : 'Upload failed'));
        } catch (e: any) {
            throw new Error(e.message || (uiLanguage === 'zh' ? '上传失败，请检查网络或文件大小' : 'Upload failed, check network or file size'));
        }
    }

    const { taskId } = await uploadResponse.json();
    console.log('[Server] Task created:', taskId);

    // 2. Poll task status
    await pollTaskStatus(taskId, onChunk, onProgress, mode, targetLanguage, uiLanguage);
};

/**
 * Poll task status until completion or error
 */
async function pollTaskStatus(
    taskId: string,
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    mode?: CaptionMode,
    targetLanguage?: string,
    uiLanguage: Language = 'en'
): Promise<void> {
    const t = getTranslation(uiLanguage);

    const stageLabels: Record<string, string> = {
        'uploading': t.uploading,
        'extracting': t.extractingAudio,
        'splitting': t.segmenting,
        'transcribing': t.transcribing,
        'done': t.done
    };

    return new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const response = await fetch(`${SERVER_URL}/api/task/${taskId}`);
                const task: TaskStatus = await response.json();

                onProgress?.({
                    stage: task.stage === 'transcribing' ? 'transcribing' : 'extracting_audio',
                    stageLabel: stageLabels[task.stage] || task.stage,
                    progress: task.progress,
                    detail: task.captions.length > 0
                        ? t.capturedInfo.replace('{count}', task.captions.length.toString())
                        : t.analyzing
                });

                // Real-time caption updates
                if (task.captions.length > 0) {
                    onChunk(task.captions);
                }

                if (task.status === 'completed') {
                    onChunk(task.captions);

                    onProgress?.({
                        stage: 'transcribing',
                        stageLabel: t.done,
                        progress: 100,
                        detail: uiLanguage === 'zh'
                            ? `共 ${task.captions.length} 条字幕`
                            : `Total ${task.captions.length} captions`
                    });
                    resolve();
                } else if (task.status === 'error') {
                    reject(new Error(task.error || (uiLanguage === 'zh' ? '处理失败' : 'Processing failed')));
                } else {
                    // Continue polling
                    setTimeout(poll, 1000);
                }
            } catch (error) {
                reject(error);
            }
        };

        poll();
    });
}

/**
 * Check if the backend server is available
 */
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
