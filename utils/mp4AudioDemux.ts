import { createFile, type MP4BoxBuffer, type Movie, type Sample, type Track } from 'mp4box';

const SCAN_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_SEGMENT_DURATION_SECONDS = 300;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
const MAX_RANGE_GAP = 64 * 1024;
const MAX_RANGE_SIZE = 8 * 1024 * 1024;
const ADTS_HEADER_SIZE = 7;

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
    sampleRate: number;
    channelCount: number;
    duration: number;
    encodedBytes: number;
    segments: AacSegmentIndex[];
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
    outputOffset: number;
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

const validateAacTrack = (track: Track | undefined) => {
    if (!track?.audio) {
        throw new UnsupportedMp4AudioError('The MP4 file does not contain an audio track');
    }

    const codecMatch = /^mp4a\.40\.(\d+)$/i.exec(track.codec || '');
    if (!codecMatch || Number(codecMatch[1]) !== 2) {
        throw new UnsupportedMp4AudioError(`Unsupported MP4 audio codec: ${track.codec || 'unknown'}`);
    }

    const sampleRateIndex = AAC_SAMPLE_RATES.indexOf(track.audio.sample_rate);
    if (sampleRateIndex < 0) {
        throw new UnsupportedMp4AudioError(`Unsupported AAC sample rate: ${track.audio.sample_rate}`);
    }
    if (track.audio.channel_count < 1 || track.audio.channel_count > 2) {
        throw new UnsupportedMp4AudioError(`Unsupported AAC channel count: ${track.audio.channel_count}`);
    }

    return {
        sampleRate: track.audio.sample_rate,
        channelCount: track.audio.channel_count
    };
};

const buildSegmentPlan = (
    samples: AacSampleIndex[],
    maxDuration: number,
    maxBytes: number
): AacSegmentIndex[] => {
    const segments: AacSegmentIndex[] = [];
    let currentSamples: AacSampleIndex[] = [];
    let currentBytes = 0;
    let currentStart = 0;

    const commit = () => {
        if (currentSamples.length === 0) return;
        const last = currentSamples[currentSamples.length - 1];
        segments.push({
            index: segments.length,
            startTime: currentStart,
            duration: Math.max(0, getSampleEnd(last) - currentStart),
            encodedBytes: currentBytes,
            samples: currentSamples
        });
        currentSamples = [];
        currentBytes = 0;
    };

    for (const sample of samples) {
        const frameBytes = sample.size + ADTS_HEADER_SIZE;
        if (frameBytes > maxBytes) {
            throw new UnsupportedMp4AudioError('An AAC frame exceeds the fast-path segment limit');
        }

        if (currentSamples.length === 0) currentStart = getSampleStart(sample);
        const wouldExceedDuration = getSampleEnd(sample) - currentStart > maxDuration;
        const wouldExceedBytes = currentBytes + frameBytes > maxBytes;
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
 * Scan MP4 metadata without retaining mdat payloads, then build a byte-range plan
 * for the AAC-LC audio track. The scan reads local disk only; no media is uploaded.
 */
export const analyzeMp4Audio = async (
    file: Blob,
    options: AnalyzeOptions = {}
): Promise<Mp4AudioPlan> => {
    const parser = createFile(false);
    let info: Movie | null = null;
    let parserError: Error | null = null;

    parser.onReady = (movie) => {
        info = movie;
    };
    parser.onError = (module, message) => {
        parserError = new UnsupportedMp4AudioError(`${module}: ${message}`);
    };

    for (let offset = 0; offset < file.size; offset += SCAN_CHUNK_SIZE) {
        throwIfAborted(options.signal);
        const end = Math.min(file.size, offset + SCAN_CHUNK_SIZE);
        const buffer = await file.slice(offset, end).arrayBuffer() as unknown as MP4BoxBuffer;
        buffer.fileStart = offset;
        parser.appendBuffer(buffer, end === file.size);
        if (parserError) throw parserError;
        options.onProgress?.(Math.round((end / file.size) * 100));
    }

    parser.flush();
    if (parserError) throw parserError;
    if (!info?.hasMoov) {
        throw new UnsupportedMp4AudioError('The MP4 metadata could not be read');
    }

    const track = info.audioTracks[0];
    const { sampleRate, channelCount } = validateAacTrack(track);
    const samples = parser.getTrackSamplesInfo(track.id)
        .filter((sample) => sample.size > 0 && sample.timescale > 0)
        .map(copySampleIndex)
        .sort((a, b) => a.cts - b.cts || a.dts - b.dts);

    if (samples.length === 0) {
        throw new UnsupportedMp4AudioError('The AAC track contains no readable samples');
    }
    for (const sample of samples) {
        if (!Number.isSafeInteger(sample.offset) || sample.offset < 0 || sample.offset + sample.size > file.size) {
            throw new UnsupportedMp4AudioError('The MP4 audio index contains an invalid byte range');
        }
    }

    const segments = buildSegmentPlan(
        samples,
        options.maxSegmentDurationSeconds || MAX_SEGMENT_DURATION_SECONDS,
        options.maxSegmentBytes || MAX_SEGMENT_BYTES
    );
    const lastSample = samples[samples.length - 1];

    return {
        codec: track.codec,
        sampleRate,
        channelCount,
        duration: getSampleEnd(lastSample),
        encodedBytes: segments.reduce((sum, segment) => sum + segment.encodedBytes, 0),
        segments
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

/** Build a standalone ADTS AAC file for one indexed segment. */
export const buildAacSegment = async (
    file: Blob,
    plan: Mp4AudioPlan,
    segment: AacSegmentIndex,
    options: BuildOptions = {}
): Promise<Blob> => {
    const output = new Uint8Array(segment.encodedBytes);
    const entries: SampleOutputEntry[] = [];
    let outputOffset = 0;

    for (const sample of segment.samples) {
        entries.push({ sample, outputOffset });
        writeAdtsHeader(output, outputOffset, sample.size, plan.sampleRate, plan.channelCount);
        outputOffset += ADTS_HEADER_SIZE + sample.size;
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
                entry.outputOffset + ADTS_HEADER_SIZE
            );
        }
        readBytes += range.end - range.start;
        options.onProgress?.(totalReadBytes > 0 ? Math.round((readBytes / totalReadBytes) * 100) : 100);
    }

    return new Blob([output], { type: 'audio/aac' });
};
