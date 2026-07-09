import 'dotenv/config';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const configuredChunkSizeMb = Number(process.env.UPLOAD_CHUNK_SIZE_MB || 8);
const CHUNK_SIZE = Math.max(1, Math.min(64, configuredChunkSizeMb)) * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024;
const MAX_CONCURRENT_MEDIA_TASKS = Math.max(1, Math.min(8, Number(process.env.MEDIA_PROCESSING_CONCURRENCY || 2)));
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

// 初始化 Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
            cb(new Error('只支持音视频文件'));
        }
    }
});

// 存储任务状态
const tasks = new Map();
const taskSubscribers = new Map();
const processingQueue = [];
let activeProcessingTasks = 0;

class TaskCancelledError extends Error {
    constructor() {
        super('任务已取消');
        this.name = 'TaskCancelledError';
    }
}

function serializeTask(task) {
    return {
        status: task.status,
        progress: task.progress,
        stage: task.stage,
        captions: task.captions,
        error: task.error,
        uploadedBytes: task.uploadedBytes,
        totalBytes: task.totalBytes,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
    };
}

function broadcastTask(taskId) {
    const task = tasks.get(taskId);
    const subscribers = taskSubscribers.get(taskId);
    if (!task || !subscribers) return;

    const payload = `data: ${JSON.stringify(serializeTask(task))}\n\n`;
    subscribers.forEach((response) => response.write(payload));

    if (['completed', 'error', 'cancelled'].includes(task.status)) {
        subscribers.forEach((response) => response.end());
        taskSubscribers.delete(taskId);
    }
}

function updateTask(taskId, patch) {
    const task = tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    broadcastTask(taskId);
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
            removeFile(task.filePath);
            removeFile(task.segmentDir);
        }
        tasks.delete(taskId);
        taskSubscribers.delete(taskId);
    }, TASK_TTL_MS);
    timer.unref?.();
}

function createTask({ taskId = uuidv4(), filePath, fileName, mimeType, fileSize, uploadToken = uuidv4(), config = {}, status = 'uploading' }) {
    const now = new Date().toISOString();
    const task = {
        taskId,
        uploadToken,
        filePath,
        fileName,
        mimeType,
        totalBytes: fileSize,
        uploadedBytes: status === 'uploading' ? 0 : fileSize,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(fileSize / CHUNK_SIZE),
        receivedChunks: new Set(),
        activeChunks: new Set(),
        config,
        cancelled: false,
        status,
        progress: status === 'uploading' ? 0 : 20,
        stage: status === 'uploading' ? 'uploading' : 'queued',
        captions: [],
        error: null,
        createdAt: now,
        updatedAt: now,
        segmentDir: null
    };
    tasks.set(taskId, task);
    return task;
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
                    updateTask(job.taskId, { status: 'error', error: error.message || '处理失败' });
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
        if (task.status !== 'uploading') return;
        if (now - Date.parse(task.updatedAt) < UPLOAD_IDLE_TIMEOUT_MS) return;

        task.cancelled = true;
        task.config = {};
        updateTask(taskId, { status: 'cancelled', error: '上传超时，任务已清理' });
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
async function transcribeSegment(audioPath, startTimeOffset = 0, style = 'natural', userContext = '', userApiKey = null) {
    const audioFile = fs.createReadStream(audioPath);

    // 仅使用用户提供的 Context，移除原本的 Style Prompt
    const fullPrompt = userContext || "";

    // 如果用户提供了自己的 Key，创建一个临时的 OpenAI 实例
    const client = userApiKey ? new OpenAI({ apiKey: userApiKey }) : openai;

    const response = await client.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
        prompt: fullPrompt
    });

    // 1. 调整时间戳
    let segments = (response.segments || []).map(seg => ({
        start: seg.start + startTimeOffset,
        end: seg.end + startTimeOffset,
        text: seg.text.trim()
    }));

    // 2. 智能二次切割 (强制 42 字符上限)
    const maxChars = 42;
    return smartSplit(segments, maxChars);
}

async function transcribeSegmentWithRetry(task, ...args) {
    const maxAttempts = 3;
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        assertTaskActive(task);
        try {
            return await transcribeSegment(...args);
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || error?.response?.status || 0);
            const retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
            if (!retryable || attempt === maxAttempts - 1) throw error;

            const delay = 1000 * (2 ** attempt);
            console.warn(`[Task ${task.taskId}] 转录请求失败，${delay}ms 后重试 (${attempt + 2}/${maxAttempts})`);
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

async function translateCaptions(task, captions, targetLanguage, mode, userApiKey) {
    if (mode === 'Original' || captions.length === 0) return captions;
    const client = userApiKey ? new OpenAI({ apiKey: userApiKey }) : openai;
    const response = await client.chat.completions.create({
        model: process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: `Translate each subtitle into ${targetLanguage}. Return JSON exactly as {"translations":["..."]}; preserve order and do not add commentary.` },
            { role: 'user', content: JSON.stringify(captions.map((caption) => caption.text)) }
        ]
    });
    assertTaskActive(task);
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"translations":[]}');
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
    if (mode === 'Translation') {
        return captions.map((caption, index) => ({ ...caption, text: String(translations[index] || '') }));
    }
    return captions.map((caption, index) => ({
        ...caption,
        text: `${caption.text}\n${String(translations[index] || '')}`
    }));
}

// ==================== API 路由 ====================

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
            contextPrompt = ''
        } = req.body || {};

        const safeFileName = path.basename(String(fileName || '')).slice(0, 255);
        const normalizedSize = Number(fileSize);
        if (!safeFileName || !Number.isSafeInteger(normalizedSize) || normalizedSize <= 0) {
            return res.status(400).json({ error: '文件信息无效' });
        }
        if (normalizedSize > MAX_FILE_SIZE) {
            return res.status(413).json({ error: '文件太大，超过了 20GB 的限制' });
        }
        if (!isSupportedMedia(safeFileName, String(mimeType))) {
            return res.status(415).json({ error: '只支持音视频文件' });
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
            config: {
                segmentStyle: String(segmentStyle).slice(0, 32),
                contextPrompt: String(contextPrompt).slice(0, 4000),
                targetLanguage: String(req.body.targetLanguage || 'English').slice(0, 64),
                captionMode: ['Original', 'Translation', 'Bilingual'].includes(req.body.captionMode)
                    ? req.body.captionMode
                    : 'Original',
                apiKey: null
            }
        });

        console.log(`[Task ${taskId}] 创建上传任务: ${safeFileName}, ${normalizedSize} bytes`);
        res.status(201).json({
            taskId,
            uploadToken: task.uploadToken,
            chunkSize: task.chunkSize,
            totalChunks: task.totalChunks
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 接收单个原始二进制分片。并发分片写入互不重叠的文件区间。
 */
app.put('/api/uploads/:taskId/chunks/:chunkIndex', async (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传凭证无效' });
    }
    if (task.status !== 'uploading') {
        return res.status(409).json({ error: '任务已结束上传阶段' });
    }

    const chunkIndex = Number(req.params.chunkIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= task.totalChunks) {
        return res.status(400).json({ error: '分片序号无效' });
    }
    if (task.receivedChunks.has(chunkIndex)) {
        return res.json({ received: true, chunkIndex, uploadedBytes: task.uploadedBytes });
    }
    if (task.activeChunks.has(chunkIndex)) {
        return res.status(409).json({ error: '该分片正在上传' });
    }

    const start = chunkIndex * task.chunkSize;
    const expectedSize = Math.min(task.chunkSize, task.totalBytes - start);
    const expectedRange = `bytes ${start}-${start + expectedSize - 1}/${task.totalBytes}`;
    const contentLength = Number(req.get('Content-Length'));
    if (req.get('Content-Range') !== expectedRange || contentLength !== expectedSize) {
        return res.status(400).json({ error: '分片范围或大小不正确' });
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
            throw new Error('分片数据不完整');
        }

        task.receivedChunks.add(chunkIndex);
        task.uploadedBytes += expectedSize;
        updateTask(task.taskId, {
            progress: Math.min(20, Math.round((task.uploadedBytes / task.totalBytes) * 20))
        });
        res.json({ received: true, chunkIndex, uploadedBytes: task.uploadedBytes });
    } catch (error) {
        if (!res.headersSent) res.status(400).json({ error: error.message || '分片上传失败' });
    } finally {
        task.activeChunks.delete(chunkIndex);
    }
});

/** 上传完整后进入服务端媒体处理。 */
app.post('/api/uploads/:taskId/complete', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传凭证无效' });
    }
    if (task.status === 'processing' || task.status === 'completed') {
        return res.status(202).json({ taskId: task.taskId, status: task.status });
    }
    if (task.status !== 'uploading') {
        return res.status(409).json({ error: task.error || '任务无法开始处理' });
    }
    if (task.receivedChunks.size !== task.totalChunks || task.uploadedBytes !== task.totalBytes) {
        return res.status(409).json({
            error: '文件尚未上传完整',
            receivedChunks: task.receivedChunks.size,
            totalChunks: task.totalChunks
        });
    }

    task.config.apiKey = req.body?.apiKey ? String(req.body.apiKey) : null;
    updateTask(task.taskId, { status: 'processing', stage: 'queued', progress: 20 });
    res.status(202).json({ taskId: task.taskId, status: 'processing' });

    const { segmentStyle, contextPrompt, targetLanguage, captionMode, apiKey } = task.config;
    enqueueProcessing(task.taskId, () => processFile(task.taskId, task.filePath, task.mimeType, segmentStyle, contextPrompt, apiKey, targetLanguage, captionMode));
});

/** 取消上传或处理任务。 */
app.post('/api/task/:taskId/cancel', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (req.get('X-Upload-Token') !== task.uploadToken) {
        return res.status(403).json({ error: '上传凭证无效' });
    }

    task.cancelled = true;
    task.config = {};
    updateTask(task.taskId, {
        status: 'cancelled',
        stage: task.stage,
        error: '任务已取消'
    });
    if (task.stage === 'uploading' || task.stage === 'queued') removeFile(task.filePath);
    scheduleTaskCleanup(task.taskId);
    res.json({ taskId: task.taskId, status: 'cancelled' });
});

/**
 * 上传并处理视频
 */
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    const taskId = uuidv4();

    if (!req.file) {
        return res.status(400).json({ error: '请上传文件' });
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
            apiKey: req.body.apiKey || null
        }
    });

    // 立即返回任务 ID
    res.json({ taskId, message: '任务已开始' });

    // 后台处理
    enqueueProcessing(taskId, () => processFile(taskId, req.file.path, req.file.mimetype, req.body.segmentStyle || 'natural', req.body.contextPrompt || '', req.body.apiKey || null));
});

/**
 * 后台处理文件
 */
async function processFile(taskId, filePath, mimeType, segmentStyle, contextPrompt, userApiKey, targetLanguage = 'English', captionMode = 'Original') {
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
                            userApiKey
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
            if (audioSegments.length === 0) throw new Error('没有检测到可转录的音频内容');

            removeFile(segmentDir);
            task.segmentDir = null;
        } else {
            // 直接转录
            updateTask(taskId, { stage: 'transcribing', progress: 50 });
            allSegments = await transcribeSegmentWithRetry(task, audioPath, 0, segmentStyle, contextPrompt, userApiKey);
            assertTaskActive(task);
        updateTask(taskId, {
            stage: 'transcribing',
            progress: 95,
            captions: buildCaptions(allSegments)
        });
        }

        assertTaskActive(task);
        let finalCaptions = buildCaptions(allSegments);
        if (captionMode !== 'Original' && finalCaptions.length > 0) {
            updateTask(taskId, { stage: 'translating', progress: 96 });
            finalCaptions = await translateCaptions(task, finalCaptions, targetLanguage, captionMode, userApiKey);
            updateTask(taskId, { stage: 'translating', progress: 99, captions: finalCaptions });
        }
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
                updateTask(taskId, { status: 'cancelled', error: '任务已取消' });
            }
        } else {
            console.error(`[Task ${taskId}] 错误:`, error);
            updateTask(taskId, { status: 'error', error: error.message || '处理失败' });
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
        return res.status(404).json({ error: '任务不存在' });
    }

    res.json(serializeTask(task));
});

/**
 * 获取任务结果（SSE 流式）
 */
app.get('/api/task/:taskId/stream', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(serializeTask(task))}\n\n`);

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
            return res.status(400).json({ error: '文件太大，超过了 20GB 的限制' });
        }
        return res.status(400).json({ error: `上传错误: ${err.message}` });
    }
    if (err) {
        return res.status(500).json({ error: err.message });
    }
    next();
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Caption Server 运行在端口: ${PORT}`);
    console.log(`🔗 外部访问请确保监听 0.0.0.0`);
    console.log(`📁 上传目录: ${UPLOAD_DIR}`);
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);

    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️  未设置 OPENAI_API_KEY 环境变量');
    }
});
