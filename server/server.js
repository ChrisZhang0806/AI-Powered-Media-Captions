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
 * 断句风格对应的 Whisper prompt
 */
const SEGMENT_STYLE_PROMPTS = {
    compact: 'Extremely short sentences. Break frequently. Maximum 7 words per segment. Suitable for fast-paced subtitles.',
    natural: 'Break sentences into short, readable subtitle lines. Use commas to split long thoughts. Maximum 10-12 words per line.',
    detailed: 'Follow natural speech flow but avoid extremely long blocks. Break at logical pauses.'
};

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

    const stylePrompt = SEGMENT_STYLE_PROMPTS[style] || SEGMENT_STYLE_PROMPTS.natural;
    // 合并用户背景知识和风格提示，Whisper prompt 限制在约 244 字符
    const fullPrompt = userContext
        ? `${userContext.substring(0, 150)}. ${stylePrompt}`
        : stylePrompt;

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

    // 2. 智能二次切割 (针对英文长句)
    const maxChars = style === 'compact' ? 35 : (style === 'natural' ? 55 : 100);
    return smartSplit(segments, maxChars);
}

/**
 * 语义感知智能切割长句
 * 针对中文进行了专门优化：更短的句子、更自然的断点
 */
function smartSplit(segments, maxChars) {
    const result = [];
    const weakerWords = ['and', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'with', 'at', 'is', 'it', 'for', 'but', 'or', 'so', 'my', 'your', 'be', 'do', 'does', 'did'];

    for (const seg of segments) {
        const text = seg.text;
        const isChinese = /[\u4e00-\u9fa5]/.test(text);

        // ==========================
        // 中文断句策略 (优化版)
        // ==========================
        if (isChinese) {
            const MIN_LENGTH = 6;   // 允许更短的自然短语
            const IDEAL_MIN = 12;   // 理想最小长度
            const IDEAL_MAX = 20;   // 理想最大长度
            const MAX_LENGTH = 28;  // 软上限
            const ABSOLUTE_MAX = 38; // 硬上限：超过必须强制断开

            // 1. 第一遍：按句子级标点断开 (。！？)
            const sentenceBreaks = /[。！？]/;
            const clauseBreaks = /[，、；：,.;:—]/;

            let sentences = [];
            let lastIdx = 0;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (sentenceBreaks.test(char)) {
                    sentences.push({
                        text: text.substring(lastIdx, i + 1).trim(),
                        startIdx: lastIdx,
                        endIdx: i + 1
                    });
                    lastIdx = i + 1;
                }
            }
            if (lastIdx < text.length) {
                sentences.push({
                    text: text.substring(lastIdx).trim(),
                    startIdx: lastIdx,
                    endIdx: text.length
                });
            }

            // 2. 第二遍：对过长的句子按子句级标点进一步断开
            let chunks = [];
            for (const sentence of sentences) {
                if (sentence.text.length <= MAX_LENGTH) {
                    chunks.push(sentence);
                    continue;
                }

                // 需要进一步断开
                let subLastIdx = 0;
                const sentenceText = sentence.text;

                for (let i = 0; i < sentenceText.length; i++) {
                    const char = sentenceText[i];

                    // 跳过数字中的标点
                    if ((char === '.' || char === ',' || char === ':') && i > 0 && i < sentenceText.length - 1) {
                        const prev = sentenceText[i - 1];
                        const next = sentenceText[i + 1];
                        if (/\d/.test(prev) && /\d/.test(next)) {
                            continue;
                        }
                    }

                    if (clauseBreaks.test(char)) {
                        const chunkText = sentenceText.substring(subLastIdx, i + 1).trim();
                        if (chunkText.length > 0) {
                            chunks.push({
                                text: chunkText,
                                startIdx: sentence.startIdx + subLastIdx,
                                endIdx: sentence.startIdx + i + 1
                            });
                        }
                        subLastIdx = i + 1;
                    }
                }

                if (subLastIdx < sentenceText.length) {
                    const remainingText = sentenceText.substring(subLastIdx).trim();
                    if (remainingText.length > 0) {
                        chunks.push({
                            text: remainingText,
                            startIdx: sentence.startIdx + subLastIdx,
                            endIdx: sentence.endIdx
                        });
                    }
                }
            }

            // 3. 第三遍：适度合并过短的孤儿句 (只合并极短的，如 < 4 字符)
            let merged = [];
            let buffer = null;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                if (buffer === null) {
                    buffer = { ...chunk };
                    continue;
                }

                const combinedLength = buffer.text.length + chunk.text.length;

                // 只在极短 + 合并后仍在理想范围内时才合并
                if (buffer.text.length < 4 && combinedLength <= IDEAL_MAX) {
                    buffer.text = buffer.text + chunk.text;
                    buffer.endIdx = chunk.endIdx;
                } else if (chunk.text.length < 4 && combinedLength <= IDEAL_MAX) {
                    buffer.text = buffer.text + chunk.text;
                    buffer.endIdx = chunk.endIdx;
                } else {
                    // 不合并，输出 buffer
                    merged.push(buffer);
                    buffer = { ...chunk };
                }
            }

            if (buffer) {
                merged.push(buffer);
            }

            // 4. 第四遍：强制拆分超长行
            let finalChunks = [];
            for (const chunk of merged) {
                if (chunk.text.length <= ABSOLUTE_MAX) {
                    finalChunks.push(chunk);
                } else {
                    // 强制按字符数拆分
                    const chunkText = chunk.text;
                    let start = 0;
                    while (start < chunkText.length) {
                        const end = Math.min(start + MAX_LENGTH, chunkText.length);
                        const partText = chunkText.substring(start, end).trim();
                        if (partText.length > 0) {
                            const ratio = chunkText.length > 0 ? (end - start) / chunkText.length : 1;
                            finalChunks.push({
                                text: partText,
                                startIdx: chunk.startIdx + Math.floor((start / chunkText.length) * (chunk.endIdx - chunk.startIdx)),
                                endIdx: chunk.startIdx + Math.floor((end / chunkText.length) * (chunk.endIdx - chunk.startIdx))
                            });
                        }
                        start = end;
                    }
                }
            }

            // 5. 输出结果
            const duration = seg.end - seg.start;
            finalChunks.forEach(c => {
                if (c.text.length > 0) {
                    result.push({
                        start: seg.start + (c.startIdx / text.length) * duration,
                        end: seg.start + (c.endIdx / text.length) * duration,
                        text: c.text
                    });
                }
            });
            continue;
        }

        // ==========================
        // 英文断句逻辑 (保持原有)
        // ==========================
        const words = text.split(/\s+/);
        let currentSegments = [];
        let remainingWords = [...words];

        while (remainingWords.length > 0) {
            let currentText = '';
            let bestBreakIndex = 0;

            for (let i = 0; i < remainingWords.length; i++) {
                const word = remainingWords[i];
                const testText = currentText ? `${currentText} ${word}` : word;

                if (testText.length > maxChars && currentText.length > 0) {
                    bestBreakIndex = i;

                    // 向前回溯寻找标点符号
                    for (let j = i; j > Math.max(0, i - 4); j--) {
                        if (/[.,?!;:]/.test(remainingWords[j - 1])) {
                            bestBreakIndex = j;
                            break;
                        }
                    }

                    // 避免在虚词处断开
                    if (bestBreakIndex === i) {
                        while (bestBreakIndex > Math.max(1, i - 3) &&
                            weakerWords.includes(remainingWords[bestBreakIndex - 1].toLowerCase().replace(/[^\w]/g, ''))) {
                            bestBreakIndex--;
                        }
                    }

                    break;
                }
                currentText = testText;
                bestBreakIndex = i + 1;
            }

            // 合并过短的尾部
            if (remainingWords.length - bestBreakIndex < 3 && currentSegments.length > 0) {
                bestBreakIndex = remainingWords.length;
            }

            const segmentWords = remainingWords.splice(0, bestBreakIndex);
            currentSegments.push(segmentWords.join(' '));
        }

        // 分配时间戳
        const totalChars = text.length;
        let runningStartTimeEnglish = seg.start;
        const totalDurationEnglish = seg.end - seg.start;

        currentSegments.forEach((textPart, index) => {
            const partRatio = textPart.length / totalChars;
            const partDuration = totalDurationEnglish * partRatio;
            const endTime = (index === currentSegments.length - 1) ? seg.end : runningStartTimeEnglish + partDuration;

            result.push({
                start: runningStartTimeEnglish,
                end: endTime,
                text: textPart.trim()
            });
            runningStartTimeEnglish = endTime;
        });
    }

    // ==========================
    // 全局合并策略 (Global Merge)
    // ==========================
    // 解决跨 Segment 的孤儿行问题 (如 "说实话" 在一段结尾，无法合并到下一段开头)
    const finalResult = [];

    for (let i = 0; i < result.length; i++) {
        let current = result[i];

        // 1. 如果当前行本身就是空的（虽然前面有过滤，以防万一），跳过
        if (!current.text) continue;

        const isChinese = /[\u4e00-\u9fa5]/.test(current.text);

        // 中文不再自动合并短句，直接保留原始断句

        // 原有的英文合并逻辑
        if (!isChinese) {
            const next = result[i + 1];
            if (next && !/[.?!]/.test(current.text) && (current.text.length + next.text.length) < maxChars * 1.5) {
                const nextIsShort = next.text.split(' ').length <= 2;
                if (nextIsShort) {
                    current.end = next.end;
                    current.text = `${current.text} ${next.text}`;
                    i++;
                }
            }
        }

        finalResult.push(current);
    }

    return finalResult;
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
