import { spawn } from 'node:child_process';

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

export class StreamingMediaError extends Error {
    constructor(message, ffmpegLog = '') {
        super(message);
        this.name = 'StreamingMediaError';
        this.ffmpegLog = ffmpegLog;
    }
}

export function parseByteRange(header, totalBytes) {
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return null;
    if (!header) return { start: 0, end: totalBytes - 1, partial: false };

    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
    if (!match || (!match[1] && !match[2])) return null;

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
        start = Math.max(0, totalBytes - suffixLength);
        end = totalBytes - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : totalBytes - 1;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= totalBytes || end < start) {
        return null;
    }
    return { start, end: Math.min(end, totalBytes - 1), partial: true };
}

function frameIsSpeech(frame, threshold) {
    const sampleCount = Math.floor(frame.length / BYTES_PER_SAMPLE);
    if (sampleCount === 0) return false;

    let sumSquares = 0;
    for (let offset = 0; offset + 1 < frame.length; offset += BYTES_PER_SAMPLE) {
        const sample = frame.readInt16LE(offset);
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / sampleCount) >= threshold;
}

/**
 * Converts a continuous 16 kHz mono PCM stream into bounded, speech-bearing
 * chunks. Boundaries prefer sustained silence and never retain long silent
 * prefixes or suffixes, which also reduces Whisper silence hallucinations.
 */
export class PcmSpeechSegmenter {
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
        this.channels = options.channels || DEFAULT_CHANNELS;
        this.frameDuration = options.frameDuration || 0.02;
        this.targetDuration = options.targetDuration || 35;
        this.maxDuration = options.maxDuration || 50;
        this.silenceDuration = options.silenceDuration || 0.45;
        this.silenceThreshold = options.silenceThreshold || 160;
        this.minimumSpeechDuration = options.minimumSpeechDuration || 0.3;
        this.edgePaddingDuration = options.edgePaddingDuration || 0.25;

        this.bytesPerSecond = this.sampleRate * this.channels * BYTES_PER_SAMPLE;
        this.frameBytes = Math.max(
            this.channels * BYTES_PER_SAMPLE,
            Math.round(this.bytesPerSecond * this.frameDuration)
        );
        this.requiredSilenceFrames = Math.max(1, Math.ceil(this.silenceDuration / this.frameDuration));
        this.requiredSpeechFrames = Math.max(1, Math.ceil(this.minimumSpeechDuration / this.frameDuration));
        this.edgePaddingFrames = Math.max(0, Math.ceil(this.edgePaddingDuration / this.frameDuration));

        this.carry = Buffer.alloc(0);
        this.frames = [];
        this.speechFlags = [];
        this.segmentBytes = 0;
        this.processedBytes = 0;
        this.trailingSilenceFrames = 0;
    }

    push(chunk) {
        if (!chunk?.length) return [];
        const source = this.carry.length > 0
            ? Buffer.concat([this.carry, Buffer.from(chunk)])
            : Buffer.from(chunk);
        const emitted = [];
        let offset = 0;

        while (offset + this.frameBytes <= source.length) {
            const frame = Buffer.from(source.subarray(offset, offset + this.frameBytes));
            offset += this.frameBytes;
            const segment = this.consumeFrame(frame);
            if (segment) emitted.push(segment);
        }

        this.carry = Buffer.from(source.subarray(offset));
        return emitted;
    }

    finish() {
        const emitted = [];
        if (this.carry.length >= this.channels * BYTES_PER_SAMPLE) {
            const alignedLength = this.carry.length - (this.carry.length % (this.channels * BYTES_PER_SAMPLE));
            const segment = this.consumeFrame(Buffer.from(this.carry.subarray(0, alignedLength)), false);
            if (segment) emitted.push(segment);
        }
        this.carry = Buffer.alloc(0);
        const finalSegment = this.commit();
        if (finalSegment) emitted.push(finalSegment);
        return emitted;
    }

    consumeFrame(frame, allowBoundary = true) {
        const isSpeech = frameIsSpeech(frame, this.silenceThreshold);
        this.frames.push(frame);
        this.speechFlags.push(isSpeech);
        this.segmentBytes += frame.length;
        this.processedBytes += frame.length;
        this.trailingSilenceFrames = isSpeech ? 0 : this.trailingSilenceFrames + 1;

        if (!allowBoundary) return null;
        const duration = this.segmentBytes / this.bytesPerSecond;
        const silenceBoundary = duration >= this.targetDuration
            && this.trailingSilenceFrames >= this.requiredSilenceFrames;
        if (silenceBoundary || duration >= this.maxDuration) return this.commit();
        return null;
    }

    commit() {
        if (this.segmentBytes === 0) return null;

        const fullStartTime = (this.processedBytes - this.segmentBytes) / this.bytesPerSecond;
        const fullDuration = this.segmentBytes / this.bytesPerSecond;
        const speechFrameCount = this.speechFlags.reduce((count, value) => count + (value ? 1 : 0), 0);
        const hasSpeech = speechFrameCount >= this.requiredSpeechFrames;
        let result;

        if (!hasSpeech) {
            result = {
                pcm: Buffer.alloc(0),
                startTime: fullStartTime,
                duration: fullDuration,
                hasSpeech: false
            };
        } else {
            const firstSpeech = this.speechFlags.indexOf(true);
            const lastSpeech = this.speechFlags.lastIndexOf(true);
            const firstFrame = Math.max(0, firstSpeech - this.edgePaddingFrames);
            const lastFrameExclusive = Math.min(this.frames.length, lastSpeech + this.edgePaddingFrames + 1);
            const skippedBytes = this.frames
                .slice(0, firstFrame)
                .reduce((total, frame) => total + frame.length, 0);
            const selectedFrames = this.frames.slice(firstFrame, lastFrameExclusive);
            const selectedBytes = selectedFrames.reduce((total, frame) => total + frame.length, 0);

            result = {
                pcm: Buffer.concat(selectedFrames, selectedBytes),
                startTime: fullStartTime + skippedBytes / this.bytesPerSecond,
                duration: selectedBytes / this.bytesPerSecond,
                hasSpeech: true
            };
        }

        this.frames = [];
        this.speechFlags = [];
        this.segmentBytes = 0;
        this.trailingSilenceFrames = 0;
        return result;
    }
}

export function createWavBuffer(pcm, sampleRate = DEFAULT_SAMPLE_RATE, channels = DEFAULT_CHANNELS) {
    const source = Buffer.from(pcm);
    const header = Buffer.alloc(44);
    const blockAlign = channels * BYTES_PER_SAMPLE;
    const byteRate = sampleRate * blockAlign;

    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + source.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(source.length, 40);
    return Buffer.concat([header, source], header.length + source.length);
}

export async function decodeMediaToSpeechSegments({
    inputUrl,
    ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
    signal,
    segmentOptions,
    onSegment,
    onDecodedTime
}) {
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-nostdin',
        '-i', inputUrl,
        '-map', '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-ac', String(DEFAULT_CHANNELS),
        '-ar', String(DEFAULT_SAMPLE_RATE),
        '-f', 's16le',
        'pipe:1'
    ];
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const segmenter = new PcmSpeechSegmenter(segmentOptions);
    let stderr = '';
    let aborted = false;

    const terminate = () => {
        aborted = true;
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        timer.unref?.();
    };
    if (signal?.aborted) terminate();
    else signal?.addEventListener('abort', terminate, { once: true });

    child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-16_384);
    });

    const exitPromise = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, exitSignal) => resolve({ code, exitSignal }));
    });

    try {
        for await (const chunk of child.stdout) {
            for (const segment of segmenter.push(chunk)) {
                onDecodedTime?.(segment.startTime + segment.duration);
                await onSegment(segment);
            }
        }
        for (const segment of segmenter.finish()) {
            onDecodedTime?.(segment.startTime + segment.duration);
            await onSegment(segment);
        }

        const result = await exitPromise;
        if (aborted || signal?.aborted) {
            throw signal?.reason instanceof Error
                ? signal.reason
                : new DOMException('Media processing cancelled', 'AbortError');
        }
        if (result.code !== 0) {
            const detail = stderr.trim().split('\n').at(-1) || 'FFmpeg could not decode the audio track';
            throw new StreamingMediaError(detail.replaceAll(inputUrl, 'uploaded media'), stderr);
        }
    } finally {
        signal?.removeEventListener('abort', terminate);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
}
