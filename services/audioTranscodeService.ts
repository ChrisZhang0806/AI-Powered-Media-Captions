import { FFmpeg } from '@ffmpeg/ffmpeg';

const TARGET_SAMPLE_RATE = 16_000;
const TARGET_BITRATE = 48_000;
const MIN_LOSSLESS_BYTES = 8 * 1024 * 1024;
const MIN_LOSSY_BYTES = 24 * 1024 * 1024;
const MIN_LOSSY_BITRATE = 96_000;
const MIN_SAVING_RATIO = 0.3;
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;

export const STANDARD_MP3_PROFILE = 'mp3-mono-16k-v1';
type AudioSourceFormat = 'aac' | 'wav' | 'mp3' | 'ogg' | 'flac';

interface CompressionInput {
    audioFormat: AudioSourceFormat;
    duration: number;
    encodedBytes: number;
    segments: Array<unknown>;
}

export interface AudioCompressionDecision {
    enabled: boolean;
    estimatedBytes: number;
    sourceBitrate: number;
}

export interface CompressedAudioSegment {
    blob: Blob;
    encodedBytes: number;
    fileExtension: 'mp3';
    profile: typeof STANDARD_MP3_PROFILE;
}

interface TranscodeOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

const abortError = (signal?: AbortSignal) => signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Audio compression cancelled', 'AbortError');

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw abortError(signal);
};

export const chooseAudioCompression = (
    input: CompressionInput,
    hardwareConcurrency = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
): AudioCompressionDecision => {
    const duration = Number(input.duration);
    const encodedBytes = Number(input.encodedBytes);
    const segmentOverhead = Math.max(1, input.segments.length) * 4096;
    const estimatedBytes = Number.isFinite(duration) && duration > 0
        ? Math.ceil((duration * TARGET_BITRATE) / 8) + segmentOverhead
        : encodedBytes;
    const sourceBitrate = duration > 0 ? (encodedBytes * 8) / duration : 0;
    const savingRatio = encodedBytes > 0 ? 1 - estimatedBytes / encodedBytes : 0;
    const browserCapable = typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined';

    const losslessWorthCompressing = (input.audioFormat === 'wav' || input.audioFormat === 'flac')
        && encodedBytes >= MIN_LOSSLESS_BYTES
        && savingRatio >= MIN_SAVING_RATIO;
    const lossyWorthCompressing = ['aac', 'mp3', 'ogg'].includes(input.audioFormat)
        && hardwareConcurrency > 2
        && encodedBytes >= MIN_LOSSY_BYTES
        && sourceBitrate >= MIN_LOSSY_BITRATE
        && savingRatio >= MIN_SAVING_RATIO;

    return {
        enabled: browserCapable && (losslessWorthCompressing || lossyWorthCompressing),
        estimatedBytes: Math.max(0, estimatedBytes),
        sourceBitrate
    };
};

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let queue: Promise<void> = Promise.resolve();
let activeProgress: ((progress: number) => void) | undefined;
let jobSequence = 0;

const terminateEngine = (engine: FFmpeg) => {
    if (ffmpeg !== engine) return;
    engine.terminate();
    ffmpeg = null;
    loading = null;
    activeProgress = undefined;
};

const loadEngine = async (signal?: AbortSignal): Promise<FFmpeg> => {
    throwIfAborted(signal);
    if (ffmpeg?.loaded) return ffmpeg;
    if (loading) return loading;

    const engine = new FFmpeg();
    ffmpeg = engine;
    engine.on('progress', ({ progress }) => {
        if (Number.isFinite(progress)) {
            activeProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
        }
    });

    const baseUrl = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, window.location.origin);
    loading = engine.load({
        coreURL: new URL('ffmpeg-core.js', baseUrl).href,
        wasmURL: new URL('ffmpeg-core.wasm', baseUrl).href
    }, { signal }).then(() => engine).catch((error) => {
        terminateEngine(engine);
        throw error;
    }).finally(() => {
        if (ffmpeg === engine) loading = null;
    });
    return loading;
};

const transcodeNow = async (
    input: Blob,
    inputExtension: AudioSourceFormat,
    options: TranscodeOptions
): Promise<CompressedAudioSegment> => {
    throwIfAborted(options.signal);
    const engine = await loadEngine(options.signal);
    const jobId = ++jobSequence;
    const inputName = `audio-input-${jobId}.${inputExtension}`;
    const outputName = `audio-output-${jobId}.mp3`;
    const handleAbort = () => terminateEngine(engine);
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    try {
        activeProgress = options.onProgress;
        const inputBytes = new Uint8Array(await input.arrayBuffer());
        throwIfAborted(options.signal);
        await engine.writeFile(inputName, inputBytes, { signal: options.signal });
        const exitCode = await engine.exec([
            '-i', inputName,
            '-vn',
            '-map', '0:a:0',
            '-ac', '1',
            '-ar', String(TARGET_SAMPLE_RATE),
            '-c:a', 'libmp3lame',
            '-b:a', '48k',
            '-map_metadata', '-1',
            outputName
        ], TRANSCODE_TIMEOUT_MS, { signal: options.signal });
        if (exitCode !== 0) throw new Error(`Browser audio compression exited with code ${exitCode}`);

        const output = await engine.readFile(outputName, 'binary', { signal: options.signal });
        if (!(output instanceof Uint8Array) || output.byteLength === 0) {
            throw new Error('Browser audio compression produced no audio');
        }
        const blob = new Blob([output], { type: 'audio/mpeg' });
        options.onProgress?.(100);
        return {
            blob,
            encodedBytes: blob.size,
            fileExtension: 'mp3',
            profile: STANDARD_MP3_PROFILE
        };
    } finally {
        activeProgress = undefined;
        options.signal?.removeEventListener('abort', handleAbort);
        if (ffmpeg === engine && engine.loaded) {
            await engine.deleteFile(inputName).catch(() => undefined);
            await engine.deleteFile(outputName).catch(() => undefined);
        }
    }
};

/** Queue compression so only one bounded audio segment occupies the WASM heap at a time. */
export const transcodeAudioSegment = (
    input: Blob,
    inputExtension: AudioSourceFormat,
    options: TranscodeOptions = {}
): Promise<CompressedAudioSegment> => {
    const task = queue.then(
        () => transcodeNow(input, inputExtension, options),
        () => transcodeNow(input, inputExtension, options)
    );
    queue = task.then(() => undefined, () => undefined);
    return task;
};
