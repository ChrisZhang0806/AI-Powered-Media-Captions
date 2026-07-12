import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import {
    createWavBuffer,
    decodeMediaToSpeechSegments,
    parseByteRange
} from './streamingMedia.js';
import {
    attachUploadRuntime,
    notifyUploadChanged,
    streamUploadedRange,
    UploadManifestStore
} from './resumableUpload.js';
import { filterWhisperSegments, suppressRepeatedCaptions } from './transcriptionQuality.js';
import { segmentSubtitles } from './subtitleSegmentation.js';
import {
    getDefaultChineseNormalizationMode,
    normalizeChineseText,
    normalizeWhisperSegments,
    parseChineseNormalizationDirective
} from './chineseNormalization.js';
import { matchesStandardMp3Profile, STANDARD_MP3_PROFILE } from './audioProfile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

for (const envPath of [
    path.resolve(__dirname, '..', '.env.local'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env')
]) {
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

// Electron 环境下设置 FFmpeg 路径
if (process.env.FFMPEG_PATH) {
    console.log('[FFmpeg] Using custom path:', process.env.FFMPEG_PATH);
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}
if (process.env.FFPROBE_PATH) {
    console.log('[FFprobe] Using custom path:', process.env.FFPROBE_PATH);
    ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

// 配置
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, 'outputs'));
const configuredChunkSizeMb = Number(process.env.UPLOAD_CHUNK_SIZE_MB || 8);
const CHUNK_SIZE = Math.max(1, Math.min(64, configuredChunkSizeMb)) * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024;
const MAX_AUDIO_SEGMENT_SIZE = 16 * 1024 * 1024;
const MAX_CONCURRENT_MEDIA_TASKS = Math.max(1, Math.min(8, Number(process.env.MEDIA_PROCESSING_CONCURRENCY || 2)));
const MAX_STREAMING_TRANSCRIPTIONS = Math.max(1, Math.min(4, Number(process.env.STREAMING_TRANSCRIPTION_CONCURRENCY || 2)));
const TASK_TTL_MS = 60 * 60 * 1000;
const UPLOAD_IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const SUPPORTED_EXTENSIONS = new Set([
    '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.ts', '.mts', '.m2ts',
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma'
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma']);

// 确保目录存在
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
const uploadManifestStore = new UploadManifestStore(UPLOAD_DIR);

// 初始化 Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
let internalServerOrigin = process.env.INTERNAL_MEDIA_ORIGIN || `http://127.0.0.1:${PORT}`;

// 初始化 OpenAI (如果环境变量没设置，允许空 Key 启动，后续请求可以使用用户提供的 Key)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

// 配置文件上传
const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/', 'audio/'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.some(type => file.mimetype.startsWith(type)) || ext === '.ts') {
            cb(null, true);
        } else {
            cb(new Error('不支持此文件格式。请选择音频或视频文件。'));
        }
    }
});

const audioSegmentUpload = multer({
    storage,
    limits: { fileSize: MAX_AUDIO_SEGMENT_SIZE },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (file.mimetype?.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) {
            cb(null, true);
        } else {
            cb(new Error('无法读取音频片段。'));
        }
    }
});

const uploadAudioSegment = (req, res, next) => {
    audioSegmentUpload.single('file')(req, res, (error) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: '音频片段过大，无法转写。' });
            return;
        }
        next(error);
    });
};

// 存储任务状态
const tasks = new Map();
const taskSubscribers = new Map();
const processingQueue = [];
let activeProcessingTasks = 0;

class TaskCancelledError extends Error {
    constructor() {
        super('任务已取消。');
        this.name = 'TaskCancelledError';
    }
}

function serializeTaskState(task) {
    return {
        status: task.status,
        progress: task.progress,
        stage: task.stage,
        revision: task.revision || 0,
        captionCount: task.captions.length,
        error: task.error,
        uploadedBytes: task.uploadedBytes,
        totalBytes: task.totalBytes,
        uploadComplete: Boolean(task.uploadComplete),
        decodedSeconds: task.decodedSeconds || 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
    };
}

function serializeTask(task) {
    return { ...serializeTaskState(task), captions: task.captions };
}

function writeSse(response, event, data, id) {
    if (response.destroyed || response.writableEnded) return;
    if (id !== undefined) response.write(`id: ${id}\n`);
    if (event) response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastTask(taskId, captionChange = null) {
    const task = tasks.get(taskId);
    const subscribers = taskSubscribers.get(taskId);
    if (!task || !subscribers) return;

    subscribers.forEach((response) => {
        if (captionChange) {
            writeSse(response, 'captions', {
                captions: captionChange.captions,
                replace: captionChange.replace,
                totalCount: task.captions.length
            }, task.revision);
        }
        writeSse(response, 'task', serializeTaskState(task), task.revision);
    });

    if (['completed', 'error', 'cancelled'].includes(task.status)) {
        subscribers.forEach((response) => response.end());
        taskSubscribers.delete(taskId);
    }
}

function updateTask(taskId, patch) {
    const task = tasks.get(taskId);
    if (!task) return null;
    let captionChange = null;
    if (Array.isArray(patch.captions)) {
        const previous = task.captions || [];
        const next = patch.captions;
        const sharedPrefix = next.length >= previous.length && previous.every((caption, index) => {
            const candidate = next[index];
            return candidate
                && candidate.id === caption.id
                && candidate.startTime === caption.startTime
                && candidate.endTime === caption.endTime
                && candidate.text === caption.text;
        });
        if (!sharedPrefix) {
            captionChange = { captions: next, replace: true };
        } else if (next.length > previous.length) {
            captionChange = { captions: next.slice(previous.length), replace: false };
        }
    }

    Object.assign(task, patch, {
        revision: (task.revision || 0) + 1,
        updatedAt: new Date().toISOString()
    });
    broadcastTask(taskId, captionChange);
    void uploadManifestStore.persist(task).catch((error) => {
        console.warn(`[Task ${taskId}] 无法保存续传状态:`, error.message);
    });
    return task;
}

function assertTaskActive(task) {
    if (!task || task.cancelled || task.status === 'cancelled') {
        throw new TaskCancelledError();
    }
}

function removeFile(filePath) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
    } catch (error) {
        console.warn(`[Cleanup] 无法删除 ${filePath}:`, error.message);
    }
}

function scheduleTaskCleanup(taskId) {
    const currentTask = tasks.get(taskId);
    if (currentTask?.cleanupScheduled) return;
    if (currentTask) currentTask.cleanupScheduled = true;

    const timer = setTimeout(() => {
        const task = tasks.get(taskId);
        if (task) {
            task.processingAbortController?.abort(new TaskCancelledError());
            notifyUploadChanged(task);
            removeFile(task.filePath);
            removeFile(task.segmentDir);
        }
        tasks.delete(taskId);
        taskSubscribers.delete(taskId);
        void uploadManifestStore.remove(taskId).catch(() => undefined);
    }, TASK_TTL_MS);
    timer.unref?.();
}

function createTask({
    taskId = uuidv4(),
    filePath,
    fileName,
    mimeType,
    fileSize,
    uploadToken = uuidv4(),
    config = {},
    status = 'uploading',
    resumable = false,
    uploadComplete = status !== 'uploading'
}) {
    const now = new Date().toISOString();
    const task = {
        taskId,
        uploadToken,
        resumable,
        filePath,
        fileName,
        mimeType,
        totalBytes: fileSize,
        uploadedBytes: status === 'uploading' ? 0 : fileSize,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(fileSize / CHUNK_SIZE),
        receivedChunks: new Set(),
        activeChunks: new Set(),
        uploadComplete,
        processingQueued: false,
        processingStarted: false,
        processingAbortController: null,
        config,
        cancelled: false,
        status,
        progress: status === 'uploading' ? 0 : 20,
        stage: status === 'uploading' ? 'uploading' : 'queued',
        captions: [],
        error: null,
        revision: 0,
        decodedSeconds: 0,
        createdAt: now,
        updatedAt: now,
        segmentDir: null
    };
    if (resumable) attachUploadRuntime(task);
    tasks.set(taskId, task);
    return task;
}

function uploadedBytesForChunks(task, chunks) {
    let total = 0;
    for (const chunkIndex of chunks) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= task.totalChunks) continue;
        const start = chunkIndex * task.chunkSize;
        total += Math.min(task.chunkSize, task.totalBytes - start);
    }
    return total;
}

async function restoreUploadTasks() {
    const manifests = await uploadManifestStore.loadAll();
    for (const manifest of manifests) {
        try {
            const taskId = String(manifest.taskId || '');
            const filePath = path.resolve(String(manifest.filePath || ''));
            const uploadRoot = `${path.resolve(UPLOAD_DIR)}${path.sep}`;
            const totalBytes = Number(manifest.totalBytes);
            const stat = await fs.promises.stat(filePath);
            if (!taskId || !filePath.startsWith(uploadRoot) || !Number.isSafeInteger(totalBytes) || stat.size !== totalBytes) {
                throw new Error('manifest does not match its upload file');
            }

            const age = Date.now() - Date.parse(manifest.updatedAt || manifest.createdAt || 0);
            if (!Number.isFinite(age) || age > UPLOAD_IDLE_TIMEOUT_MS) {
                removeFile(filePath);
                await uploadManifestStore.remove(taskId);
                continue;
            }
            if (['completed', 'error', 'cancelled'].includes(manifest.status)) {
                removeFile(filePath);
                await uploadManifestStore.remove(taskId);
                continue;
            }

            const uploadComplete = Boolean(manifest.uploadComplete);
            const task = createTask({
                taskId,
                uploadToken: String(manifest.uploadToken || ''),
                filePath,
                fileName: path.basename(String(manifest.fileName || 'media')),
                mimeType: String(manifest.mimeType || 'application/octet-stream'),
                fileSize: totalBytes,
                status: uploadComplete ? 'processing' : 'uploading',
                uploadComplete,
                resumable: true,
                config: {
                    segmentStyle: String(manifest.config?.segmentStyle || 'natural'),
                    contextPrompt: String(manifest.config?.contextPrompt || '').slice(0, 4000),
                    uiLanguage: normalizeUiLanguage(manifest.config?.uiLanguage),
                    apiKey: null
                }
            });
            task.receivedChunks = new Set(
                (Array.isArray(manifest.receivedChunks) ? manifest.receivedChunks : [])
                    .filter((value) => Number.isInteger(value) && value >= 0 && value < task.totalChunks)
            );
            task.uploadedBytes = uploadedBytesForChunks(task, task.receivedChunks);
            task.uploadComplete = uploadComplete
                && task.receivedChunks.size === task.totalChunks
                && task.uploadedBytes === task.totalBytes;
            task.status = task.uploadComplete ? 'processing' : 'uploading';
            task.captions = Array.isArray(manifest.captions) ? manifest.captions : [];
            task.progress = Number(manifest.progress) || (task.uploadComplete ? 20 : 0);
            task.stage = task.uploadComplete ? 'queued' : 'uploading';
            task.revision = Number(manifest.revision) || 0;
            task.createdAt = manifest.createdAt || task.createdAt;
            task.updatedAt = manifest.updatedAt || task.updatedAt;
            console.log(`[Task ${taskId}] 已恢复上传会话，${task.receivedChunks.size}/${task.totalChunks} 个分片`);
        } catch (error) {
            console.warn('[Upload] 无法恢复上传会话:', error.message);
            if (manifest?.taskId) await uploadManifestStore.remove(String(manifest.taskId)).catch(() => undefined);
        }
    }
}

function drainProcessingQueue() {
    while (activeProcessingTasks < MAX_CONCURRENT_MEDIA_TASKS && processingQueue.length > 0) {
        const job = processingQueue.shift();
        const task = tasks.get(job.taskId);
        if (!task || task.cancelled || task.status === 'cancelled') continue;

        activeProcessingTasks++;
        Promise.resolve()
            .then(job.run)
            .catch((error) => {
                console.error(`[Task ${job.taskId}] 队列处理错误:`, error);
                const currentTask = tasks.get(job.taskId);
                if (currentTask && !['completed', 'error', 'cancelled'].includes(currentTask.status)) {
                    updateTask(job.taskId, { status: 'error', error: error.message || '转写失败。请重试。' });
                    removeFile(currentTask.filePath);
                    scheduleTaskCleanup(job.taskId);
                }
            })
            .finally(() => {
                activeProcessingTasks--;
                drainProcessingQueue();
            });
    }
}

function enqueueProcessing(taskId, run) {
    processingQueue.push({ taskId, run });
    drainProcessingQueue();
}

const abandonedUploadSweep = setInterval(() => {
    const now = Date.now();
    tasks.forEach((task, taskId) => {
        if (!task.resumable || task.uploadComplete || ['completed', 'error', 'cancelled'].includes(task.status)) return;
        if (now - Date.parse(task.updatedAt) < UPLOAD_IDLE_TIMEOUT_MS) return;

        task.cancelled = true;
        task.processingAbortController?.abort(new TaskCancelledError());
        notifyUploadChanged(task);
        task.config = {};
        updateTask(taskId, { status: 'cancelled', error: '上传已超时。请重新选择文件后重试。' });
        removeFile(task.filePath);
        scheduleTaskCleanup(taskId);
    });
}, 15 * 60 * 1000);
abandonedUploadSweep.unref?.();



/**
 * 从视频中提取音频
 */
function extractAudio(inputPath, outputPath, onProgress) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('64k')
            .audioFrequency(16000)
            .audioChannels(1)
            .output(outputPath)
            .on('progress', (progress) => {
                const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
                onProgress?.(percent);
                console.log(`[FFmpeg] 提取进度: ${percent}%`);
            })
            .on('end', () => {
                console.log('[FFmpeg] 音频提取完成');
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[FFmpeg] 错误:', err.message);
                reject(err);
            })
            .run();
    });
}

/** Normalize a small uploaded audio segment to an OpenAI-supported MP3. */
function normalizeAudioSegment(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('64k')
            .audioFrequency(16000)
            .audioChannels(1)
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .run();
    });
}

function probeAudioMetadata(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (error, metadata) => {
            if (error) reject(error);
            else resolve(metadata);
        });
    });
}

async function canUseUploadedTranscriptionProfile(file, requestedProfile) {
    if (requestedProfile !== STANDARD_MP3_PROFILE) return false;
    if (path.extname(file.originalname).toLowerCase() !== '.mp3') return false;
    try {
        const metadata = await probeAudioMetadata(file.path);
        return matchesStandardMp3Profile(metadata, file.size);
    } catch {
        return false;
    }
}

/**
 * 将音频分割成多个片段（每段最多 10 分钟）
 */
async function getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration || 0);
        });
    });
}

/**
 * 分割音频为多个片段
 */
function splitAudio(inputPath, outputDir, maxDuration = 600, onProgress, onSegment) {
    return new Promise(async (resolve, reject) => {
        try {
            const duration = await getAudioDuration(inputPath);
            const segments = [];
            const totalSegments = Math.ceil(duration / maxDuration);
            let start = 0;
            let index = 0;

            while (start < duration) {
                const segmentPath = path.join(outputDir, `segment_${index}.mp3`);
                const segmentDuration = Math.min(maxDuration, duration - start);

                await new Promise((res, rej) => {
                    ffmpeg(inputPath)
                        .setStartTime(start)
                        .duration(segmentDuration)
                        .audioCodec('libmp3lame')
                        .audioBitrate('64k')
                        .output(segmentPath)
                        .on('end', () => res())
                        .on('error', rej)
                        .run();
                });

                const segment = {
                    path: segmentPath,
                    startTime: start,
                    duration: segmentDuration
                };
                segments.push(segment);

                onProgress?.(Math.min(100, Math.round(((start + segmentDuration) / duration) * 100)));
                await onSegment?.(segment, { index, totalSegments });

                start += maxDuration;
                index++;
            }

            console.log(`[Split] 分割完成，共 ${segments.length} 个片段`);
            resolve(segments);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * 调用 Whisper API 转录
 */
/**
 * 调用 Whisper API 转录，并进行智能断句优化
 */
async function transcribeSegment(audioPath, startTimeOffset = 0, style = 'natural', userContext = '', userApiKey = null, uiLanguage = 'en') {
    const audioFile = fs.createReadStream(audioPath);

    const normalization = parseChineseNormalizationDirective(
        userContext,
        getDefaultChineseNormalizationMode(uiLanguage)
    );

    // 如果用户提供了自己的 Key，创建一个临时的 OpenAI 实例
    const client = userApiKey ? new OpenAI({ apiKey: userApiKey }) : openai;

    const response = await client.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment', 'word'],
        prompt: normalization.transcriptionPrompt || undefined
    });

    const normalizedSegments = normalizeWhisperSegments(response.segments || [], normalization.mode);
    const normalizedWords = (Array.isArray(response.words) ? response.words : []).map((word) => ({
        ...word,
        text: normalizeChineseText(String(word?.word || word?.text || ''), normalization.mode)
    }));
    const filteredSegments = filterWhisperSegments(normalizedSegments, (_segment, reason) => {
        console.warn(`[Whisper] 已过滤可疑片段 (${reason})`);
    });

    // 保留质量字段，供断句后的重复检测继续使用。
    const segments = filteredSegments.map(seg => ({
        start: seg.start + startTimeOffset,
        end: seg.end + startTimeOffset,
        text: seg.text.trim(),
        words: normalizedWords
            .filter((word) => word.start < seg.end + 0.05 && word.end > seg.start - 0.05)
            .map((word) => ({
                start: word.start + startTimeOffset,
                end: word.end + startTimeOffset,
                text: word.text
            })),
        no_speech_prob: seg.no_speech_prob,
        avg_logprob: seg.avg_logprob,
        compression_ratio: seg.compression_ratio
    }));

    return suppressRepeatedCaptions(segmentSubtitles(segments, style));
}

async function transcribeSegmentWithRetry(task, ...args) {
    const maxAttempts = 3;
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (task) assertTaskActive(task);
        try {
            return await transcribeSegment(...args);
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || error?.response?.status || 0);
            const retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
            if (!retryable || attempt === maxAttempts - 1) throw error;

            const delay = 1000 * (2 ** attempt);
            console.warn(`[Task ${task?.taskId || 'audio-segment'}] 转录请求失败，${delay}ms 后重试 (${attempt + 2}/${maxAttempts})`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * 语义感知智能切割长句
 * 中文：使用贪婪累加法 (Greedy Accumulator)
 * 英文：保持原有逻辑
 */
/**
 * 语义感知智能切割长句 (Unified Greedy Accumulator Strategy)
 * 统一策略：无论是中文还是英文，都使用贪婪累加法，严格控制字符上限。
 */
function smartSplit(segments, maxChars) {
    const result = [];

    // 核心参数配置
    // 英文/通用：32 (Max), 24 (Ideal)
    const DEFAULT_MAX = maxChars;
    const DEFAULT_IDEAL = Math.floor(maxChars * 0.75);

    // 中文：12 (Max), 10 (Ideal)
    const CN_MAX = 12;
    const CN_IDEAL = 10;

    const MIN_MERGE_LEN = 10;

    for (const seg of segments) {
        const text = seg.text;

        // 步骤 1: 预处理和切分 (Tokenize)
        const isChineseText = isChinese(text);

        // 动态配置
        const MAX_LINE_LEN = isChineseText ? CN_MAX : DEFAULT_MAX;
        const IDEAL_LEN = isChineseText ? CN_IDEAL : DEFAULT_IDEAL;

        let chunks = [];

        if (isChineseText) {
            // 中文切分逻辑
            const punctuation = /([。！？，、；：,.;:—])/;
            const rawChunks = text.split(punctuation).filter(s => s.length > 0);
            // 把标点符号合并回前一个文本块
            for (let i = 0; i < rawChunks.length; i++) {
                if (punctuation.test(rawChunks[i]) && chunks.length > 0) {
                    chunks[chunks.length - 1] += rawChunks[i];
                } else if (rawChunks[i].trim()) {
                    chunks.push(rawChunks[i].trim());
                }
            }
        } else {
            // 英文/通用切分逻辑：按单词切分
            chunks = text.split(/\s+/).filter(w => w.length > 0);
        }

        // 步骤 2: 贪婪累加法 (Greedy Accumulator)
        const finalLines = [];
        let buffer = "";

        for (let i = 0; i < chunks.length; i++) {
            const current = chunks[i];

            const separator = (buffer && !isChineseText) ? " " : "";
            const predictedLen = buffer.length + separator.length + current.length;

            if (!buffer) {
                buffer = current;
                continue;
            }

            // 预判 "爆杯"
            if (predictedLen > MAX_LINE_LEN) {
                finalLines.push(buffer);
                buffer = current;
                continue;
            }

            // 决策逻辑
            // A. 杯子水太少 -> 强制合并
            if (buffer.length < MIN_MERGE_LEN) {
                buffer += separator + current;
            }
            // B. 杯子已经差不多满 (IDEAL) 或 当前是句末 -> 结算
            else if (/[。！？.?!]$/.test(buffer) || buffer.length >= IDEAL_LEN) {
                finalLines.push(buffer);
                buffer = current;
            }
            // C. 还没爆 -> 继续装
            else {
                buffer += separator + current;
            }
        }

        if (buffer) finalLines.push(buffer);

        // 步骤 3: 分配时间戳
        const duration = seg.end - seg.start;
        const totalLen = finalLines.reduce((sum, line) => sum + line.length, 0);
        let runningStart = seg.start;

        for (let i = 0; i < finalLines.length; i++) {
            const line = finalLines[i];
            const ratio = totalLen > 0 ? (line.length / totalLen) : (1 / finalLines.length);
            const lineDuration = duration * ratio;

            const endTime = (i === finalLines.length - 1) ? seg.end : runningStart + lineDuration;

            result.push({
                ...seg,
                start: runningStart,
                end: endTime,
                text: line
            });
            runningStart = endTime;
        }
    }

    // 后处理：合并极短的片段 (Global Merge)
    const finalResult = [];
    for (let i = 0; i < result.length; i++) {
        let current = result[i];
        if (!current.text) continue;

        const next = result[i + 1];
        if (next) {
            const isAnyChinese = isChinese(current.text) || isChinese(next.text);
            const limit = isAnyChinese ? CN_MAX : DEFAULT_MAX;

            const separator = (isChinese(current.text) || isChinese(next.text)) ? "" : " ";
            const mergedLen = current.text.length + separator.length + next.text.length;

            if (mergedLen <= limit && !/[。！？.?!]$/.test(current.text)) {
                current.end = next.end;
                current.text = current.text + separator + next.text;
                i++;
            }
        }
        finalResult.push(current);
    }
    return finalResult;
}

// 辅助函数
function isChinese(str) {
    return /[\u4e00-\u9fa5]/.test(str);
}

/**
 * 辅助：将 SRT 时间戳转为秒数
 */
function parseFormattedTimestamp(ts) {
    const [hms, ms] = ts.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000);
}

/**
 * 格式化时间戳为 SRT 格式
 */
function formatTimestamp(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function isSupportedMedia(fileName, mimeType) {
    const extension = path.extname(fileName).toLowerCase();
    return mimeType.startsWith('video/') || mimeType.startsWith('audio/') || SUPPORTED_EXTENSIONS.has(extension);
}

function normalizeUiLanguage(value) {
    return ['zh', 'zh-TW', 'en'].includes(value) ? value : 'en';
}

function buildCaptions(segments) {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const uniqueSegments = [];

    for (const segment of sorted) {
        const last = uniqueSegments[uniqueSegments.length - 1];
        if (!last || segment.start >= last.end - 0.5) {
            uniqueSegments.push(segment);
        }
    }

    return uniqueSegments.map((segment, index) => ({
        id: index,
        startTime: formatTimestamp(segment.start),
        endTime: formatTimestamp(segment.end),
        text: segment.text
    }));
}

function serializeUploadSession(task, resumed = false) {
    return {
        taskId: task.taskId,
        uploadToken: task.uploadToken,
        chunkSize: task.chunkSize,
        totalChunks: task.totalChunks,
        receivedChunks: [...task.receivedChunks].sort((a, b) => a - b),
        uploadedBytes: task.uploadedBytes,
        uploadComplete: Boolean(task.uploadComplete),
        status: task.status,
        resumed
    };
}

// ==================== API 路由 ====================

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        features: {
            audioTrackSegments: true,
            audioTrackContainers: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'mpeg-ts'],
            audioTrackCodecs: ['aac-lc', 'linear-pcm', 'mp3', 'opus', 'vorbis', 'flac'],
            resumableStreamingUpload: true,
            incrementalCaptionEvents: true
        }
    });
});

/** Validate BYOK credentials server-side so no provider SDK or project key is bundled in the browser. */
app.post('/api/keys/validate', async (req, res) => {
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 512) return res.json({ valid: false });

    try {
        const client = new OpenAI({ apiKey, timeout: 10_000, maxRetries: 0 });
        await client.models.list();
        return res.json({ valid: true });
    } catch (error) {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) return res.json({ valid: false });
        console.warn(`[API key validation] Provider request failed with status ${status || 'unknown'}`);
        return res.status(503).json({ valid: false });
    }
});

const sendInternalMediaHeaders = (req, res, task) => {
    if (String(req.query.token || '') !== task.uploadToken) {
        res.status(403).end();
        return null;
    }
    const range = parseByteRange(req.get('Range'), task.totalBytes);
    if (!range) {
        res.status(416).set('Content-Range', `bytes */${task.totalBytes}`).end();
        return null;
    }

    res.status(range.partial ? 206 : 200);
    res.set({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Type': task.mimeType || 'application/octet-stream',
        'Content-Length': String(range.end - range.start + 1)
    });
    if (range.partial) {
        res.set('Content-Range', `bytes ${range.start}-${range.end}/${task.totalBytes}`);
    }
    return range;
};

/** FFmpeg reads this private endpoint as a seekable file while chunks arrive. */
app.head('/api/internal/media/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task?.resumable) return res.status(404).end();
    const range = sendInternalMediaHeaders(req, res, task);
    if (range) res.end();
});

app.get('/api/internal/media/:taskId', async (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task?.resumable) return res.status(404).end();
    const range = sendInternalMediaHeaders(req, res, task);
    if (!range) return;

    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) controller.abort(new TaskCancelledError());
    });
    res.flushHeaders?.();

    try {
        await streamUploadedRange(task, range.start, range.end, res, controller.signal);
        if (!res.writableEnded) res.end();
    } catch (error) {
        if (!controller.signal.aborted) {
            console.warn(`[Task ${task.taskId}] 媒体 Range 读取中断:`, error.message);
        }
        if (!res.writableEnded) res.destroy();
    }
});

// 托管前端静态文件
// 注意：Docker 构建中，我们将 frontend dist 放在 server 的上一级或同级，这里假设 dist 在 ../dist
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    console.log('📦 Serving frontend from:', distPath);
    app.use(express.static(distPath));
}

/**
 * 创建分片上传任务。服务端预分配目标文件，后续分片直接写入各自偏移量。
 */
app.post('/api/uploads', async (req, res, next) => {
    try {
        const {
            fileName,
            fileSize,
            mimeType = 'application/octet-stream',
            segmentStyle = 'natural',
            contextPrompt = '',
            uiLanguage = 'en',
            apiKey = null,
            resumeTaskId = null,
            uploadToken = null
        } = req.body || {};

        const safeFileName = path.basename(String(fileName || '')).slice(0, 255);
        const normalizedSize = Number(fileSize);
        if (!safeFileName || !Number.isSafeInteger(normalizedSize) || normalizedSize <= 0) {
            return res.status(400).json({ error: '无法读取文件信息。请重新选择文件。' });
        }
        if (normalizedSize > MAX_FILE_SIZE) {
            return res.status(413).json({ error: '文件超过 20 GB，无法上传。' });
        }
        if (!isSupportedMedia(safeFileName, String(mimeType))) {
            return res.status(415).json({ error: '不支持此文件格式。请选择音频或视频文件。' });
        }

        if (resumeTaskId) {
            const existingTask = tasks.get(String(resumeTaskId));
            if (!existingTask || !existingTask.resumable) {
                return res.status(404).json({ error: '续传会话已失效，请重新开始上传。' });
            }
            if (String(uploadToken || '') !== existingTask.uploadToken) {
                return res.status(403).json({ error: '续传会话验证失败，请重新开始上传。' });
            }
            if (
                existingTask.status === 'completed'
                && existingTask.fileName === safeFileName
                && existingTask.totalBytes === normalizedSize
            ) {
                return res.json(serializeUploadSession(existingTask, true));
            }
            if (
                existingTask.fileName !== safeFileName
                || existingTask.totalBytes !== normalizedSize
                || ['error', 'cancelled'].includes(existingTask.status)
            ) {
                return res.status(409).json({ error: '续传文件与原上传任务不一致，请重新开始上传。' });
            }

            existingTask.config = {
                segmentStyle: String(segmentStyle).slice(0, 32),
                contextPrompt: String(contextPrompt).slice(0, 4000),
                uiLanguage: normalizeUiLanguage(uiLanguage),
                apiKey: apiKey ? String(apiKey) : null
            };
            existingTask.updatedAt = new Date().toISOString();
            await uploadManifestStore.persist(existingTask);
            if (existingTask.receivedChunks.has(0)) ensureStreamingProcessing(existingTask);
            return res.json(serializeUploadSession(existingTask, true));
        }

        const taskId = uuidv4();
        const extension = path.extname(safeFileName).toLowerCase() || '.media';
        const filePath = path.join(UPLOAD_DIR, `${taskId}${extension}`);
        const handle = await fs.promises.open(filePath, 'w');
        try {
            await handle.truncate(normalizedSize);
        } finally {
            await handle.close();
        }

        const task = createTask({
            taskId,
            filePath,
            fileName: safeFileName,
            mimeType: String(mimeType),
            fileSize: normalizedSize,
            resumable: true,
            config: {
                segmentStyle: String(segmentStyle).slice(0, 32),
                contextPrompt: String(contextPrompt).slice(0, 4000),
                uiLanguage: normalizeUiLanguage(uiLanguage),
                apiKey: apiKey ? String(apiKey) : null
            }
        });

        console.log(`[Task ${taskId}] 创建上传任务: ${safeFileName}, ${normalizedSize} bytes`);
        await uploadManifestStore.persist(task);
        res.status(201).json(serializeUploadSession(task));
    } catch (error) {
        next(error);
    }
});

/**
 * 接收单个原始二进制分片。并发分片写入互不重叠的文件区间。
 */
app.put('/api/uploads/:taskId/chunks/:chunkIndex', async (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务已失效。请重新开始。' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传会话已失效。请重新开始。' });
    }
    if (task.uploadComplete || ['completed', 'error', 'cancelled'].includes(task.status)) {
        return res.status(409).json({ error: '当前任务不再接受上传。' });
    }

    const chunkIndex = Number(req.params.chunkIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= task.totalChunks) {
        return res.status(400).json({ error: '上传数据无效。请重试。' });
    }
    if (task.receivedChunks.has(chunkIndex)) {
        return res.json({ received: true, chunkIndex, uploadedBytes: task.uploadedBytes });
    }
    if (task.activeChunks.has(chunkIndex)) {
        return res.status(409).json({ error: '部分数据正在重复上传，请稍后重试。' });
    }

    const start = chunkIndex * task.chunkSize;
    const expectedSize = Math.min(task.chunkSize, task.totalBytes - start);
    const expectedRange = `bytes ${start}-${start + expectedSize - 1}/${task.totalBytes}`;
    const contentLength = Number(req.get('Content-Length'));
    if (req.get('Content-Range') !== expectedRange || contentLength !== expectedSize) {
        return res.status(400).json({ error: '上传数据不完整。请重试。' });
    }

    task.activeChunks.add(chunkIndex);
    let receivedBytes = 0;
    const limiter = new Transform({
        transform(chunk, encoding, callback) {
            receivedBytes += chunk.length;
            if (receivedBytes > expectedSize) {
                callback(new Error('分片数据超过声明大小'));
                return;
            }
            callback(null, chunk);
        }
    });

    try {
        await pipeline(
            req,
            limiter,
            fs.createWriteStream(task.filePath, { flags: 'r+', start })
        );
        if (receivedBytes !== expectedSize) {
            throw new Error('上传数据不完整。请重试。');
        }

        task.receivedChunks.add(chunkIndex);
        task.uploadedBytes += expectedSize;
        notifyUploadChanged(task);
        const uploadRatio = task.uploadedBytes / task.totalBytes;
        updateTask(task.taskId, {
            progress: task.processingQueued || task.processingStarted
                ? Math.max(task.progress, Math.min(80, 20 + Math.round(uploadRatio * 60)))
                : Math.min(20, Math.round(uploadRatio * 20))
        });
        await uploadManifestStore.persist(task);
        if (task.receivedChunks.has(0)) ensureStreamingProcessing(task);
        res.json({ received: true, chunkIndex, uploadedBytes: task.uploadedBytes });
    } catch (error) {
        if (!res.headersSent) res.status(400).json({ error: error.message || '文件上传失败。请检查网络后重试。' });
    } finally {
        task.activeChunks.delete(chunkIndex);
    }
});

/** 标记上传完整；流式媒体处理通常已经在首个分片到达后启动。 */
app.post('/api/uploads/:taskId/complete', async (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务已失效。请重新开始。' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传会话已失效。请重新开始。' });
    }
    if (task.status === 'completed') {
        return res.status(202).json({ taskId: task.taskId, status: task.status });
    }
    if (['error', 'cancelled'].includes(task.status)) {
        return res.status(409).json({ error: task.error || '无法开始转写。请重试。' });
    }
    if (task.uploadComplete) {
        if (req.body?.apiKey) task.config.apiKey = String(req.body.apiKey);
        ensureStreamingProcessing(task);
        return res.status(202).json({ taskId: task.taskId, status: task.status });
    }
    if (task.receivedChunks.size !== task.totalChunks || task.uploadedBytes !== task.totalBytes) {
        return res.status(409).json({
            error: '文件上传未完成。请重试。',
            receivedChunks: task.receivedChunks.size,
            totalChunks: task.totalChunks
        });
    }

    task.config.apiKey = req.body?.apiKey ? String(req.body.apiKey) : null;
    task.uploadComplete = true;
    notifyUploadChanged(task);
    updateTask(task.taskId, {
        status: 'processing',
        stage: task.processingStarted ? 'transcribing' : 'queued',
        progress: Math.max(task.progress, 82)
    });
    await uploadManifestStore.persist(task);
    ensureStreamingProcessing(task);
    res.status(202).json({ taskId: task.taskId, status: 'processing' });
});

/**
 * Stateless audio-first fast path. The browser sends one bounded audio segment
 * extracted from the local container; this request returns timestamped captions
 * without storing a multi-GB video or task session.
 */
app.post('/api/audio-segments/transcribe', uploadAudioSegment, async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: '无法读取音频片段。' });

    const requestId = uuidv4();
    const normalizedPath = path.join(OUTPUT_DIR, `${requestId}.mp3`);
    const startTime = Number(req.body.startTime || 0);
    const segmentStyle = ['compact', 'natural', 'detailed'].includes(req.body.segmentStyle)
        ? req.body.segmentStyle
        : 'natural';
    const contextPrompt = String(req.body.contextPrompt || '').slice(0, 4000);
    const apiKey = req.body.apiKey ? String(req.body.apiKey) : null;
    const uiLanguage = normalizeUiLanguage(req.body.uiLanguage);
    const requestedAudioProfile = String(req.body.audioProfile || '');

    if (!Number.isFinite(startTime) || startTime < 0) {
        removeFile(req.file.path);
        return res.status(400).json({ error: '音频片段信息无效。' });
    }

    try {
        const useUploadedAudio = await canUseUploadedTranscriptionProfile(req.file, requestedAudioProfile);
        const transcriptionPath = useUploadedAudio ? req.file.path : normalizedPath;
        if (!useUploadedAudio) await normalizeAudioSegment(req.file.path, normalizedPath);
        const normalizedSize = fs.statSync(transcriptionPath).size;
        if (normalizedSize >= 25 * 1024 * 1024) {
            throw new Error('音频片段过大，无法转写。');
        }

        const segments = await transcribeSegmentWithRetry(
            null,
            transcriptionPath,
            startTime,
            segmentStyle,
            contextPrompt,
            apiKey,
            uiLanguage
        );
        const captions = buildCaptions(segments);

        res.json({
            captions,
            uploadedBytes: req.file.size,
            normalizedBytes: normalizedSize,
            normalizationSkipped: useUploadedAudio
        });
    } catch (error) {
        next(error);
    } finally {
        removeFile(req.file.path);
        removeFile(normalizedPath);
    }
});

/** 取消上传或处理任务。 */
app.post('/api/task/:taskId/cancel', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务已失效。请重新开始。' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传会话已失效。请重新开始。' });
    }

    task.cancelled = true;
    task.processingAbortController?.abort(new TaskCancelledError());
    notifyUploadChanged(task);
    task.config = {};
    updateTask(task.taskId, {
        status: 'cancelled',
        stage: task.stage,
        error: '任务已取消。'
    });
    if (!task.processingStarted || task.stage === 'queued') removeFile(task.filePath);
    scheduleTaskCleanup(task.taskId);
    res.json({ taskId: task.taskId, status: 'cancelled' });
});

/**
 * 上传并处理视频
 */
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    const taskId = uuidv4();

    if (!req.file) {
        return res.status(400).json({ error: '请选择要转写的文件。' });
    }

    console.log(`[Task ${taskId}] 开始处理: ${req.file.originalname}`);

    createTask({
        taskId,
        filePath: req.file.path,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        status: 'processing',
        config: {
            segmentStyle: req.body.segmentStyle || 'natural',
            contextPrompt: req.body.contextPrompt || '',
            uiLanguage: normalizeUiLanguage(req.body.uiLanguage),
            apiKey: req.body.apiKey || null
        }
    });

    // 立即返回任务 ID
    res.json({ taskId, message: '转写任务已创建' });

    // 后台处理
    enqueueProcessing(taskId, () => processFile(taskId, req.file.path, req.file.mimetype, req.body.segmentStyle || 'natural', req.body.contextPrompt || '', req.body.apiKey || null, normalizeUiLanguage(req.body.uiLanguage)));
});

function ensureStreamingProcessing(task) {
    if (
        !task?.resumable
        || task.processingQueued
        || task.processingStarted
        || task.cancelled
        || ['completed', 'error', 'cancelled'].includes(task.status)
        || (!task.receivedChunks.has(0) && !task.uploadComplete)
    ) return;
    if (!task.config?.apiKey && !process.env.OPENAI_API_KEY) return;

    task.processingQueued = true;
    updateTask(task.taskId, {
        status: 'processing',
        stage: 'queued',
        progress: Math.max(task.progress, 20)
    });
    enqueueProcessing(task.taskId, () => processStreamingUpload(task.taskId));
}

async function processStreamingUpload(taskId) {
    const task = tasks.get(taskId);
    if (!task) return;

    const controller = new AbortController();
    task.processingQueued = false;
    task.processingStarted = true;
    task.processingAbortController = controller;
    const segmentDir = path.join(OUTPUT_DIR, `${taskId}-stream`);
    task.segmentDir = segmentDir;
    fs.mkdirSync(segmentDir, { recursive: true });

    const segmentTarget = Math.max(20, Math.min(90, Number(process.env.STREAMING_SEGMENT_SECONDS || 35)));
    const segmentMaximum = Math.max(segmentTarget + 5, Math.min(120, Number(process.env.STREAMING_SEGMENT_MAX_SECONDS || 50)));
    const silenceThreshold = Math.max(50, Math.min(4000, Number(process.env.STREAMING_SILENCE_THRESHOLD || 160)));
    const inputUrl = `${internalServerOrigin}/api/internal/media/${encodeURIComponent(taskId)}?token=${encodeURIComponent(task.uploadToken)}`;
    const { segmentStyle, contextPrompt, uiLanguage, apiKey } = task.config;
    const transcriptionJobs = [];
    const activeTranscriptions = new Set();
    const completedByIndex = new Map();
    let nextSegmentIndex = 0;
    let nextCommitIndex = 0;
    let speechSegmentCount = 0;
    let allSegments = [];

    const waitForTranscriptionSlot = async () => {
        while (activeTranscriptions.size >= MAX_STREAMING_TRANSCRIPTIONS) {
            const result = await Promise.race(activeTranscriptions);
            if (!result.ok) throw result.error;
        }
    };

    const commitCompletedSegments = () => {
        while (completedByIndex.has(nextCommitIndex)) {
            const result = completedByIndex.get(nextCommitIndex);
            completedByIndex.delete(nextCommitIndex);
            nextCommitIndex++;
            allSegments.push(...result);
            allSegments.sort((a, b) => a.start - b.start);
            const captions = buildCaptions(suppressRepeatedCaptions(allSegments));
            const uploadRatio = task.totalBytes > 0 ? task.uploadedBytes / task.totalBytes : 0;
            const progress = Math.min(95, Math.max(task.progress, 24 + Math.round(uploadRatio * 58)));
            updateTask(taskId, {
                status: 'processing',
                stage: 'transcribing',
                progress,
                captions
            });
        }
    };

    const scheduleTranscription = async (segment) => {
        assertTaskActive(task);
        if (!segment.hasSpeech || segment.pcm.length === 0) return;
        await waitForTranscriptionSlot();
        assertTaskActive(task);

        const segmentIndex = nextSegmentIndex++;
        speechSegmentCount++;
        const segmentPath = path.join(segmentDir, `segment_${String(segmentIndex).padStart(6, '0')}.wav`);
        await fs.promises.writeFile(segmentPath, createWavBuffer(segment.pcm));

        const transcription = (async () => {
            try {
                const result = await transcribeSegmentWithRetry(
                    task,
                    segmentPath,
                    segment.startTime,
                    segmentStyle,
                    contextPrompt,
                    apiKey,
                    uiLanguage
                );
                assertTaskActive(task);
                completedByIndex.set(segmentIndex, result);
                commitCompletedSegments();
            } finally {
                removeFile(segmentPath);
            }
        })();
        void transcription.catch(() => undefined);
        transcriptionJobs.push(transcription);

        const completion = transcription.then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error })
        );
        activeTranscriptions.add(completion);
        void completion.finally(() => activeTranscriptions.delete(completion));
    };

    try {
        updateTask(taskId, {
            status: 'processing',
            stage: 'streaming',
            progress: Math.max(task.progress, 21),
            captions: []
        });

        await decodeMediaToSpeechSegments({
            inputUrl,
            signal: controller.signal,
            segmentOptions: {
                targetDuration: segmentTarget,
                maxDuration: segmentMaximum,
                silenceThreshold
            },
            onSegment: scheduleTranscription,
            onDecodedTime: (decodedSeconds) => {
                task.decodedSeconds = Math.max(task.decodedSeconds || 0, decodedSeconds);
            }
        });

        const transcriptionResults = await Promise.allSettled(transcriptionJobs);
        const failed = transcriptionResults.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        assertTaskActive(task);
        commitCompletedSegments();
        if (speechSegmentCount === 0) {
            throw new Error('未检测到可转写的音频。请检查文件是否包含声音。');
        }

        task.uploadComplete = true;
        const finalCaptions = buildCaptions(suppressRepeatedCaptions(allSegments));
        updateTask(taskId, {
            captions: finalCaptions,
            status: 'completed',
            progress: 100,
            stage: 'done'
        });
        console.log(`[Task ${taskId}] 流式转写完成，共 ${finalCaptions.length} 条字幕`);
    } catch (error) {
        controller.abort(error);
        await Promise.allSettled(transcriptionJobs);
        if (error instanceof TaskCancelledError || error?.name === 'AbortError' || task.cancelled) {
            if (task.status !== 'cancelled') {
                updateTask(taskId, { status: 'cancelled', error: '任务已取消。' });
            }
        } else {
            console.error(`[Task ${taskId}] 流式处理错误:`, error);
            updateTask(taskId, {
                status: 'error',
                error: error.message || '转写失败。请重试。'
            });
        }
    } finally {
        controller.abort(new TaskCancelledError());
        task.processingAbortController = null;
        task.config.apiKey = null;
        notifyUploadChanged(task);
        removeFile(task.segmentDir);
        task.segmentDir = null;
        removeFile(task.filePath);
        scheduleTaskCleanup(taskId);
    }
}

/**
 * 后台处理文件
 */
async function processFile(taskId, filePath, mimeType, segmentStyle, contextPrompt, userApiKey, uiLanguage = 'en') {
    const task = tasks.get(taskId);
    const ext = path.extname(filePath).toLowerCase();
    const isAudio = mimeType.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext);
    const isVideo = !isAudio;
    let audioPath = filePath;

    try {
        assertTaskActive(task);

        // 1. 如果是视频，提取音频
        if (isVideo) {
            audioPath = path.join(OUTPUT_DIR, `${taskId}.mp3`);
            updateTask(taskId, { stage: 'extracting', progress: 22 });

            let lastProgress = -1;
            await extractAudio(filePath, audioPath, (percent) => {
                const progress = 22 + Math.round(percent * 0.18);
                if (progress !== lastProgress && !task.cancelled) {
                    lastProgress = progress;
                    updateTask(taskId, { stage: 'extracting', progress });
                }
            });

            assertTaskActive(task);
            updateTask(taskId, { stage: 'extracting', progress: 40 });
        } else {
            updateTask(taskId, { stage: 'queued', progress: 40 });
        }

        // 2. 检查文件大小，决定是否需要分割
        const stats = fs.statSync(audioPath);
        const fileSizeMB = stats.size / (1024 * 1024);

        let allSegments = [];

        if (fileSizeMB > 24) {
            const segmentDir = path.join(OUTPUT_DIR, taskId);
            fs.mkdirSync(segmentDir, { recursive: true });
            task.segmentDir = segmentDir;
            updateTask(taskId, { stage: 'splitting', progress: 42 });

            const concurrency = 3;
            const activeTranscriptions = new Set();
            const transcriptionJobs = [];
            let completedSegments = 0;
            let audioSegments = [];
            let splitError = null;

            const startTranscription = async (segment, { totalSegments }) => {
                while (activeTranscriptions.size >= concurrency) {
                    const result = await Promise.race(activeTranscriptions);
                    if (!result.ok) throw result.error;
                }

                assertTaskActive(task);
                if (task.stage !== 'transcribing') {
                    updateTask(taskId, { stage: 'transcribing', progress: Math.max(50, task.progress) });
                }

                const transcription = (async () => {
                    try {
                        const result = await transcribeSegmentWithRetry(
                            task,
                            segment.path,
                            segment.startTime,
                            segmentStyle,
                            contextPrompt,
                            userApiKey,
                            uiLanguage
                        );
                        assertTaskActive(task);
                        allSegments.push(...result);
                        completedSegments++;
                        const progress = 50 + Math.round((completedSegments / totalSegments) * 45);
                        updateTask(taskId, {
                            stage: 'transcribing',
                            progress,
                            captions: buildCaptions(allSegments)
                        });
                        console.log(`[Task ${taskId}] 转录进度: ${progress}%`);
                    } finally {
                        removeFile(segment.path);
                    }
                })();

                // Attach a rejection handler immediately; the aggregate result is checked below.
                void transcription.catch(() => undefined);
                transcriptionJobs.push(transcription);
                const signal = transcription.then(
                    () => ({ ok: true }),
                    (error) => ({ ok: false, error })
                );
                activeTranscriptions.add(signal);
                void signal.finally(() => activeTranscriptions.delete(signal));
            };

            try {
                audioSegments = await splitAudio(audioPath, segmentDir, 600, (percent) => {
                    if (!task.cancelled && task.stage === 'splitting') {
                        updateTask(taskId, {
                            stage: 'splitting',
                            progress: 42 + Math.round(percent * 0.08)
                        });
                    }
                }, startTranscription);
            } catch (error) {
                splitError = error;
            }

            const transcriptionResults = await Promise.allSettled(transcriptionJobs);
            if (splitError) throw splitError;
            const failedTranscription = transcriptionResults.find((result) => result.status === 'rejected');
            if (failedTranscription?.status === 'rejected') throw failedTranscription.reason;
            assertTaskActive(task);
            if (audioSegments.length === 0) throw new Error('未检测到可转写的音频。请检查文件是否包含声音。');

            removeFile(segmentDir);
            task.segmentDir = null;
        } else {
            // 直接转录
            updateTask(taskId, { stage: 'transcribing', progress: 50 });
            allSegments = await transcribeSegmentWithRetry(task, audioPath, 0, segmentStyle, contextPrompt, userApiKey, uiLanguage);
            assertTaskActive(task);
        updateTask(taskId, {
            stage: 'transcribing',
            progress: 95,
            captions: buildCaptions(allSegments)
        });
        }

        assertTaskActive(task);
        const finalCaptions = buildCaptions(allSegments);
        updateTask(taskId, {
            captions: finalCaptions,
            status: 'completed',
            progress: 100,
            stage: 'done'
        });

        console.log(`[Task ${taskId}] 完成，共 ${task.captions.length} 条字幕`);

    } catch (error) {
        if (error instanceof TaskCancelledError || task?.cancelled) {
            if (task && task.status !== 'cancelled') {
                updateTask(taskId, { status: 'cancelled', error: '任务已取消。' });
            }
        } else {
            console.error(`[Task ${taskId}] 错误:`, error);
            updateTask(taskId, { status: 'error', error: error.message || '转写失败。请重试。' });
        }
    } finally {
        removeFile(task?.segmentDir);
        removeFile(filePath);
        if (audioPath !== filePath) removeFile(audioPath);
        if (task) task.config = {};
        scheduleTaskCleanup(taskId);
    }
}

/**
 * 查询任务状态
 */
app.get('/api/task/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);

    if (!task) {
        return res.status(404).json({ error: '任务已失效。请重新开始。' });
    }

    res.json(serializeTask(task));
});

/**
 * 获取任务结果（SSE 流式）
 */
app.get('/api/task/:taskId/stream', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务已失效。请重新开始。' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');
    writeSse(res, 'snapshot', serializeTask(task), task.revision);

    if (['completed', 'error', 'cancelled'].includes(task.status)) {
        res.end();
        return;
    }

    const subscribers = taskSubscribers.get(taskId) || new Set();
    subscribers.add(res);
    taskSubscribers.set(taskId, subscribers);

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => {
        clearInterval(heartbeat);
        subscribers.delete(res);
        if (subscribers.size === 0) taskSubscribers.delete(taskId);
    });
});

// 所有其他未匹配的路由，返回 React 前端应用的 index.html (SPA 支持)
if (fs.existsSync(distPath)) {
    app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// 错误处理中间件
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件超过 20 GB，无法上传。' });
        }
        return res.status(400).json({ error: '文件上传失败。请检查网络后重试。' });
    }
    if (err) {
        return res.status(500).json({ error: '转写服务出现问题。请稍后重试。' });
    }
    next();
});

// 启动服务器
await restoreUploadTasks();
const httpServer = app.listen(PORT, '0.0.0.0', () => {
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : PORT;
    if (!process.env.INTERNAL_MEDIA_ORIGIN) {
        internalServerOrigin = `http://127.0.0.1:${actualPort}`;
    }
    console.log(`🚀 Caption Server 运行在端口: ${actualPort}`);
    console.log(`🔗 外部访问请确保监听 0.0.0.0`);
    console.log(`📁 上传目录: ${UPLOAD_DIR}`);
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);

    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️  未设置 OPENAI_API_KEY 环境变量');
    }
});
