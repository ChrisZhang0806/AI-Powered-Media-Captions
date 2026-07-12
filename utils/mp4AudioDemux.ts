import {
    BoxParser,
    MultiBufferStream,
    type Sample,
    type Track
} from 'mp4box';
import { readMp4BoxBuffer } from './mediaMetadata';
import { getPcmAudioConfig, registerPcmSampleEntries, type PcmAudioConfig } from './mp4PcmSupport';

const MAX_SEGMENT_DURATION_SECONDS = 300;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_SAMPLES = 5_000_000;
const MAX_COMPACT_PCM_SAMPLES = 1_000_000_000;
const MAX_AUDIO_CHUNKS = 1_000_000;
const MAX_RANGE_GAP = 64 * 1024;
const MAX_RANGE_SIZE = 8 * 1024 * 1024;
const ADTS_HEADER_SIZE = 7;
const ADTS_MAX_FRAME_SIZE = 0x1fff;
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

export interface AacSegmentIndex {
    index: number;
    startTime: number;
    duration: number;
    encodedBytes: number;
    sampleStart: number;
    sampleEnd: number;
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
    sampleCount: number;
    sampleOffsets?: Float64Array;
    sampleSizes?: Uint32Array;
    constantSampleSize?: number;
    chunkOffsets: Float64Array;
    chunkFirstSamples: Float64Array;
    chunkSampleCounts: Uint32Array;
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

interface ParsedAudioEntry {
    getCodec(): string;
    getSampleRate(): number;
    getChannelCount(): number;
    getSampleSize(): number;
    version?: number;
    extensions?: Uint8Array;
}

interface ParsedSampleTable {
    stsd?: { entries?: ParsedAudioEntry[] };
    stsc?: {
        first_chunk?: number[];
        samples_per_chunk?: number[];
        sample_description_index?: number[];
    };
    stsz?: { sample_count?: number; sample_size?: number; sample_sizes?: number[] };
    stz2?: { sample_count?: number; sample_sizes?: number[] };
    stts?: { sample_counts?: number[]; sample_deltas?: number[] };
    stco?: { chunk_offsets?: number[] };
    co64?: { chunk_offsets?: number[] };
}

interface ParsedTrack {
    mdia?: {
        hdlr?: { handler?: string };
        mdhd?: { timescale?: number };
        minf?: { stbl?: ParsedSampleTable };
    };
}

interface ParsedMoov {
    hdr_size?: number;
    start?: number;
    traks?: ParsedTrack[];
    parse(stream: MultiBufferStream): void;
}

interface SampleOutputEntry {
    offset: number;
    size: number;
    payloadOffset: number;
}

interface ReadRange {
    start: number;
    end: number;
    entries: SampleOutputEntry[];
}

interface SampleSizeIndex {
    sampleCount: number;
    sampleSizes?: Uint32Array;
    constantSampleSize?: number;
}

interface SampleLocationIndex {
    sampleOffsets?: Float64Array;
    chunkOffsets: Float64Array;
    chunkFirstSamples: Float64Array;
    chunkSampleCounts: Uint32Array;
}

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Operation cancelled', 'AbortError');
};

const parseAudioSampleTable = async (file: Blob, options: AnalyzeOptions) => {
    registerPcmSampleEntries();
    options.onProgress?.(5);
    const { location, buffer } = await readMp4BoxBuffer(file, 'moov');
    throwIfAborted(options.signal);
    options.onProgress?.(20);

    const registry = BoxParser.box as unknown as Record<string, new (size?: number) => ParsedMoov>;
    const MoovBox = registry.moov;
    if (!MoovBox) throw new UnsupportedMp4AudioError('The MP4 parser cannot read movie metadata');

    const stream = new MultiBufferStream(buffer);
    stream.seek(location.offset + location.headerSize);
    const moov = new MoovBox(location.size);
    moov.hdr_size = location.headerSize;
    moov.start = location.offset;
    moov.parse(stream);
    throwIfAborted(options.signal);
    options.onProgress?.(35);

    const audioTrack = moov.traks?.find((track) => track.mdia?.hdlr?.handler === 'soun');
    const sampleTable = audioTrack?.mdia?.minf?.stbl;
    const timescale = Number(audioTrack?.mdia?.mdhd?.timescale || 0);
    const entry = sampleTable?.stsd?.entries?.[0];
    if (!sampleTable || !entry || !Number.isFinite(timescale) || timescale <= 0) {
        throw new UnsupportedMp4AudioError('The MP4 file does not contain a readable audio track');
    }

    return { sampleTable, timescale, entry };
};

const getAudioFormat = (entry: ParsedAudioEntry) => {
    const codec = String(entry.getCodec() || '').toLowerCase();
    let sampleRate = Number(entry.getSampleRate());
    let channelCount = Number(entry.getChannelCount());
    const sampleSize = Number(entry.getSampleSize());
    const codecMatch = /^mp4a\.40\.(\d+)$/i.exec(codec);

    if (codecMatch && Number(codecMatch[1]) === 2) {
        if (!AAC_SAMPLE_RATES.includes(sampleRate)) {
            throw new UnsupportedMp4AudioError(`Unsupported AAC sample rate: ${sampleRate}`);
        }
        if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 2) {
            throw new UnsupportedMp4AudioError(`Unsupported AAC channel count: ${channelCount}`);
        }
        return { codec, audioFormat: 'aac' as const, sampleRate, channelCount };
    }

    const syntheticTrack = {
        codec,
        audio: {
            sample_rate: sampleRate,
            channel_count: channelCount,
            sample_size: sampleSize
        }
    } as Track;
    const syntheticSample = { description: entry } as unknown as Sample;
    const pcmConfig = getPcmAudioConfig(syntheticTrack, syntheticSample);
    if (!pcmConfig || !syntheticTrack.audio) {
        throw new UnsupportedMp4AudioError(`Unsupported MP4 audio codec: ${codec || 'unknown'}`);
    }
    sampleRate = syntheticTrack.audio.sample_rate;
    channelCount = syntheticTrack.audio.channel_count;
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
        throw new UnsupportedMp4AudioError(`Unsupported PCM sample rate: ${sampleRate}`);
    }
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
        throw new UnsupportedMp4AudioError(`Unsupported PCM channel count: ${channelCount}`);
    }
    return { codec, audioFormat: 'wav' as const, sampleRate, channelCount, pcmConfig };
};

const createSampleSizeIndex = (
    table: ParsedSampleTable,
    audioFormat: 'aac' | 'wav'
): SampleSizeIndex => {
    const compactSizes = table.stz2?.sample_sizes;
    const regularSizes = table.stsz?.sample_sizes;
    const constantSize = Number(table.stsz?.sample_size || 0);
    const sampleCount = Number(
        table.stsz?.sample_count
        || table.stz2?.sample_count
        || regularSizes?.length
        || compactSizes?.length
        || 0
    );
    const sampleLimit = constantSize > 0 && audioFormat === 'wav'
        ? MAX_COMPACT_PCM_SAMPLES
        : MAX_AUDIO_SAMPLES;
    if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0 || sampleCount > sampleLimit) {
        throw new UnsupportedMp4AudioError('The MP4 audio sample count is invalid or too large');
    }

    if (constantSize > 0) {
        if (!Number.isSafeInteger(constantSize) || constantSize > 0xffffffff) {
            throw new UnsupportedMp4AudioError('The MP4 audio sample size is invalid');
        }
        if (audioFormat === 'wav') {
            return { sampleCount, constantSampleSize: constantSize };
        }
        const sizes = new Uint32Array(sampleCount);
        sizes.fill(constantSize);
        return { sampleCount, sampleSizes: sizes };
    }

    const source = regularSizes?.length ? regularSizes : compactSizes;
    if (!source || source.length !== sampleCount) {
        throw new UnsupportedMp4AudioError('The MP4 audio sample-size table is incomplete');
    }
    const sizes = new Uint32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) {
        const size = Number(source[index]);
        if (!Number.isSafeInteger(size) || size <= 0 || size > 0xffffffff) {
            throw new UnsupportedMp4AudioError('The MP4 audio sample size is invalid');
        }
        sizes[index] = size;
    }
    return { sampleCount, sampleSizes: sizes };
};

const createSampleLocationIndex = (
    table: ParsedSampleTable,
    sizeIndex: SampleSizeIndex,
    fileSize: number,
    options: AnalyzeOptions
): SampleLocationIndex => {
    const chunkOffsets = table.co64?.chunk_offsets?.length
        ? table.co64.chunk_offsets
        : table.stco?.chunk_offsets;
    const firstChunks = table.stsc?.first_chunk;
    const samplesPerChunk = table.stsc?.samples_per_chunk;
    const descriptionIndexes = table.stsc?.sample_description_index;
    if (
        !chunkOffsets?.length
        || chunkOffsets.length > MAX_AUDIO_CHUNKS
        || !firstChunks?.length
        || firstChunks.length !== samplesPerChunk?.length
        || firstChunks.length !== descriptionIndexes?.length
    ) {
        throw new UnsupportedMp4AudioError('The MP4 audio chunk table is incomplete');
    }
    if (firstChunks[0] !== 1) {
        throw new UnsupportedMp4AudioError('The MP4 audio chunk table does not start at the first chunk');
    }
    for (let index = 1; index < firstChunks.length; index++) {
        if (!Number.isSafeInteger(firstChunks[index]) || firstChunks[index] <= firstChunks[index - 1]) {
            throw new UnsupportedMp4AudioError('The MP4 audio chunk table is not ordered');
        }
    }

    const sampleOffsets = sizeIndex.sampleSizes
        ? new Float64Array(sizeIndex.sampleCount)
        : undefined;
    const indexedChunkOffsets = new Float64Array(chunkOffsets.length);
    const chunkFirstSamples = new Float64Array(chunkOffsets.length);
    const chunkSampleCounts = new Uint32Array(chunkOffsets.length);
    let sampleIndex = 0;
    let runIndex = 0;
    for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length; chunkIndex++) {
        while (runIndex + 1 < firstChunks.length && firstChunks[runIndex + 1] <= chunkIndex) runIndex++;
        const count = Number(samplesPerChunk[runIndex]);
        const descriptionIndex = Number(descriptionIndexes[runIndex]);
        let sampleOffset = Number(chunkOffsets[chunkIndex - 1]);
        if (
            !Number.isSafeInteger(count)
            || count <= 0
            || count > 0xffffffff
            || descriptionIndex !== 1
            || !Number.isSafeInteger(sampleOffset)
            || sampleOffset < 0
        ) {
            throw new UnsupportedMp4AudioError('The MP4 switches audio sample descriptions or has an invalid chunk');
        }
        if (sampleIndex + count > sizeIndex.sampleCount) {
            throw new UnsupportedMp4AudioError('The MP4 audio chunk table contains too many samples');
        }

        const arrayIndex = chunkIndex - 1;
        indexedChunkOffsets[arrayIndex] = sampleOffset;
        chunkFirstSamples[arrayIndex] = sampleIndex;
        chunkSampleCounts[arrayIndex] = count;

        if (sizeIndex.constantSampleSize !== undefined) {
            const chunkBytes = count * sizeIndex.constantSampleSize;
            if (!Number.isSafeInteger(chunkBytes) || sampleOffset + chunkBytes > fileSize) {
                throw new UnsupportedMp4AudioError('The MP4 audio index contains an invalid byte range');
            }
            sampleIndex += count;
        } else {
            const sampleSizes = sizeIndex.sampleSizes;
            if (!sampleSizes || !sampleOffsets) {
                throw new UnsupportedMp4AudioError('The MP4 audio sample index is missing');
            }
            for (let indexInChunk = 0; indexInChunk < count; indexInChunk++) {
                const size = sampleSizes[sampleIndex];
                if (sampleOffset + size > fileSize) {
                    throw new UnsupportedMp4AudioError('The MP4 audio index contains an invalid byte range');
                }
                sampleOffsets[sampleIndex] = sampleOffset;
                sampleOffset += size;
                sampleIndex++;
            }
        }

        if ((chunkIndex & 0x3ff) === 0) {
            throwIfAborted(options.signal);
            options.onProgress?.(35 + Math.round((sampleIndex / sizeIndex.sampleCount) * 35));
        }
    }
    if (sampleIndex !== sizeIndex.sampleCount) {
        throw new UnsupportedMp4AudioError('The MP4 audio chunk table does not cover every sample');
    }
    return {
        sampleOffsets,
        chunkOffsets: indexedChunkOffsets,
        chunkFirstSamples,
        chunkSampleCounts
    };
};

const readTimingRuns = (table: ParsedSampleTable, sampleCount: number) => {
    const counts = table.stts?.sample_counts;
    const deltas = table.stts?.sample_deltas;
    if (!counts?.length || counts.length !== deltas?.length) {
        throw new UnsupportedMp4AudioError('The MP4 audio timing table is incomplete');
    }

    let timedSamples = 0;
    for (let index = 0; index < counts.length; index++) {
        const count = Number(counts[index]);
        const delta = Number(deltas[index]);
        if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(delta) || delta <= 0) {
            throw new UnsupportedMp4AudioError('The MP4 audio timing data is invalid');
        }
        timedSamples += count;
        if (!Number.isSafeInteger(timedSamples) || timedSamples > sampleCount) {
            throw new UnsupportedMp4AudioError('The MP4 audio timing table contains too many samples');
        }
    }
    if (timedSamples !== sampleCount) {
        throw new UnsupportedMp4AudioError('The MP4 audio timing table does not cover every sample');
    }
    return { counts, deltas };
};

const buildVariableSegmentPlan = (
    table: ParsedSampleTable,
    sampleSizes: Uint32Array,
    timescale: number,
    maxDuration: number,
    maxBytes: number,
    audioFormat: 'aac' | 'wav',
    pcmConfig: PcmAudioConfig | undefined,
    options: AnalyzeOptions
): { segments: AacSegmentIndex[]; duration: number } => {
    const { counts: timingCounts, deltas: timingDeltas } = readTimingRuns(table, sampleSizes.length);

    const segments: AacSegmentIndex[] = [];
    const frameOverhead = audioFormat === 'aac' ? ADTS_HEADER_SIZE : 0;
    const segmentHeader = audioFormat === 'wav' ? WAV_HEADER_SIZE : 0;
    let timingRun = 0;
    let timingRemaining = Number(timingCounts[0]);
    let mediaTime = 0;
    let currentStartTime = 0;
    let currentEndTime = 0;
    let currentStartSample = 0;
    let currentBytes = 0;

    const commit = (sampleEnd: number) => {
        if (sampleEnd <= currentStartSample) return;
        segments.push({
            index: segments.length,
            startTime: currentStartTime,
            duration: Math.max(0, currentEndTime - currentStartTime),
            encodedBytes: currentBytes + segmentHeader,
            sampleStart: currentStartSample,
            sampleEnd
        });
        currentStartSample = sampleEnd;
        currentBytes = 0;
    };

    for (let sampleIndex = 0; sampleIndex < sampleSizes.length; sampleIndex++) {
        while (timingRemaining === 0 && timingRun + 1 < timingCounts.length) {
            timingRun++;
            timingRemaining = Number(timingCounts[timingRun]);
        }
        const delta = Number(timingDeltas[timingRun]);
        if (!Number.isSafeInteger(timingRemaining) || timingRemaining <= 0 || !Number.isFinite(delta) || delta <= 0) {
            throw new UnsupportedMp4AudioError('The MP4 audio timing data is invalid');
        }

        const sampleStartTime = mediaTime / timescale;
        const sampleEndTime = (mediaTime + delta) / timescale;
        const sampleSize = sampleSizes[sampleIndex];
        const frameBytes = sampleSize + frameOverhead;
        if (audioFormat === 'aac' && frameBytes > ADTS_MAX_FRAME_SIZE) {
            throw new UnsupportedMp4AudioError('An AAC frame is too large for an ADTS audio segment');
        }
        if (pcmConfig && sampleSize % pcmConfig.bytesPerSample !== 0) {
            throw new UnsupportedMp4AudioError('The PCM audio samples are not byte-aligned');
        }
        if (frameBytes + segmentHeader > maxBytes) {
            throw new UnsupportedMp4AudioError('An audio sample exceeds the audio-only segment limit');
        }

        if (currentBytes === 0) currentStartTime = sampleStartTime;
        const exceedsDuration = sampleEndTime - currentStartTime > maxDuration;
        const exceedsBytes = currentBytes + frameBytes + segmentHeader > maxBytes;
        if (currentBytes > 0 && (exceedsDuration || exceedsBytes)) {
            commit(sampleIndex);
            currentStartTime = sampleStartTime;
        }

        currentBytes += frameBytes;
        currentEndTime = sampleEndTime;
        mediaTime += delta;
        timingRemaining--;

        if ((sampleIndex & 0x3fff) === 0) {
            throwIfAborted(options.signal);
            options.onProgress?.(70 + Math.round((sampleIndex / sampleSizes.length) * 29));
        }
    }
    commit(sampleSizes.length);
    return { segments, duration: mediaTime / timescale };
};

const buildConstantPcmSegmentPlan = (
    table: ParsedSampleTable,
    sampleCount: number,
    sampleSize: number,
    timescale: number,
    maxDuration: number,
    maxBytes: number,
    pcmConfig: PcmAudioConfig | undefined,
    options: AnalyzeOptions
): { segments: AacSegmentIndex[]; duration: number } => {
    const { counts, deltas } = readTimingRuns(table, sampleCount);
    if (!pcmConfig || sampleSize % pcmConfig.bytesPerSample !== 0) {
        throw new UnsupportedMp4AudioError('The PCM audio samples are not byte-aligned');
    }

    const maxSamplesByBytes = Math.floor((maxBytes - WAV_HEADER_SIZE) / sampleSize);
    if (maxSamplesByBytes < 1) {
        throw new UnsupportedMp4AudioError('An audio sample exceeds the audio-only segment limit');
    }
    const maxDurationTicks = maxDuration * timescale;
    if (!Number.isFinite(maxDurationTicks) || maxDurationTicks <= 0) {
        throw new UnsupportedMp4AudioError('The audio segment duration limit is invalid');
    }

    const segments: AacSegmentIndex[] = [];
    let sampleIndex = 0;
    let mediaTicks = 0;
    let segmentStartSample = 0;
    let segmentStartTicks = 0;
    let segmentSamples = 0;

    const commit = () => {
        if (segmentSamples === 0) return;
        segments.push({
            index: segments.length,
            startTime: segmentStartTicks / timescale,
            duration: (mediaTicks - segmentStartTicks) / timescale,
            encodedBytes: WAV_HEADER_SIZE + segmentSamples * sampleSize,
            sampleStart: segmentStartSample,
            sampleEnd: sampleIndex
        });
        segmentStartSample = sampleIndex;
        segmentStartTicks = mediaTicks;
        segmentSamples = 0;
    };

    for (let runIndex = 0; runIndex < counts.length; runIndex++) {
        let remaining = Number(counts[runIndex]);
        const delta = Number(deltas[runIndex]);

        while (remaining > 0) {
            throwIfAborted(options.signal);
            const roomByBytes = maxSamplesByBytes - segmentSamples;
            const elapsedTicks = mediaTicks - segmentStartTicks;
            let roomByDuration = Math.floor((maxDurationTicks - elapsedTicks) / delta);
            if (segmentSamples === 0) roomByDuration = Math.max(1, roomByDuration);

            if (roomByBytes <= 0 || roomByDuration <= 0) {
                commit();
                continue;
            }

            const take = Math.min(remaining, roomByBytes, roomByDuration);
            sampleIndex += take;
            segmentSamples += take;
            mediaTicks += take * delta;
            if (!Number.isSafeInteger(mediaTicks)) {
                throw new UnsupportedMp4AudioError('The MP4 audio duration is too large');
            }
            remaining -= take;

            if (segmentSamples === maxSamplesByBytes || mediaTicks - segmentStartTicks >= maxDurationTicks) {
                commit();
            }
        }

        options.onProgress?.(70 + Math.round((sampleIndex / sampleCount) * 29));
    }
    commit();
    return { segments, duration: mediaTicks / timescale };
};

const buildSegmentPlan = (
    table: ParsedSampleTable,
    sizeIndex: SampleSizeIndex,
    timescale: number,
    maxDuration: number,
    maxBytes: number,
    audioFormat: 'aac' | 'wav',
    pcmConfig: PcmAudioConfig | undefined,
    options: AnalyzeOptions
): { segments: AacSegmentIndex[]; duration: number } => {
    if (sizeIndex.constantSampleSize !== undefined) {
        if (audioFormat !== 'wav') {
            throw new UnsupportedMp4AudioError('Only PCM audio can use the compact sample index');
        }
        return buildConstantPcmSegmentPlan(
            table,
            sizeIndex.sampleCount,
            sizeIndex.constantSampleSize,
            timescale,
            maxDuration,
            maxBytes,
            pcmConfig,
            options
        );
    }
    if (!sizeIndex.sampleSizes) {
        throw new UnsupportedMp4AudioError('The MP4 audio sample-size table is missing');
    }
    return buildVariableSegmentPlan(
        table,
        sizeIndex.sampleSizes,
        timescale,
        maxDuration,
        maxBytes,
        audioFormat,
        pcmConfig,
        options
    );
};

/** Build a compact audio-only byte index without expanding video samples. */
export const analyzeMp4Audio = async (
    file: Blob,
    options: AnalyzeOptions = {}
): Promise<Mp4AudioPlan> => {
    throwIfAborted(options.signal);
    const { sampleTable, timescale, entry } = await parseAudioSampleTable(file, options);
    const { codec, audioFormat, sampleRate, channelCount, pcmConfig } = getAudioFormat(entry);
    const sizeIndex = createSampleSizeIndex(sampleTable, audioFormat);
    const locationIndex = createSampleLocationIndex(sampleTable, sizeIndex, file.size, options);
    const { segments, duration } = buildSegmentPlan(
        sampleTable,
        sizeIndex,
        timescale,
        options.maxSegmentDurationSeconds || MAX_SEGMENT_DURATION_SECONDS,
        options.maxSegmentBytes || MAX_SEGMENT_BYTES,
        audioFormat,
        pcmConfig,
        options
    );
    throwIfAborted(options.signal);
    options.onProgress?.(100);

    return {
        codec,
        audioFormat,
        fileExtension: audioFormat,
        mimeType: audioFormat === 'aac' ? 'audio/aac' : 'audio/wav',
        sampleRate,
        channelCount,
        duration,
        encodedBytes: segments.reduce((sum, segment) => sum + segment.encodedBytes, 0),
        sampleCount: sizeIndex.sampleCount,
        sampleOffsets: locationIndex.sampleOffsets,
        sampleSizes: sizeIndex.sampleSizes,
        constantSampleSize: sizeIndex.constantSampleSize,
        chunkOffsets: locationIndex.chunkOffsets,
        chunkFirstSamples: locationIndex.chunkFirstSamples,
        chunkSampleCounts: locationIndex.chunkSampleCounts,
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
    const profile = 1;

    target[offset] = 0xff;
    target[offset + 1] = 0xf1;
    target[offset + 2] = (profile << 6) | (sampleRateIndex << 2) | (channelCount >> 2);
    target[offset + 3] = ((channelCount & 3) << 6) | ((frameLength >> 11) & 3);
    target[offset + 4] = (frameLength >> 3) & 0xff;
    target[offset + 5] = ((frameLength & 7) << 5) | 0x1f;
    target[offset + 6] = 0xfc;
};

const buildReadRanges = (entries: SampleOutputEntry[]): ReadRange[] => {
    const sortedEntries = [...entries].sort((a, b) => a.offset - b.offset);
    const ranges: ReadRange[] = [];

    for (const entry of sortedEntries) {
        const sampleEnd = entry.offset + entry.size;
        const current = ranges[ranges.length - 1];
        const canMerge = current
            && entry.offset - current.end <= MAX_RANGE_GAP
            && sampleEnd - current.start <= MAX_RANGE_SIZE;

        if (canMerge) {
            current.end = Math.max(current.end, sampleEnd);
            current.entries.push(entry);
        } else {
            ranges.push({ start: entry.offset, end: sampleEnd, entries: [entry] });
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

/** Build one standalone ADTS AAC or WAV segment by reading only its audio ranges. */
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

    if (plan.constantSampleSize !== undefined) {
        if (plan.audioFormat !== 'wav') {
            throw new UnsupportedMp4AudioError('The compact sample index can only build PCM audio');
        }
        const sampleSize = plan.constantSampleSize;
        let indexedBytes = 0;
        for (let chunkIndex = 0; chunkIndex < plan.chunkOffsets.length; chunkIndex++) {
            const chunkStart = plan.chunkFirstSamples[chunkIndex];
            const chunkEnd = chunkStart + plan.chunkSampleCounts[chunkIndex];
            const intersectionStart = Math.max(chunkStart, segment.sampleStart);
            const intersectionEnd = Math.min(chunkEnd, segment.sampleEnd);
            if (intersectionStart >= intersectionEnd) continue;

            const size = (intersectionEnd - intersectionStart) * sampleSize;
            entries.push({
                offset: plan.chunkOffsets[chunkIndex] + (intersectionStart - chunkStart) * sampleSize,
                size,
                payloadOffset: WAV_HEADER_SIZE + (intersectionStart - segment.sampleStart) * sampleSize
            });
            indexedBytes += size;
        }
        outputOffset = WAV_HEADER_SIZE + indexedBytes;
    } else {
        const sampleOffsets = plan.sampleOffsets;
        const sampleSizes = plan.sampleSizes;
        if (!sampleOffsets || !sampleSizes) {
            throw new UnsupportedMp4AudioError('The MP4 audio sample index is missing');
        }
        for (let sampleIndex = segment.sampleStart; sampleIndex < segment.sampleEnd; sampleIndex++) {
            const offset = sampleOffsets[sampleIndex];
            const size = sampleSizes[sampleIndex];
            if (plan.audioFormat === 'aac') {
                writeAdtsHeader(output, outputOffset, size, plan.sampleRate, plan.channelCount);
                entries.push({ offset, size, payloadOffset: outputOffset + ADTS_HEADER_SIZE });
                outputOffset += ADTS_HEADER_SIZE + size;
            } else {
                entries.push({ offset, size, payloadOffset: outputOffset });
                outputOffset += size;
            }
        }
    }
    if (outputOffset !== segment.encodedBytes) {
        throw new UnsupportedMp4AudioError('The audio segment index does not match its output size');
    }

    const ranges = buildReadRanges(entries);
    const totalReadBytes = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    let readBytes = 0;

    for (const range of ranges) {
        throwIfAborted(options.signal);
        const source = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer());
        for (const entry of range.entries) {
            const sourceOffset = entry.offset - range.start;
            output.set(source.subarray(sourceOffset, sourceOffset + entry.size), entry.payloadOffset);
            if (plan.audioFormat === 'wav' && plan.pcmConfig && !plan.pcmConfig.sourceLittleEndian) {
                swapPcmEndian(output, entry.payloadOffset, entry.size, plan.pcmConfig.bytesPerSample);
            }
        }
        readBytes += range.end - range.start;
        options.onProgress?.(totalReadBytes > 0 ? Math.round((readBytes / totalReadBytes) * 100) : 100);
    }

    return new Blob([output], { type: plan.mimeType });
};
