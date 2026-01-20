import { CaptionSegment } from '../types';
import { CaptionMode, ProgressInfo, SegmentStyle } from './openaiService';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

interface TaskStatus {
    status: 'processing' | 'completed' | 'error';
    progress: number;
    stage: string;
    captions: CaptionSegment[];
    error: string | null;
}

/**
 * 使用后端服务处理视频/音频文件
 * 比浏览器端 FFmpeg WASM 快 10-50 倍
 */
export const transcribeWithServer = async (
    file: File,
    targetLanguage: string = 'English',
    mode: CaptionMode = 'Original',
    segmentStyle: SegmentStyle = 'natural',
    contextPrompt: string = '',
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void
): Promise<void> => {
    // 1. 上传文件
    onProgress?.({
        stage: 'extracting_audio',
        stageLabel: '上传文件到服务器...',
        progress: 5,
        detail: `文件大小: ${(file.size / 1024 / 1024).toFixed(1)} MB`
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('segmentStyle', segmentStyle);
    formData.append('contextPrompt', contextPrompt);

    const uploadResponse = await fetch(`${SERVER_URL}/api/transcribe`, {
        method: 'POST',
        body: formData
    });

    if (!uploadResponse.ok) {
        try {
            const errorData = await uploadResponse.json();
            throw new Error(errorData.error || '上传失败');
        } catch (e: any) {
            throw new Error(e.message || '上传失败，请检查网络或文件大小');
        }
    }

    const { taskId } = await uploadResponse.json();
    console.log('[Server] 任务已创建:', taskId);

    // 2. 轮询任务状态
    await pollTaskStatus(taskId, onChunk, onProgress, mode, targetLanguage);
};

/**
 * 轮询任务状态
 */
async function pollTaskStatus(
    taskId: string,
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    mode?: CaptionMode,
    targetLanguage?: string
): Promise<void> {
    const stageLabels: Record<string, string> = {
        'uploading': '上传中...',
        'extracting': '提取音频中...',
        'splitting': '分割音频中...',
        'transcribing': '转录中...',
        'done': '处理完成'
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
                    detail: `已获取 ${task.captions.length} 条字幕`
                });

                // 实时更新字幕
                if (task.captions.length > 0) {
                    onChunk(task.captions);
                }

                if (task.status === 'completed') {
                    onChunk(task.captions);

                    // TODO: 如果需要翻译，在这里调用翻译 API
                    // if (mode !== 'Original' && task.captions.length > 0) {
                    //     const translated = await translateSegments(task.captions, targetLanguage);
                    //     ...
                    // }

                    onProgress?.({
                        stage: 'transcribing',
                        stageLabel: '处理完成',
                        progress: 100,
                        detail: `共 ${task.captions.length} 条字幕`
                    });
                    resolve();
                } else if (task.status === 'error') {
                    reject(new Error(task.error || '处理失败'));
                } else {
                    // 继续轮询
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
 * 检查后端服务是否可用
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
