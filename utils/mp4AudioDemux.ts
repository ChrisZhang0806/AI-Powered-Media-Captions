import { createFile, type MP4BoxBuffer, type Movie, type Sample, type Track } from 'mp4box';
import { readMp4MetadataBuffer } from './mediaMetadata';
import { getPcmAudioConfig, registerPcmSampleEntries, type PcmAudioConfig } from './mp4PcmSupport';

const MAX_SEGMENT_DURATION_SECONDS = 300;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
const MAX_RANGE_GAP = 64 * 1024;
const MAX_RANGE_SIZE = 8 * 1024 * 1024;
const ADTS_HEADER_SIZE = 7;
const WAV_HEADER_SIZE = 44;

const AAC_SAMPLE_RATES = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000,
    22050, 16000, 12000, 11025, 8000, 7350
];

export class UnsupportedMp4AudioError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedMp4AudioError';
    }
}

export interface AacSampleIndex {
    offset: number;
    size: number;
    cts: number;
    dts: number;
    duration: number;
    timescale: number;
}

export interface AacSegmentIndex {
    index: number;
    startTime: number;
    duration: number;
    encodedBytes: number;
    samples: AacSampleIndex[];
}

export interface Mp4AudioPlan {
    codec: string;
    audioFormat: 'aac' | 'wav';
    fileExtension: 'aac' | 'wav';
    mimeType: 'audio/aac' | 'audio/wav';
    sampleRate: number;
    channelCount: number;
    duration: number;
    encodedBytes: number;
    segments: AacSegmentIndex[];
    pcmConfig?: PcmAudioConfig;
}

interface AnalyzeOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    maxSegmentDurationSeconds?: number;
    maxSegmentBytes?: number;
}

interface BuildOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

interface SampleOutputEntry {
    sample: AacSampleIndex;
    payloadOffset: number;
}

interface ReadRange {
    start: number;
    end: number;
    entries: SampleOutputEntry[];
}

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Operation cancelled', 'AbortError');
};

const getSampleStart = (sample: AacSampleIndex) => sample.cts / sample.timescale;
const getSampleEnd = (sample: AacSampleIndex) => (sample.cts + sample.duration) / sample.timescale;

const copySampleIndex = (sample: Sample): AacSampleIndex => ({
    offset: sample.offset,
    size: sample.size,
    cts: sample.cts,
    dts: sample.dts,
    duration: sample.duration,
    timescale: sample.timescale
});

const validateAudioTrack = (track: Track | undefined, firstSample: Sample) => {
    if (!track?.audio) {
        throw new UnsupportedMp4AudioError('The MP4 file does not contain an audio track');
    }

    const codecMatch = /^mp4a\.40\.(\d+)$/i.exec(track.codec || '');
    if (codecMatch && Number(codecMatch[1]) === 2) {
        const sampleRateIndex = AAC_SAMPLE_RATES.indexOf(track.audio.sample_rate);
        if (sampleRateIndex < 0) {
            throw new UnsupportedMp4AudioError(`Unsupported AAC sample rate: ${track.audio.sample_rate}`);
        }
        if (track.audio.channel_count < 1 || track.audio.channel_count > 2) {
            throw new UnsupportedMp4AudioError(`Unsupported AAC channel count: ${track.audio.channel_count}`);
        }
        return {
            audioFormat: 'aac' as const,
            sampleRate: track.audio.sample_rate,
            channelCount: track.audio.channel_count
        };
    }

    const pcmConfig = getPcmAudioConfig(track, firstSample);
    if (!pcmConfig) {
        throw new UnsupportedMp4AudioError(`Unsupported MP4 audio codec: ${track.codec || 'unknown'}`);
    }
    if (track.audio.sample_rate < 8000 || track.audio.sample_rate > 192000) {
        throw new UnsupportedMp4AudioError(`Unsupported PCM sample rate: ${track.audio.sample_rate}`);
    }
    if (track.audio.channel_count < 1 || track.audio.channel_count > 8) {
        throw new UnsupportedMp4AudioError(`Unsupported PCM channel count: ${track.audio.channel_count}`);
    }
    return {
        audioFormat: 'wav' as const,
        sampleRate: track.audio.sample_rate,
        channelCount: track.audio.channel_count,
        pcmConfig
    };
};

const buildSegmentPlan = (
    samples: AacSampleIndex[],
    maxDuration: number,
    maxBytes: number,
    audioFormat: 'aac' | 'wav'
): AacSegmentIndex[] => {
    const segments: AacSegmentIndex[] = [];
    let currentSamples: AacSampleIndex[] = [];
    let currentBytes = 0;
    let currentStart = 0;
    const frameOverhead = audioFormat === 'aac' ? ADTS_HEADER_SIZE : 0;
    const segmentHeader = audioFormat === 'wav' ? WAV_HEADER_SIZE : 0;

    const commit = () => {
        if (currentSamples.length === 0) return;
        const last = currentSamples[currentSamples.length - 1];
        segments.push({
            index: segments.length,
            startTime: currentStart,
            duration: Math.max(0, getSampleEnd(last) - currentStart),
            encodedBytes: currentBytes + segmentHeader,
            samples: currentSamples
        });
        currentSamples = [];
        currentBytes = 0;
    };

    for (const sample of samples) {
        const frameBytes = sample.size + frameOverhead;
        if (frameBytes + segmentHeader > maxBytes) {
            throw new UnsupportedMp4AudioError('An audio sample exceeds the fast-path segment limit');
        }

        if (currentSamples.length === 0) currentStart = getSampleStart(sample);
        const wouldExceedDuration = getSampleEnd(sample) - currentStart > maxDuration;
        const wouldExceedBytes = currentBytes + frameBytes + segmentHeader > maxBytes;
        if (currentSamples.length > 0 && (wouldExceedDuration || wouldExceedBytes)) {
            commit();
            currentStart = getSampleStart(sample);
        }

        currentSamples.push(sample);
        currentBytes += frameBytes;
    }

    commit();
    return segments;
};

/**
 * Read only MP4 top-level metadata, then build byte ranges for AAC-LC or
 * camera Linear PCM audio. The large mdat video payload is skipped entirely.
 */
export const analyzeMp4Audio = async (
    file: Blob,
    options: AnalyzeOptions = {}
): Promise<Mp4AudioPlan> => {
    registerPcmSampleEntries();
    const parser = createFile(false);
    let info: Movie | null = null;
    let parserError: Error | null = null;

    parser.onReady = (movie) => {
        info = movie;
    };
    parser.onError = (module, message) => {
        if (!info) parserError = new UnsupportedMp4AudioError(`${module}: ${message}`);
    };

    throwIfAborted(options.signal);
    options.onProgress?.(5);
    const metadataBuffer = await readMp4MetadataBuffer(file);
    throwIfAborted(options.signal);
    parser.appendBuffer(metadataBuffer as MP4BoxBuffer, true);
    options.onProgress?.(100);
    if (parserError && !info) throw parserError;
    if (!info?.hasMoov) {
        throw new UnsupportedMp4AudioError('The MP4 metadata could not be read');
    }

    const track = info.audioTracks[0];
    if (!track) throw new UnsupportedMp4AudioError('The MP4 file does not contain an audio track');
    const rawSamples = parser.getTrackSamplesInfo(track.id)
        .filter((sample) => sample.size > 0 && sample.timescale > 0);
    if (rawSamples.length === 0) {
        throw new UnsupportedMp4AudioError('The audio track contains no readable samples');
    }
    const { audioFormat, sampleRate, channelCount, pcmConfig } = validateAudioTrack(track, rawSamples[0]);
    if (pcmConfig && rawSamples.some((sample) => sample.size % pcmConfig.bytesPerSample !== 0)) {
        throw new UnsupportedMp4AudioError('The PCM audio samples are not byte-aligned');
    }
    const samples = rawSamples
        .filter((sample) => sample.size > 0 && sample.timescale > 0)
        .map(copySampleIndex)
        .sort((a, b) => a.cts - b.cts || a.dts - b.dts);

    for (const sample of samples) {
        if (!Number.isSafeInteger(sample.offset) || sample.offset < 0 || sample.offset + sample.size > file.size) {
            throw new UnsupportedMp4AudioError('The MP4 audio index contains an invalid byte range');
        }
    }

    const segments = buildSegmentPlan(
        samples,
        options.maxSegmentDurationSeconds || MAX_SEGMENT_DURATION_SECONDS,
        options.maxSegmentBytes || MAX_SEGMENT_BYTES,
        audioFormat
    );
    const lastSample = samples[samples.length - 1];

    return {
        codec: track.codec,
        audioFormat,
        fileExtension: audioFormat,
        mimeType: audioFormat === 'aac' ? 'audio/aac' : 'audio/wav',
        sampleRate,
        channelCount,
        duration: getSampleEnd(lastSample),
        encodedBytes: segments.reduce((sum, segment) => sum + segment.encodedBytes, 0),
        segments,
        pcmConfig
    };
};

const writeAdtsHeader = (
    target: Uint8Array,
    offset: number,
    payloadSize: number,
    sampleRate: number,
    channelCount: number
) => {
    const sampleRateIndex = AAC_SAMPLE_RATES.indexOf(sampleRate);
    const frameLength = payloadSize + ADTS_HEADER_SIZE;
    const profile = 1; // AAC-LC object type 2 minus one.

    target[offset] = 0xff;
    target[offset + 1] = 0xf1;
    target[offset + 2] = (profile << 6) | (sampleRateIndex << 2) | (channelCount >> 2);
    target[offset + 3] = ((channelCount & 3) << 6) | ((frameLength >> 11) & 3);
    target[offset + 4] = (frameLength >> 3) & 0xff;
    target[offset + 5] = ((frameLength & 7) << 5) | 0x1f;
    target[offset + 6] = 0xfc;
};

const buildReadRanges = (entries: SampleOutputEntry[]): ReadRange[] => {
    const sortedEntries = [...entries].sort((a, b) => a.sample.offset - b.sample.offset);
    const ranges: ReadRange[] = [];

    for (const entry of sortedEntries) {
        const sampleEnd = entry.sample.offset + entry.sample.size;
        const current = ranges[ranges.length - 1];
        const canMerge = current
            && entry.sample.offset - current.end <= MAX_RANGE_GAP
            && sampleEnd - current.start <= MAX_RANGE_SIZE;

        if (canMerge) {
            current.end = Math.max(current.end, sampleEnd);
            current.entries.push(entry);
        } else {
            ranges.push({
                start: entry.sample.offset,
                end: sampleEnd,
                entries: [entry]
            });
        }
    }

    return ranges;
};

const writeWavHeader = (target: Uint8Array, plan: Mp4AudioPlan, dataSize: number) => {
    const pcm = plan.pcmConfig;
    if (!pcm) throw new UnsupportedMp4AudioError('PCM configuration is missing');
    const view = new DataView(target.buffer, target.byteOffset, WAV_HEADER_SIZE);
    const writeText = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index++) target[offset + index] = value.charCodeAt(index);
    };
    const blockAlign = plan.channelCount * pcm.bytesPerSample;

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, pcm.wavFormat, true);
    view.setUint16(22, plan.channelCount, true);
    view.setUint32(24, plan.sampleRate, true);
    view.setUint32(28, plan.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, pcm.bitsPerSample, true);
    writeText(36, 'data');
    view.setUint32(40, dataSize, true);
};

const swapPcmEndian = (target: Uint8Array, start: number, size: number, bytesPerSample: number) => {
    for (let offset = start; offset < start + size; offset += bytesPerSample) {
        for (let left = 0, right = bytesPerSample - 1; left < right; left++, right--) {
            const value = target[offset + left];
            target[offset + left] = target[offset + right];
            target[offset + right] = value;
        }
    }
};

/** Build a standalone ADTS AAC or WAV file for one indexed audio segment. */
export const buildAudioSegment = async (
    file: Blob,
    plan: Mp4AudioPlan,
    segment: AacSegmentIndex,
    options: BuildOptions = {}
): Promise<Blob> => {
    const output = new Uint8Array(segment.encodedBytes);
    const entries: SampleOutputEntry[] = [];
    let outputOffset = plan.audioFormat === 'wav' ? WAV_HEADER_SIZE : 0;

    if (plan.audioFormat === 'wav') writeWavHeader(output, plan, segment.encodedBytes - WAV_HEADER_SIZE);

    for (const sample of segment.samples) {
        if (plan.audioFormat === 'aac') {
            writeAdtsHeader(output, outputOffset, sample.size, plan.sampleRate, plan.channelCount);
            entries.push({ sample, payloadOffset: outputOffset + ADTS_HEADER_SIZE });
            outputOffset += ADTS_HEADER_SIZE + sample.size;
        } else {
            entries.push({ sample, payloadOffset: outputOffset });
            outputOffset += sample.size;
        }
    }

    const ranges = buildReadRanges(entries);
    const totalReadBytes = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    let readBytes = 0;

    for (const range of ranges) {
        throwIfAborted(options.signal);
        const source = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer());
        for (const entry of range.entries) {
            const sourceOffset = entry.sample.offset - range.start;
            output.set(
                source.subarray(sourceOffset, sourceOffset + entry.sample.size),
                entry.payloadOffset
            );
            if (plan.audioFormat === 'wav' && plan.pcmConfig && !plan.pcmConfig.sourceLittleEndian) {
                swapPcmEndian(output, entry.payloadOffset, entry.sample.size, plan.pcmConfig.bytesPerSample);
            }
        }
        readBytes += range.end - range.start;
        options.onProgress?.(totalReadBytes > 0 ? Math.round((readBytes / totalReadBytes) * 100) : 100);
    }

    return new Blob([output], { type: plan.mimeType });
};
