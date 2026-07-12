import OpenAI from 'openai';
import { CaptionSegment, SegmentStyle, ProgressInfo } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { UserFacingError } from '../utils/userFacingError';

const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY || 'dummy_key_for_init',
    dangerouslyAllowBrowser: true // Allowed for browser usage (demo only)
});



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
    });

    // Whisper returns segments containing start, end, text
    return (response as any).segments || [];
};

/**
 * Process and transcribe audio in a streaming fashion
 */
export const generateCaptionsStream = async (
    file: File,
    segmentStyle: SegmentStyle,
    onChunk: (segments: CaptionSegment[]) => void,
    onProgress?: (info: ProgressInfo) => void,
    userApiKey?: string,
    uiLanguage: Language = 'en'
): Promise<void> => {
    const t = getTranslation(uiLanguage);
    // Legacy browser processing stays in a lazy chunk and is never loaded by the web workflow.
    const { extractAudio, segmentAudioStream, isVideoFile } = await import('../utils/audioUtils');
    const MAX_DIRECT_SIZE = 24 * 1024 * 1024; // 24MB (1MB buffer reserved)
    const isSmallAudioFile = file.type.startsWith('audio/') && file.size <= MAX_DIRECT_SIZE;

    // Fast track for small files: direct transcription, skip FFmpeg
    if (isSmallAudioFile) {
        onProgress?.({
            stage: 'transcribing',
            stageLabel: t.progressPreparing,
            progress: 20
        });

        // Simulate progress updates (Whisper API doesn't provide real-time stream)
        const progressInterval = setInterval(() => {
            onProgress?.({
                stage: 'transcribing',
                stageLabel: t.progressTranscribing,
                progress: Math.min(80, 30 + Math.random() * 40)
            });
        }, 1500);

        try {
            const whisperSegments = await transcribeSegment(file, undefined, segmentStyle, userApiKey);
            clearInterval(progressInterval);

            onProgress?.({
                stage: 'transcribing',
                stageLabel: t.progressFinalizing,
                progress: 90,
                detail: t.progressGenerated.replace('{count}', whisperSegments.length.toString())
            });

            const captions: CaptionSegment[] = whisperSegments.map((seg, i) => ({
                id: i,
                startTime: formatTimestamp(seg.start),
                endTime: formatTimestamp(seg.end),
                text: seg.text.trim()
            }));

            onChunk(captions);

            onProgress?.({
                stage: 'transcribing',
                stageLabel: t.progressDone,
                progress: 100,
                detail: t.progressGenerated.replace('{count}', captions.length.toString())
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
        stageLabel: t.progressPreparing,
        progress: 0
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
            stageLabel: t.progressExtracting,
            progress: 5
        });

        try {
            audioSource = await extractAudio(file, (p) => {
                const overallProgress = 5 + Math.round(p * 0.3);
                onProgress?.({
                    stage: 'extracting_audio',
                    stageLabel: t.progressExtracting,
                    progress: overallProgress
                });
            });
            console.log('[Captions] Audio extraction complete, size:', (audioSource.size / 1024 / 1024).toFixed(2), 'MB');
        } catch (error) {
            console.error('[Captions] Audio extraction failed:', error);
            throw new UserFacingError(t.errorAudioExtract);
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
                        stageLabel: t.progressTranscribing,
                        progress: Math.min(99, Math.round((completedCount / (segmentCount || 1)) * 100)),
                        detail: t.progressSegmentDetail.replace('{index}', (currentSegmentIndex + 1).toString())
                    });

                    const whisperSegments = await transcribeSegment(blob, undefined, segmentStyle, userApiKey);

                    const newCaptions: CaptionSegment[] = whisperSegments.map(seg => ({
                        id: 0, // Temp ID, will be reassigned
                        startTime: formatTimestamp(seg.start + startTime),
                        endTime: formatTimestamp(seg.end + startTime),
                        text: seg.text.trim()
                    }));

                    addAndSortCaptions(newCaptions);

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
                stageLabel: t.progressSegmenting,
                progress: info.progress
            });
        }
    );

    // Wait for all remaining tasks
    await Promise.all(activeTasks);

    onProgress?.({
        stage: 'transcribing',
        stageLabel: t.progressDone,
        progress: 100,
        detail: t.progressGenerated.replace('{count}', allCaptions.length.toString())
    });
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
            model: 'gpt-4o',
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
