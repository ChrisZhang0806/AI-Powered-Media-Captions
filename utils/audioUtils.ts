import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let ffmpegLoaded = false;
let ffmpegLoading: Promise<FFmpeg> | null = null;

/**
 * 初始化 FFmpeg 实例
 */
export const loadFFmpeg = async (onProgress?: (progress: number) => void): Promise<FFmpeg> => {
    // 如果已加载，直接返回
    if (ffmpeg && ffmpegLoaded) {
        return ffmpeg;
    }

    // 如果正在加载中，等待加载完成（避免重复加载）
    if (ffmpegLoading) {
        return ffmpegLoading;
    }

    ffmpegLoading = (async () => {
        console.log('[FFmpeg] 开始加载...');
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg Log]', message);
        });

        ffmpeg.on('progress', ({ progress }) => {
            onProgress?.(progress * 100);
        });

        try {
            // 从本地 public 目录加载，但仍需使用 toBlobURL 确保正确的 MIME 类型
            const baseURL = window.location.origin + '/ffmpeg';
            console.log('[FFmpeg] 加载路径:', baseURL);

            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });

            ffmpegLoaded = true;
            console.log('[FFmpeg] 加载成功!');
            return ffmpeg;
        } catch (error) {
            console.error('[FFmpeg] 加载失败:', error);
            ffmpegLoading = null;
            throw error;
        }
    })();

    return ffmpegLoading;
};

/**
 * 从视频文件中提取音频
 * @param videoFile 视频文件
 * @param onProgress 进度回调 (0-100)
 * @returns MP3 格式的音频 Blob
 */
export const extractAudio = async (
    videoFile: File,
    onProgress?: (progress: number) => void
): Promise<Blob> => {
    console.log('[extractAudio] 开始提取音频, 文件大小:', (videoFile.size / 1024 / 1024).toFixed(2), 'MB');

    // 心跳进度：在长时间操作时模拟进度，让用户知道程序仍在运行
    let heartbeatProgress = 5;
    const heartbeatInterval = setInterval(() => {
        heartbeatProgress = Math.min(heartbeatProgress + 1, 35);
        onProgress?.(heartbeatProgress);
    }, 800);

    try {
        onProgress?.(5);
        const ff = await loadFFmpeg();
        heartbeatProgress = 15;
        onProgress?.(15);

        const inputName = 'input' + getExtension(videoFile.name);
        const outputName = 'output.mp3';

        // 写入输入文件（大文件可能耗时较长）
        console.log('[extractAudio] 正在加载视频到内存（大文件可能需要 1-2 分钟）...');
        await ff.writeFile(inputName, await fetchFile(videoFile));
        clearInterval(heartbeatInterval);
        console.log('[extractAudio] 视频文件写入完成');
        onProgress?.(40);

        // 注册执行进度监听
        ff.on('progress', ({ progress }) => {
            // progress 范围 0-1，映射到 40-90
            onProgress?.(40 + Math.round(progress * 50));
        });

        // 提取音频，转换为 MP3
        console.log('[extractAudio] 开始提取音频流...');
        await ff.exec([
            '-i', inputName,
            '-vn',                    // 移除视频流
            '-acodec', 'libmp3lame',  // 使用 MP3 编码
            '-ab', '64k',             // 比特率降低到 64kbps (节省带宽和内存)
            '-ar', '16000',           // 采样率 16kHz (Whisper 推荐)
            '-ac', '1',               // 单声道
            outputName
        ]);
        console.log('[extractAudio] 音频提取完成');
        onProgress?.(92);

        // 读取输出文件
        const data = await ff.readFile(outputName);
        onProgress?.(95);

        // 清理文件
        await ff.deleteFile(inputName);
        await ff.deleteFile(outputName);
        onProgress?.(98);

        // 转换为 Uint8Array 以确保类型兼容
        const rawData = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
        const uint8Array = new Uint8Array(rawData);
        const blob = new Blob([uint8Array], { type: 'audio/mp3' });

        console.log('[extractAudio] 最终音频大小:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
        onProgress?.(100);

        return blob;
    } finally {
        clearInterval(heartbeatInterval);
    }
};

/**
 * Whisper API 的最大文件大小限制 (25MB)，预留 1MB 缓冲
 */
const MAX_SEGMENT_SIZE_BYTES = 24 * 1024 * 1024; // 24 MB

/**
 * 默认最大时长（秒），作为初始估算值
 */
const DEFAULT_MAX_DURATION_SEC = 600; // 10 分钟

/**
 * 根据音频 Blob 估算比特率 (bps)
 * @param audioBlob 音频文件
 * @param durationSec 音频时长（秒）
 */
const estimateBitrate = (audioBlob: Blob, durationSec: number): number => {
    if (durationSec <= 0) return 128000; // 默认 128 kbps
    return (audioBlob.size * 8) / durationSec;
};

/**
 * 根据比特率和最大文件大小计算安全的最大时长
 * @param bitrate 比特率 (bps)
 * @param maxSizeBytes 最大文件大小（字节）
 */
const calculateMaxDuration = (bitrate: number, maxSizeBytes: number): number => {
    // maxSize (bytes) * 8 (bits/byte) / bitrate (bits/sec) = duration (sec)
    const maxDuration = (maxSizeBytes * 8) / bitrate;
    // 预留 10% 安全边际
    return Math.floor(maxDuration * 0.9);
};

/**
 * 将音频文件分割为多个片段，支持流式回调
 * @param audioBlob 原始音频或视频 Blob
 * @param onSegment 每切好一段的回调
 * @param maxDurationSec 每段最大时长（秒）
 * @param overlapSec 片段重叠时长（秒）
 */
export const segmentAudioStream = async (
    audioBlob: Blob,
    onSegment: (segment: { blob: Blob; startTime: number }) => Promise<void>,
    onProgress?: (info: { stageLabel: string; progress: number }) => void,
    maxDurationSec: number = 600,
    overlapSec: number = 2
): Promise<void> => {
    // 1. 加载 FFmpeg
    onProgress?.({ stageLabel: '加载音频处理引擎...', progress: 10 });
    const ff = await loadFFmpeg((p) => {
        onProgress?.({ stageLabel: '初始化引擎核心...', progress: 10 + Math.round(p * 0.4) });
    });

    onProgress?.({ stageLabel: '正在读取视频文件...', progress: 60 });
    const inputName = 'input_file';
    // 写入文件（这里是最大的瓶颈）
    await ff.writeFile(inputName, await fetchFile(audioBlob));
    onProgress?.({ stageLabel: '文件加载完成，准备分割...', progress: 90 });

    let currentStart = 0;
    let segmentIndex = 0;
    let isEnd = false;

    while (!isEnd) {
        const outputName = `seg_${segmentIndex}.mp3`;

        // 执行切分并转换比特率
        await ff.exec([
            '-ss', currentStart.toString(),
            '-t', maxDurationSec.toString(),
            '-i', inputName,
            '-acodec', 'libmp3lame',
            '-ab', '64k',
            '-ar', '16000',
            '-ac', '1',
            outputName
        ]);

        const data = await ff.readFile(outputName);
        if (data.length < 1000) { // 如果文件太小，说明已经到末尾了
            isEnd = true;
            await ff.deleteFile(outputName);
            break;
        }

        const segmentBlob = new Blob([data], { type: 'audio/mp3' });

        // 立即回调，触发转录
        await onSegment({
            blob: segmentBlob,
            startTime: currentStart
        });

        await ff.deleteFile(outputName);

        // 步进（考虑重叠）
        currentStart += maxDurationSec - overlapSec;
        segmentIndex++;

        // 安全退出
        if (segmentIndex > 500) break;
    }

    await ff.deleteFile(inputName);
};

// 保留原函数以便兼容，但内部由新逻辑驱动
export const segmentAudio = async (
    audioBlob: Blob
): Promise<{ blob: Blob; startTime: number }[]> => {
    const results: { blob: Blob; startTime: number }[] = [];
    await segmentAudioStream(audioBlob, async (seg) => {
        results.push(seg);
    });
    return results;
};

/**
 * 获取文件扩展名
 */
const getExtension = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext ? `.${ext}` : '.mp4';
};

/**
 * 检查文件是否为视频
 */
export const isVideoFile = (file: File): boolean => {
    return file.type.startsWith('video/');
};

/**
 * 检查文件是否为音频
 */
export const isAudioFile = (file: File): boolean => {
    return file.type.startsWith('audio/');
};
