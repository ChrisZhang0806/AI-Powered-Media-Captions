import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// 确保目录存在
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 初始化 Express
const app = express();
app.use(cors());
app.use(express.json());

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
    limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 增加到 20GB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/', 'audio/'];
        if (allowedTypes.some(type => file.mimetype.startsWith(type))) {
            cb(null, true);
        } else {
            cb(new Error('只支持音视频文件'));
        }
    }
});

// 存储任务状态
const tasks = new Map();



/**
 * 从视频中提取音频
 */
function extractAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('64k')
            .audioFrequency(16000)
            .audioChannels(1)
            .output(outputPath)
            .on('progress', (progress) => {
                console.log(`[FFmpeg] 提取进度: ${Math.round(progress.percent || 0)}%`);
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
function splitAudio(inputPath, outputDir, maxDuration = 600) {
    return new Promise(async (resolve, reject) => {
        try {
            const duration = await getAudioDuration(inputPath);
            const segments = [];
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

                segments.push({
                    path: segmentPath,
                    startTime: start,
                    duration: segmentDuration
                });

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
 * 上传并处理视频
 */
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    const taskId = uuidv4();

    if (!req.file) {
        return res.status(400).json({ error: '请上传文件' });
    }

    console.log(`[Task ${taskId}] 开始处理: ${req.file.originalname}`);

    // 初始化任务状态
    tasks.set(taskId, {
        status: 'processing',
        progress: 0,
        stage: 'uploading',
        captions: [],
        error: null
    });

    // 立即返回任务 ID
    res.json({ taskId, message: '任务已开始' });

    // 后台处理
    processFile(taskId, req.file.path, req.file.mimetype, req.body.segmentStyle || 'natural', req.body.contextPrompt || '', req.body.apiKey || null);
});

/**
 * 后台处理文件
 */
async function processFile(taskId, filePath, mimeType, segmentStyle, contextPrompt, userApiKey) {
    const task = tasks.get(taskId);
    const isVideo = mimeType.startsWith('video/');
    let audioPath = filePath;

    try {
        // 1. 如果是视频，提取音频
        if (isVideo) {
            task.stage = 'extracting';
            task.progress = 10;

            audioPath = path.join(OUTPUT_DIR, `${taskId}.mp3`);
            await extractAudio(filePath, audioPath);

            task.progress = 30;
        }

        // 2. 检查文件大小，决定是否需要分割
        const stats = fs.statSync(audioPath);
        const fileSizeMB = stats.size / (1024 * 1024);

        let allSegments = [];

        if (fileSizeMB > 24) {
            // 需要分割
            task.stage = 'splitting';
            task.progress = 35;

            const segmentDir = path.join(OUTPUT_DIR, taskId);
            fs.mkdirSync(segmentDir, { recursive: true });

            const audioSegments = await splitAudio(audioPath, segmentDir);

            // 3. 并发转录（最多 3 个）
            task.stage = 'transcribing';
            const concurrency = 3;

            for (let i = 0; i < audioSegments.length; i += concurrency) {
                const batch = audioSegments.slice(i, i + concurrency);
                const results = await Promise.all(
                    batch.map(seg => transcribeSegment(seg.path, seg.startTime, segmentStyle, contextPrompt, userApiKey))
                );

                results.forEach(segs => allSegments.push(...segs));

                task.progress = 40 + Math.round((i / audioSegments.length) * 50);
                console.log(`[Task ${taskId}] 转录进度: ${task.progress}%`);
            }

            // 清理分割文件
            fs.rmSync(segmentDir, { recursive: true, force: true });
        } else {
            // 直接转录
            task.stage = 'transcribing';
            task.progress = 40;

            allSegments = await transcribeSegment(audioPath, 0, segmentStyle, contextPrompt, userApiKey);
            task.progress = 90;
        }

        // 4. 整理结果
        allSegments.sort((a, b) => a.start - b.start);

        // 去重
        const uniqueSegments = [];
        for (const seg of allSegments) {
            const last = uniqueSegments[uniqueSegments.length - 1];
            if (!last || seg.start >= last.end - 0.5) {
                uniqueSegments.push(seg);
            }
        }

        // 格式化为字幕格式
        const captions = uniqueSegments.map((seg, i) => ({
            id: i,
            startTime: formatTimestamp(seg.start),
            endTime: formatTimestamp(seg.end),
            text: seg.text
        }));

        task.captions = captions;
        task.status = 'completed';
        task.progress = 100;
        task.stage = 'done';

        console.log(`[Task ${taskId}] 完成，共 ${task.captions.length} 条字幕`);

    } catch (error) {
        console.error(`[Task ${taskId}] 错误:`, error);
        task.status = 'error';
        task.error = error.message;
    } finally {
        // 清理上传的原始文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        // 清理提取的音频文件
        if (audioPath !== filePath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }
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

    res.json(task);
});

/**
 * 获取任务结果（SSE 流式）
 */
app.get('/api/task/:taskId/stream', (req, res) => {
    const taskId = req.params.taskId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = () => {
        const task = tasks.get(taskId);
        if (!task) {
            res.write(`data: ${JSON.stringify({ error: '任务不存在' })}\n\n`);
            res.end();
            return;
        }

        res.write(`data: ${JSON.stringify(task)}\n\n`);

        if (task.status === 'completed' || task.status === 'error') {
            res.end();
            return;
        }

        setTimeout(sendUpdate, 1000);
    };

    sendUpdate();
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
