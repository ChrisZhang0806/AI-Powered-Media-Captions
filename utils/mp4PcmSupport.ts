import {
    AudioSampleEntry,
    BoxParser,
    type MultiBufferStream,
    type Sample,
    type Track
} from 'mp4box';

class LpcmSampleEntry extends AudioSampleEntry {
    static readonly fourcc = 'lpcm' as const;
    box_name = 'LinearPCMAudioSampleEntry' as const;

    parse(stream: MultiBufferStream) {
        this.parseHeader(stream);
        this.version = stream.readUint16();
        stream.readUint16();
        stream.readUint32();
        this.channel_count = stream.readUint16();
        this.samplesize = stream.readUint16();
        stream.readUint16();
        stream.readUint16();
        this.samplerate = stream.readUint32() / (1 << 16);

        if (this.version === 1) this.extensions = stream.readUint8Array(16);
        else if (this.version === 2) {
            this.extensions = stream.readUint8Array(36);
            const view = new DataView(
                this.extensions.buffer,
                this.extensions.byteOffset,
                this.extensions.byteLength
            );
            this.samplerate = view.getFloat64(4) || this.samplerate;
            this.channel_count = view.getUint32(12) || this.channel_count;
            this.samplesize = view.getUint32(20) || this.samplesize;
        }

        this.parseFooter(stream);
    }
}

class TwosSampleEntry extends AudioSampleEntry {
    static readonly fourcc = 'twos' as const;
    box_name = 'BigEndianPCMAudioSampleEntry' as const;
}

class SowtSampleEntry extends AudioSampleEntry {
    static readonly fourcc = 'sowt' as const;
    box_name = 'LittleEndianPCMAudioSampleEntry' as const;
}

class In24SampleEntry extends AudioSampleEntry {
    static readonly fourcc = 'in24' as const;
    box_name = '24BitPCMAudioSampleEntry' as const;
}

class In32SampleEntry extends AudioSampleEntry {
    static readonly fourcc = 'in32' as const;
    box_name = '32BitPCMAudioSampleEntry' as const;
}

/** MP4Box does not register common camera PCM sample entries by default. */
export const registerPcmSampleEntries = () => {
    const entries = BoxParser.sampleEntry as unknown as Record<string, typeof AudioSampleEntry>;
    entries.lpcm ??= LpcmSampleEntry;
    entries.twos ??= TwosSampleEntry;
    entries.sowt ??= SowtSampleEntry;
    entries.in24 ??= In24SampleEntry;
    entries.in32 ??= In32SampleEntry;
};

export interface PcmAudioConfig {
    bitsPerSample: number;
    bytesPerSample: number;
    sourceLittleEndian: boolean;
    wavFormat: 1 | 3;
}

interface PcmDescription {
    version?: number;
    extensions?: Uint8Array;
}

const PCM_CODECS = new Set(['lpcm', 'twos', 'sowt', 'in24', 'in32']);

export const getPcmAudioConfig = (track: Track, sample: Sample): PcmAudioConfig | null => {
    const codec = (track.codec || '').toLowerCase();
    if (!PCM_CODECS.has(codec) || !track.audio) return null;

    let bitsPerSample = track.audio.sample_size;
    let bytesPerSample = Math.ceil(bitsPerSample / 8);
    let sourceLittleEndian = codec === 'sowt';
    let wavFormat: 1 | 3 = 1;

    const description = sample.description as unknown as PcmDescription;
    if (codec === 'lpcm' && description.version === 2 && description.extensions?.byteLength === 36) {
        const extension = description.extensions;
        const view = new DataView(extension.buffer, extension.byteOffset, extension.byteLength);
        const sampleRate = view.getFloat64(4);
        const channelCount = view.getUint32(12);
        bitsPerSample = view.getUint32(20);
        const flags = view.getUint32(24);
        const bytesPerPacket = view.getUint32(28);
        const framesPerPacket = view.getUint32(32);

        if (flags & 0x20) return null;
        wavFormat = flags & 0x1 ? 3 : 1;
        sourceLittleEndian = (flags & 0x2) === 0;
        if (sampleRate > 0) track.audio.sample_rate = sampleRate;
        if (channelCount > 0) track.audio.channel_count = channelCount;
        if (bytesPerPacket > 0 && framesPerPacket > 0 && channelCount > 0) {
            bytesPerSample = bytesPerPacket / framesPerPacket / channelCount;
        }
    } else if (codec === 'in24') {
        bitsPerSample = 24;
        bytesPerSample = 3;
    } else if (codec === 'in32') {
        bitsPerSample = 32;
        bytesPerSample = 4;
    }

    const validIntegerDepth = wavFormat === 1 && [16, 24, 32].includes(bitsPerSample);
    const validFloatDepth = wavFormat === 3 && [32, 64].includes(bitsPerSample);
    if ((!validIntegerDepth && !validFloatDepth)
        || !Number.isInteger(bytesPerSample)
        || bytesPerSample !== Math.ceil(bitsPerSample / 8)) {
        return null;
    }

    return { bitsPerSample, bytesPerSample, sourceLittleEndian, wavFormat };
};
