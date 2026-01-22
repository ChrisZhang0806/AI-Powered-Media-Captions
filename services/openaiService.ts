import OpenAI from 'openai';
import { CaptionSegment, CaptionMode, SegmentStyle, ProgressInfo } from '../types';
import { extractAudio, segmentAudioStream, isVideoFile } from '../utils/audioUtils';
import { Language, getTranslation } from '../utils/i18n';

const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY || 'dummy_key_for_init',
    dangerouslyAllowBrowser: true // Allowed for browser usage (demo only)
});

const SEGMENT_STYLE_PROMPTS: Record<SegmentStyle, string> = {
    compact: 'Extremely short sentences. Break frequently. Maximum 7 words per segment. Suitable for fast-paced subtitles.',
    natural: 'Break sentences into short, readable subtitle lines. Use commas to split long thoughts. Maximum 10-12 words per line.',
    detailed: 'Follow natural speech flow but avoid extremely long blocks. Break at logical pauses.'
};

/**
 * Format Whisper timestamps (seconds) to SRT format (HH:MM:SS,mmm)
 */
const formatTimestamp = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
};

/**
 * Validate if the API Key is valid
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
 * Get OpenAI client instance
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
 * Transcribe a single audio segment
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

    // Whisper returns segments containing start, end, text
    return (response as any).segments || [];
};

/**
 * Process and transcribe audio in a streaming fashion
 */
export const generateCaptionsStream = async (
    file: File,
    targetLanguage: string = 'English',
    mode: CaptionMode = 'Original',
    segmentStyle: SegmentStyle = 'natural',
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    userApiKey?: string,
    uiLanguage: Language = 'en'
): Promise<void> => {
    const t = getTranslation(uiLanguage);
    const MAX_DIRECT_SIZE = 24 * 1024 * 1024; // 24MB (1MB buffer reserved)
    const isSmallAudioFile = file.type.startsWith('audio/') && file.size <= MAX_DIRECT_SIZE;

    // Fast track for small files: direct transcription, skip FFmpeg
    if (isSmallAudioFile) {
        onProgress?.({
            stage: 'transcribing',
            stageLabel: t.prepUpload,
            progress: 20,
            detail: uiLanguage === 'zh' ? '小文件无需分割，直接处理' : 'Small file, direct process'
        });

        // Simulate progress updates (Whisper API doesn't provide real-time stream)
        const progressInterval = setInterval(() => {
            onProgress?.({
                stage: 'transcribing',
                stageLabel: t.aiRecognizing,
                progress: Math.min(80, 30 + Math.random() * 40),
                detail: t.analyzing
            });
        }, 1500);

        try {
            const whisperSegments = await transcribeSegment(file, undefined, segmentStyle, userApiKey);
            clearInterval(progressInterval);

            onProgress?.({
                stage: 'transcribing',
                stageLabel: t.organizing,
                progress: 90,
                detail: t.capturedInfo.replace('{count}', whisperSegments.length.toString())
            });

            const captions: CaptionSegment[] = whisperSegments.map((seg, i) => ({
                id: i,
                startTime: formatTimestamp(seg.start),
                endTime: formatTimestamp(seg.end),
                text: seg.text.trim()
            }));

            onChunk(captions);

            // Translation processing
            if (mode !== 'Original' && captions.length > 0) {
                onProgress?.({
                    stage: 'translating',
                    stageLabel: t.translating,
                    progress: 70,
                    detail: `${t.translating} ${targetLanguage}`
                });

                const translated = await translateSegments(captions, targetLanguage, 0.5, undefined, userApiKey, uiLanguage);
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
                stageLabel: t.done,
                progress: 100,
                detail: t.capturedInfo.replace('{count}', captions.length.toString())
            });
            return;
        } catch (error) {
            clearInterval(progressInterval);
            throw error;
        }
    }

    // Process for large files
    onProgress?.({
        stage: 'segmenting',
        stageLabel: t.preparingEngine,
        progress: 0,
        detail: t.readyForSegment
    });

    const allCaptions: CaptionSegment[] = [];
    const activeTasks: Promise<void>[] = [];
    const MAX_CONCURRENT_TRANSCRIPTIONS = 3; // Allow 3 concurrent OpenAI requests
    let segmentCount = 0;
    let completedCount = 0;


    // Helper: update and callback captions
    const addAndSortCaptions = (newSegments: CaptionSegment[]) => {
        allCaptions.push(...newSegments);
        // Sort by start time
        allCaptions.sort((a, b) => parseTimestamp(a.startTime) - parseTimestamp(b.startTime));

        // Deduplication (especially for overlaps)
        const uniqueCaptions: CaptionSegment[] = [];
        for (const cap of allCaptions) {
            const last = uniqueCaptions[uniqueCaptions.length - 1];
            if (!last || parseTimestamp(cap.startTime) >= parseTimestamp(last.endTime) - 0.5) {
                uniqueCaptions.push(cap);
            }
        }

        // Reassign IDs and callback
        const result = uniqueCaptions.map((c, i) => ({ ...c, id: i }));
        onChunk(result);
        return result;
    };

    // 2. Extract audio if it's a video file
    let audioSource: Blob = file;
    if (isVideoFile(file)) {
        onProgress?.({
            stage: 'extracting_audio',
            stageLabel: t.extractingAudio,
            progress: 5,
            detail: t.timeWait
        });

        try {
            audioSource = await extractAudio(file, (p) => {
                const overallProgress = 5 + Math.round(p * 0.3);
                onProgress?.({
                    stage: 'extracting_audio',
                    stageLabel: t.extractingAudio,
                    progress: overallProgress,
                    detail: t.extractingDetails
                });
            });
            console.log('[Captions] Audio extraction complete, size:', (audioSource.size / 1024 / 1024).toFixed(2), 'MB');
        } catch (error) {
            console.error('[Captions] Audio extraction failed:', error);
            throw new Error(uiLanguage === 'zh' ? '视频音频提取失败，请检查视频文件格式' : 'Video audio extraction failed, please check file format');
        }
    }

    // 3. Stream-split audio (transcribe while splitting)
    await segmentAudioStream(
        audioSource,
        async ({ blob, startTime }) => {
            const currentSegmentIndex = segmentCount++;

            // Simple concurrency control: wait if tasks exceed limit
            if (activeTasks.length >= MAX_CONCURRENT_TRANSCRIPTIONS) {
                await Promise.race(activeTasks);
            }

            const task = (async () => {
                try {
                    onProgress?.({
                        stage: 'transcribing',
                        stageLabel: t.transcribing,
                        progress: Math.min(99, Math.round((completedCount / (segmentCount || 1)) * 100)),
                        detail: t.segmentInfo.replace('{index}', (currentSegmentIndex + 1).toString())
                    });

                    const whisperSegments = await transcribeSegment(blob, undefined, segmentStyle, userApiKey);

                    const newCaptions: CaptionSegment[] = whisperSegments.map(seg => ({
                        id: 0, // Temp ID, will be reassigned
                        startTime: formatTimestamp(seg.start + startTime),
                        endTime: formatTimestamp(seg.end + startTime),
                        text: seg.text.trim()
                    }));

                    const currentFullList = addAndSortCaptions(newCaptions);

                    // 3. Real-time translation (if requested)
                    if (mode !== 'Original' && newCaptions.length > 0) {
                        const translated = await translateSegments(newCaptions, targetLanguage, 0.5, undefined, userApiKey, uiLanguage);

                        // Update items in the full list
                        const finalBilingual = currentFullList.map(cap => {
                            const t = translated.find(tr => tr.startTime === cap.startTime);
                            if (!t) return cap;

                            if (mode === 'Translation') {
                                return { ...cap, text: t.text };
                            } else {
                                // Prevent duplicate appendage
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
            // Remove from active tasks after completion
            task.finally(() => {
                const index = activeTasks.indexOf(task);
                if (index > -1) activeTasks.splice(index, 1);
            });
        },
        (info) => {
            // Feedback low-level segmentation progress to UI
            onProgress?.({
                stage: 'segmenting',
                stageLabel: info.stageLabel,
                progress: info.progress,
                detail: uiLanguage === 'zh' ? '正在准备音轨...' : 'Preparing audio tracks...'
            });
        }
    );

    // Wait for all remaining tasks
    await Promise.all(activeTasks);

    onProgress?.({
        stage: 'transcribing',
        stageLabel: t.done,
        progress: 100,
        detail: t.capturedInfo.replace('{count}', allCaptions.length.toString())
    });
};

/**
 * Detect source language of the captions
 */
const detectSourceLanguage = (segments: CaptionSegment[]): string => {
    const text = segments.map(s => s.text).join(' ');

    // Detect character types
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    const japaneseChars = text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || [];
    const koreanChars = text.match(/[\uac00-\ud7af]/g) || [];

    const totalChars = text.length;

    if (chineseChars.length / totalChars > 0.1) return 'Chinese';
    if (japaneseChars.length / totalChars > 0.1) return 'Japanese';
    if (koreanChars.length / totalChars > 0.1) return 'Korean';

    return 'English';
};

/**
 * Parse timestamp string to seconds
 */
const parseTimestamp = (timestamp: string): number => {
    const [time, ms] = timestamp.split(',');
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms) / 1000;
};

/**
 * Translate subtitle segments (supporting batching and 1:1 alignment)
 */
export const translateSegments = async (
    segments: CaptionSegment[],
    targetLanguage: string,
    styleValue: number = 0.5,
    onChunk?: (translatedSegments: CaptionSegment[]) => void,
    userApiKey?: string,
    uiLanguage: Language = 'en'
): Promise<CaptionSegment[]> => {
    if (segments.length === 0) return [];

    // Map styleValue (0-1) to 0-100 strength
    const styleStrength = Math.round(styleValue * 100);

    let styleDesc = "";
    if (styleStrength <= 33) {
        // ENHANCED LITERAL
        styleDesc = "LITERAL. Translate with technical precision. DO NOT use creative synonyms. Keep the sentence structure identical to the source. If the source is a fragment, keep it as a fragment. Strictly avoid adding any personal interpretations.";
    } else if (styleStrength <= 66) {
        // BALANCED
        styleDesc = "BALANCED. Focus on clarity and readability. Use standard, clear language that would be appropriate for a general audience. Ensure the tone is natural while remaining faithful to the core meaning.";
    } else {
        // CREATIVE LOCALIZATION
        styleDesc = "CREATIVE. Act as a professional localizer. Rewrite metaphors into culturally equivalent ones. Use informal, catchy, or dramatic language suitable for social media or entertainment. Prioritize 'vibe', emotional impact, and natural flow over word-for-word accuracy.";
    }

    // Detect source language
    const sourceLang = detectSourceLanguage(segments);

    const translatedSegments = [...segments];
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

    const translateBatch = async (batchIndex: number) => {
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, segments.length);
        const batch = segments.slice(start, end);

        // Use JSON structure for clarity
        const inputData = batch.map((s, idx) => ({ id: idx, text: s.text }));
        const client = getClient(userApiKey);

        try {
            const response = await client.chat.completions.create({
                model: 'gpt-5-nano',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert subtitle translator specialized in converting ${sourceLang} content to ${targetLanguage}.

Your goal is to translate the provided subtitle blocks according to this style guide: "${styleDesc}".

- Preserve line breaks within the text if they make semantic sense.
- Do not merge separate subtitle blocks.
- Return the result strictly as a JSON object with a "translations" array where each object contains the 'id' (matching input) and 'text' (translated text).`
                    },
                    {
                        role: 'user',
                        content: `Translate these subtitles:\n${JSON.stringify(inputData)}`
                    }
                ],
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
                    text: translatedText
                };
            });

            onChunk?.([...translatedSegments]);
        } catch (err) {
            console.error('Batch translation error:', err);
            throw err; // Re-throw to be caught by UI
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
 * Semantic subtitle refinement (using GPT)
 */
export const refineSegments = async (
    segments: CaptionSegment[],
    userApiKey?: string
): Promise<CaptionSegment[]> => {
    if (segments.length <= 1) return segments;

    const client = getClient(userApiKey);

    try {
        const response = await client.chat.completions.create({
            model: 'gpt-5-nano',
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
