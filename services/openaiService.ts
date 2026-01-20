import OpenAI from 'openai';
import { CaptionSegment } from '../types';
import { extractAudio, segmentAudioStream, isVideoFile } from '../utils/audioUtils';

const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true // 允许在浏览器中使用（仅用于演示）
});

export type CaptionMode = 'Original' | 'Translation' | 'Bilingual';

/**
 * 断句风格
 */
export type SegmentStyle = 'compact' | 'natural' | 'detailed';

const SEGMENT_STYLE_PROMPTS: Record<SegmentStyle, string> = {
    compact: 'Extremely short sentences. Break frequently. Maximum 7 words per segment. Suitable for fast-paced subtitles.',
    natural: 'Break sentences into short, readable subtitle lines. Use commas to split long thoughts. Maximum 10-12 words per line.',
    detailed: 'Follow natural speech flow but avoid extremely long blocks. Break at logical pauses.'
};

/**
 * 进度信息接口
 */
export interface ProgressInfo {
    stage: 'loading_ffmpeg' | 'extracting_audio' | 'segmenting' | 'transcribing' | 'translating' | 'refining';
    stageLabel: string;
    progress: number; // 0-100
    detail?: string;
}

/**
 * 将 Whisper 返回的时间戳格式转换为 SRT 格式
 */
const formatTimestamp = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
};

/**
 * 验证 API Key 是否有效
 */
export const validateApiKey = async (apiKey: string): Promise<boolean> => {
    try {
        const testClient = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
        await testClient.models.list();
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * 获取 OpenAI 客户端实例
 */
const getClient = (userApiKey?: string) => {
    if (userApiKey) {
        return new OpenAI({
            apiKey: userApiKey,
            dangerouslyAllowBrowser: true
        });
    }
    return openai;
};

/**
 * 转录单个音频片段
 */
const transcribeSegment = async (
    audioBlob: Blob,
    language?: string,
    segmentStyle: SegmentStyle = 'natural',
    userApiKey?: string
): Promise<{ start: number; end: number; text: string }[]> => {
    const file = new File([audioBlob], 'audio.mp3', { type: 'audio/mp3' });
    const client = getClient(userApiKey);

    const response = await client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
        language: language === 'auto' ? undefined : language?.toLowerCase().slice(0, 2),
        prompt: SEGMENT_STYLE_PROMPTS[segmentStyle],
    });

    // Whisper 返回的 segments 包含 start, end, text
    return (response as any).segments || [];
};

/**
 * 流式处理并转录音频
 */
export const generateCaptionsStream = async (
    file: File,
    targetLanguage: string = 'English',
    mode: CaptionMode = 'Original',
    segmentStyle: SegmentStyle = 'natural',
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    userApiKey?: string
): Promise<void> => {
    const MAX_DIRECT_SIZE = 24 * 1024 * 1024; // 24MB (预留1MB缓冲)
    const isSmallAudioFile = file.type.startsWith('audio/') && file.size <= MAX_DIRECT_SIZE;

    // 小文件快速通道：直接转录，跳过 FFmpeg
    if (isSmallAudioFile) {
        onProgress?.({
            stage: 'transcribing',
            stageLabel: '准备上传到 AI...',
            progress: 20,
            detail: '小文件无需分割，直接处理'
        });

        // 模拟进度更新（因为 Whisper API 不提供实时进度）
        const progressInterval = setInterval(() => {
            onProgress?.({
                stage: 'transcribing',
                stageLabel: 'AI 正在识别语音...',
                progress: Math.min(80, 30 + Math.random() * 40),
                detail: '请稍候，正在转录中'
            });
        }, 1500);

        try {
            const whisperSegments = await transcribeSegment(file, undefined, segmentStyle, userApiKey);
            clearInterval(progressInterval);

            onProgress?.({
                stage: 'transcribing',
                stageLabel: '转录完成，整理结果...',
                progress: 90,
                detail: `识别到 ${whisperSegments.length} 个片段`
            });

            const captions: CaptionSegment[] = whisperSegments.map((seg, i) => ({
                id: i,
                startTime: formatTimestamp(seg.start),
                endTime: formatTimestamp(seg.end),
                text: seg.text.trim()
            }));

            onChunk(captions);

            // 翻译处理
            if (mode !== 'Original' && captions.length > 0) {
                onProgress?.({
                    stage: 'translating',
                    stageLabel: '翻译中...',
                    progress: 70,
                    detail: `翻译为 ${targetLanguage}`
                });

                const translated = await translateSegments(captions, targetLanguage, 0.5, undefined, userApiKey);
                if (mode === 'Translation') {
                    onChunk(translated);
                } else {
                    const bilingual = captions.map((cap, i) => ({
                        ...cap,
                        text: `${cap.text}\n${translated[i]?.text || ''}`
                    }));
                    onChunk(bilingual);
                }
            }

            onProgress?.({
                stage: 'transcribing',
                stageLabel: '处理完成',
                progress: 100,
                detail: `共 ${captions.length} 条字幕`
            });
            return;
        } catch (error) {
            clearInterval(progressInterval);
            throw error;
        }
    }

    // 大文件走原有流程
    onProgress?.({
        stage: 'segmenting',
        stageLabel: '启动处理引擎...',
        progress: 0,
        detail: '准备音频分割'
    });

    const allCaptions: CaptionSegment[] = [];
    const activeTasks: Promise<void>[] = [];
    const MAX_CONCURRENT_TRANSCRIPTIONS = 3; // 允许 3 个并发 OpenAI 请求
    let segmentCount = 0;
    let completedCount = 0;


    // 辅助函数：更新并回调字幕
    const addAndSortCaptions = (newSegments: CaptionSegment[]) => {
        allCaptions.push(...newSegments);
        // 按起始时间排序
        allCaptions.sort((a, b) => parseTimestamp(a.startTime) - parseTimestamp(b.startTime));

        // 去重处理（特别是重叠部分）
        const uniqueCaptions: CaptionSegment[] = [];
        for (const cap of allCaptions) {
            const last = uniqueCaptions[uniqueCaptions.length - 1];
            if (!last || parseTimestamp(cap.startTime) >= parseTimestamp(last.endTime) - 0.5) {
                uniqueCaptions.push(cap);
            }
        }

        // 重新分配 ID 并回调
        const result = uniqueCaptions.map((c, i) => ({ ...c, id: i }));
        onChunk(result);
        return result;
    };

    // 2. 如果是视频文件，先提取音频
    let audioSource: Blob = file;
    if (isVideoFile(file)) {
        onProgress?.({
            stage: 'extracting_audio',
            stageLabel: '正在从视频中提取音频...',
            progress: 5,
            detail: '这可能需要一些时间'
        });

        try {
            audioSource = await extractAudio(file, (p) => {
                const overallProgress = 5 + Math.round(p * 0.3);
                onProgress?.({
                    stage: 'extracting_audio',
                    stageLabel: '提取音频中...',
                    progress: overallProgress,
                    detail: '正在处理视频文件'
                });
            });
            console.log('[Captions] 音频提取完成，大小:', (audioSource.size / 1024 / 1024).toFixed(2), 'MB');
        } catch (error) {
            console.error('[Captions] 音频提取失败:', error);
            throw new Error('视频音频提取失败，请检查视频文件格式');
        }
    }

    // 3. 流式分割音频（一边切分一边转录）
    await segmentAudioStream(
        audioSource,
        async ({ blob, startTime }) => {
            const currentSegmentIndex = segmentCount++;

            // 如果当前活跃任务过多，等待其中一个完成（简单的并发控制）
            if (activeTasks.length >= MAX_CONCURRENT_TRANSCRIPTIONS) {
                await Promise.race(activeTasks);
            }

            const task = (async () => {
                try {
                    onProgress?.({
                        stage: 'transcribing',
                        stageLabel: '转录中...',
                        progress: Math.min(99, Math.round((completedCount / (segmentCount || 1)) * 100)),
                        detail: `正在处理第 ${currentSegmentIndex + 1} 个片段`
                    });

                    const whisperSegments = await transcribeSegment(blob, undefined, segmentStyle, userApiKey);

                    const newCaptions: CaptionSegment[] = whisperSegments.map(seg => ({
                        id: 0, // 临时，后续会重新分配
                        startTime: formatTimestamp(seg.start + startTime),
                        endTime: formatTimestamp(seg.end + startTime),
                        text: seg.text.trim()
                    }));

                    const currentFullList = addAndSortCaptions(newCaptions);

                    // 3. 实时翻译（如果是单语翻译模式或双语模式）
                    if (mode !== 'Original' && newCaptions.length > 0) {
                        const translated = await translateSegments(newCaptions, targetLanguage, 0.5, undefined, userApiKey);

                        // 更新总列表中的对应项
                        const finalBilingual = currentFullList.map(cap => {
                            const t = translated.find(tr => tr.startTime === cap.startTime);
                            if (!t) return cap;

                            if (mode === 'Translation') {
                                return { ...cap, text: t.text };
                            } else {
                                return { ...cap, text: `${cap.text}\n${t.text}` };
                            }
                        });
                        onChunk(finalBilingual);
                    }

                    completedCount++;
                } catch (error) {
                    console.error(`Segment ${currentSegmentIndex} failed:`, error);
                }
            })();

            activeTasks.push(task);
            // 任务完成后从活跃列表中移除
            task.finally(() => {
                const index = activeTasks.indexOf(task);
                if (index > -1) activeTasks.splice(index, 1);
            });
        },
        (info) => {
            // 将底层的细分进度反馈给 UI
            onProgress?.({
                stage: 'segmenting',
                stageLabel: info.stageLabel,
                progress: info.progress,
                detail: '正在准备音轨...'
            });
        }
    );

    // 等待所有剩余任务完成
    await Promise.all(activeTasks);

    onProgress?.({
        stage: 'transcribing',
        stageLabel: '处理完成',
        progress: 100,
        detail: `共处理完成 ${allCaptions.length} 条字幕`
    });
};

/**
 * 解析时间戳字符串为秒数
 */
const parseTimestamp = (timestamp: string): number => {
    const [time, ms] = timestamp.split(',');
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms) / 1000;
};

/**
 * 翻译字幕片段（支持批处理与 1:1 精准对齐）
 */
export const translateSegments = async (
    segments: CaptionSegment[],
    targetLanguage: string,
    styleValue: number = 0.5,
    onChunk?: (translatedSegments: CaptionSegment[]) => void,
    userApiKey?: string
): Promise<CaptionSegment[]> => {
    if (segments.length === 0) return [];

    let styleInstruction = "";
    if (styleValue <= 0.3) {
        styleInstruction = "DIRECT/LITERAL: Focus on absolute accuracy.";
    } else if (styleValue >= 0.7) {
        styleInstruction = "CREATIVE/IDIOMATIC: Focus on local cultural context.";
    } else {
        styleInstruction = "BALANCED: Ensure natural flow.";
    }

    const translatedSegments = [...segments];
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

    const translateBatch = async (batchIndex: number) => {
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, segments.length);
        const batch = segments.slice(start, end);

        // 使用 JSON 结构包装输入，彻底消除歧义
        const inputData = batch.map((s, idx) => ({ id: idx, text: s.text }));
        const client = getClient(userApiKey);

        try {
            const response = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional subtitle translator. 
Target Language: ${targetLanguage}
Style: ${styleInstruction}

CRITICAL: 
1. Input is JSON array. 
2. Return a JSON object with a "translations" array of objects {id: number, text: string}.
3. One input segment must map to exactly one output segment. DO NOT MERGE.`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(inputData)
                    }
                ],
                temperature: Math.max(0.1, styleValue),
                response_format: { type: "json_object" }
            });

            const content = response.choices[0]?.message?.content || '{"translations":[]}';
            const parsed = JSON.parse(content);
            const translations = parsed.translations || [];

            batch.forEach((seg, i) => {
                const match = translations.find((r: any) => r.id === i);
                const translatedText = match ? match.text.trim() : seg.text;

                const globalIndex = start + i;
                translatedSegments[globalIndex] = {
                    ...seg,
                    text: `${seg.text}\n${translatedText}`
                };
            });

            onChunk?.([...translatedSegments]);
        } catch (err) {
            console.error('Batch translation error:', err);
        }
    };

    const tasks = [];
    for (let i = 0; i < totalBatches; i++) {
        tasks.push(translateBatch(i));
        if (i % 3 === 0) await new Promise(r => setTimeout(r, 100));
    }

    await Promise.all(tasks);
    return translatedSegments;
};

/**
 * 语义优化字幕断句（使用 GPT）
 */
export const refineSegments = async (
    segments: CaptionSegment[],
    userApiKey?: string
): Promise<CaptionSegment[]> => {
    if (segments.length <= 1) return segments;

    const client = getClient(userApiKey);

    try {
        const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a subtitle editor. Adjust the text grouping to ensure subtitles break at natural linguistic boundaries.

RULES:
1. DO NOT change, add, or remove any words.
2. Prefer breaking at periods, commas, or conjunctions.
3. Avoid ending with prepositions, articles, or auxiliary verbs.
4. Keep startTime of first segment and endTime of last segment unchanged.
5. Output valid JSON array with same structure.`
                },
                {
                    role: 'user',
                    content: JSON.stringify(segments)
                }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const result = JSON.parse(response.choices[0]?.message?.content || '{}');
        if (Array.isArray(result.segments)) {
            return result.segments.map((cap: any, i: number) => ({ ...cap, id: i }));
        }
        return segments;
    } catch (error) {
        console.warn('Segmentation refinement failed:', error);
        return segments;
    }
};
