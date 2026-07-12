import {
    AdtsOutputFormat,
    BlobSource,
    BufferTarget,
    Conversion,
    FlacOutputFormat,
    Input,
    MATROSKA,
    MPEG_TS,
    MP4,
    Mp3OutputFormat,
    OggOutputFormat,
    Output,
    QTFF,
    WavOutputFormat,
    WEBM,
    type AudioCodec,
    type InputAudioTrack,
    type OutputFormat
} from 'mediabunny';

const MAX_SEGMENT_DURATION_SECONDS = 300;
const TARGET_SEGMENT_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

export type ContainerAudioFormat = 'aac' | 'wav' | 'mp3' | 'ogg' | 'flac';

export class UnsupportedContainerAudioError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedContainerAudioError';
    }
}

export interface ContainerAudioSegmentIndex {
    index: number;
    startTime: number;
    duration: number;
    encodedBytes: number;
}

export interface ContainerAudioPlan {
    codec: string;
    audioFormat: ContainerAudioFormat;
    fileExtension: ContainerAudioFormat;
    mimeType: string;
    sampleRate: number;
    channelCount: number;
    duration: number;
    encodedBytes: number;
    segments: ContainerAudioSegmentIndex[];
}

interface AnalyzeOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

interface BuildOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

interface OutputDescriptor {
    audioFormat: ContainerAudioFormat;
    mimeType: string;
    createFormat: () => OutputFormat;
}

const WAV_CODECS = new Set<AudioCodec>([
    'pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32', 'pcm-u8', 'ulaw', 'alaw'
]);

const abortError = (signal?: AbortSignal) => signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Container audio extraction cancelled', 'AbortError');

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw abortError(signal);
};

const getOutputDescriptor = (codec: AudioCodec): OutputDescriptor => {
    if (codec === 'aac') {
        return { audioFormat: 'aac', mimeType: 'audio/aac', createFormat: () => new AdtsOutputFormat() };
    }
    if (codec === 'mp3') {
        return { audioFormat: 'mp3', mimeType: 'audio/mpeg', createFormat: () => new Mp3OutputFormat() };
    }
    if (codec === 'opus' || codec === 'vorbis') {
        return { audioFormat: 'ogg', mimeType: 'application/ogg', createFormat: () => new OggOutputFormat() };
    }
    if (codec === 'flac') {
        return { audioFormat: 'flac', mimeType: 'audio/flac', createFormat: () => new FlacOutputFormat() };
    }
    if (WAV_CODECS.has(codec)) {
        return { audioFormat: 'wav', mimeType: 'audio/wav', createFormat: () => new WavOutputFormat() };
    }
    throw new UnsupportedContainerAudioError(`Unsupported container audio codec: ${codec}`);
};

const estimatePcmBitrate = (codec: AudioCodec, sampleRate: number, channelCount: number) => {
    if (codec === 'ulaw' || codec === 'alaw' || codec === 'pcm-u8') return sampleRate * channelCount * 8;
    if (codec === 'pcm-s16') return sampleRate * channelCount * 16;
    if (codec === 'pcm-s24') return sampleRate * channelCount * 24;
    if (codec === 'pcm-s32' || codec === 'pcm-f32') return sampleRate * channelCount * 32;
    return 0;
};

const fallbackBitrate = (codec: AudioCodec, sampleRate: number, channelCount: number) => {
    const pcmBitrate = estimatePcmBitrate(codec, sampleRate, channelCount);
    if (pcmBitrate > 0) return pcmBitrate;
    if (codec === 'opus') return 96_000;
    if (codec === 'flac') return 1_000_000;
    return 192_000;
};

export class ContainerAudioDemuxer {
    private readonly input: Input;
    private audioTrack: InputAudioTrack | null = null;
    private codec: AudioCodec | null = null;
    private descriptor: OutputDescriptor | null = null;
    private plan: ContainerAudioPlan | null = null;

    constructor(file: Blob) {
        this.input = new Input({
            source: new BlobSource(file, { maxCacheSize: SOURCE_CACHE_BYTES }),
            formats: [MATROSKA, WEBM, MPEG_TS, MP4, QTFF]
        });
    }

    async analyze(options: AnalyzeOptions = {}): Promise<ContainerAudioPlan> {
        throwIfAborted(options.signal);
        options.onProgress?.(5);
        if (!await this.input.canRead()) {
            throw new UnsupportedContainerAudioError('The container format cannot be read in this browser');
        }

        const track = await this.input.getPrimaryAudioTrack();
        if (!track) throw new UnsupportedContainerAudioError('The media file does not contain an audio track');
        const codec = await track.getCodec();
        if (!codec) throw new UnsupportedContainerAudioError('The container audio codec is unknown');
        const descriptor = getOutputDescriptor(codec);
        options.onProgress?.(25);

        const [sampleRate, channelCount, firstTimestamp, metadataEnd, reportedBitrate] = await Promise.all([
            track.getSampleRate(),
            track.getNumberOfChannels(),
            track.getFirstTimestamp(),
            track.getDurationFromMetadata({ skipLiveWait: true }),
            track.getAverageBitrate()
        ]);
        throwIfAborted(options.signal);
        const startTime = Math.max(0, Number(firstTimestamp) || 0);
        let endTime = Number(metadataEnd);
        if (!Number.isFinite(endTime) || endTime <= startTime) {
            endTime = await track.computeDuration({ skipLiveWait: true });
        }
        if (!Number.isFinite(endTime) || endTime <= startTime) {
            throw new UnsupportedContainerAudioError('The audio track duration cannot be determined');
        }
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(channelCount) || channelCount <= 0) {
            throw new UnsupportedContainerAudioError('The audio track metadata is invalid');
        }
        options.onProgress?.(55);

        const bitrate = Number.isFinite(reportedBitrate) && Number(reportedBitrate) > 0
            ? Number(reportedBitrate)
            : fallbackBitrate(codec, sampleRate, channelCount);
        const maxDurationByBytes = Math.floor((TARGET_SEGMENT_BYTES * 8) / Math.max(1, bitrate * 1.25));
        const segmentDuration = Math.max(1, Math.min(MAX_SEGMENT_DURATION_SECONDS, maxDurationByBytes));
        const segments: ContainerAudioSegmentIndex[] = [];

        for (let cursor = startTime; cursor < endTime; cursor += segmentDuration) {
            const segmentEnd = Math.min(endTime, cursor + segmentDuration);
            const duration = segmentEnd - cursor;
            segments.push({
                index: segments.length,
                startTime: cursor,
                duration,
                encodedBytes: Math.ceil((duration * bitrate) / 8) + 4096
            });
        }
        if (segments.length === 0) {
            throw new UnsupportedContainerAudioError('The audio track contains no readable segments');
        }

        const plan: ContainerAudioPlan = {
            codec,
            audioFormat: descriptor.audioFormat,
            fileExtension: descriptor.audioFormat,
            mimeType: descriptor.mimeType,
            sampleRate,
            channelCount,
            duration: endTime - startTime,
            encodedBytes: segments.reduce((sum, segment) => sum + segment.encodedBytes, 0),
            segments
        };
        this.audioTrack = track;
        this.codec = codec;
        this.descriptor = descriptor;
        this.plan = plan;
        options.onProgress?.(100);
        return plan;
    }

    async buildSegment(segmentIndex: number, options: BuildOptions = {}): Promise<Blob> {
        const track = this.audioTrack;
        const codec = this.codec;
        const descriptor = this.descriptor;
        const segment = this.plan?.segments[segmentIndex];
        if (!track || !codec || !descriptor || !segment) {
            throw new Error('Container audio analysis has not completed');
        }
        throwIfAborted(options.signal);

        const target = new BufferTarget();
        const output = new Output({ format: descriptor.createFormat(), target });
        const conversion = await Conversion.init({
            input: this.input,
            output,
            tracks: 'all',
            video: { discard: true },
            audio: (candidate) => candidate.id === track.id ? { codec } : { discard: true },
            trim: {
                start: segment.startTime,
                end: segment.startTime + segment.duration
            },
            tags: {},
            showWarnings: false
        });
        if (!conversion.isValid) {
            throw new UnsupportedContainerAudioError('The selected audio track cannot be remuxed safely');
        }

        conversion.onProgress = (progress) => options.onProgress?.(
            Math.max(0, Math.min(100, Math.round(progress * 100)))
        );
        const handleAbort = () => void conversion.cancel();
        options.signal?.addEventListener('abort', handleAbort, { once: true });
        try {
            await conversion.execute();
            throwIfAborted(options.signal);
        } finally {
            options.signal?.removeEventListener('abort', handleAbort);
        }

        const buffer = target.buffer;
        if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_SEGMENT_BYTES) {
            throw new UnsupportedContainerAudioError('The remuxed audio segment exceeds the upload limit');
        }
        return new Blob([buffer], { type: descriptor.mimeType });
    }

    dispose() {
        this.input.dispose();
        this.audioTrack = null;
        this.plan = null;
    }
}
