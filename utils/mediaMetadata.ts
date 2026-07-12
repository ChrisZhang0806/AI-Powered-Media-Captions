import { createFile, type MP4BoxBuffer, type Movie } from 'mp4box';
import type { VideoMetadata } from '../types';
import { registerPcmSampleEntries } from './mp4PcmSupport';

const MAX_TOP_LEVEL_BOXES = 10_000;
const MAX_METADATA_BOX_SIZE = 128 * 1024 * 1024;

export interface Mp4BoxLocation {
    offset: number;
    size: number;
    headerSize: number;
    type: string;
}

const readBoxHeader = async (file: Blob, offset: number): Promise<Mp4BoxLocation | null> => {
    const header = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
    if (header.byteLength < 8) return null;

    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(...header.subarray(4, 8));
    let headerSize = 8;

    if (size === 1) {
        if (header.byteLength < 16) return null;
        const high = view.getUint32(8);
        const low = view.getUint32(12);
        size = high * 2 ** 32 + low;
        headerSize = 16;
    } else if (size === 0) {
        size = file.size - offset;
    }

    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > file.size) return null;
    return { offset, size, headerSize, type };
};

export const findMp4MetadataBoxes = async (file: Blob): Promise<Mp4BoxLocation[]> => {
    const boxes: Mp4BoxLocation[] = [];
    let offset = 0;

    for (let index = 0; index < MAX_TOP_LEVEL_BOXES && offset < file.size; index++) {
        const box = await readBoxHeader(file, offset);
        if (!box) break;
        if (box.type === 'ftyp' || box.type === 'moov') boxes.push(box);
        offset += box.size;
        if (box.type === 'moov') break;
    }

    return boxes;
};

export const readMp4MetadataBuffer = async (file: Blob): Promise<MP4BoxBuffer> => {
    const boxes = await findMp4MetadataBoxes(file);
    if (!boxes.some((box) => box.type === 'ftyp')) throw new Error('MP4 file type box was not found');
    if (!boxes.some((box) => box.type === 'moov')) throw new Error('MP4 metadata box was not found');
    const metadataParts: Uint8Array[] = [];
    let metadataSize = 0;
    for (const box of boxes) {
        if (box.size > MAX_METADATA_BOX_SIZE) {
            throw new Error('MP4 metadata box is too large to inspect safely');
        }
        const part = new Uint8Array(await file.slice(box.offset, box.offset + box.size).arrayBuffer());
        metadataParts.push(part);
        metadataSize += part.byteLength;
    }

    const combined = new Uint8Array(metadataSize);
    let writeOffset = 0;
    for (const part of metadataParts) {
        combined.set(part, writeOffset);
        writeOffset += part.byteLength;
    }

    const buffer = combined.buffer as MP4BoxBuffer;
    buffer.fileStart = 0;
    return buffer;
};

export const readMp4BoxBuffer = async (
    file: Blob,
    type: 'ftyp' | 'moov'
): Promise<{ location: Mp4BoxLocation; buffer: MP4BoxBuffer }> => {
    const boxes = await findMp4MetadataBoxes(file);
    const location = boxes.find((box) => box.type === type);
    if (!location) throw new Error(`MP4 ${type} box was not found`);
    if (location.size > MAX_METADATA_BOX_SIZE) {
        throw new Error(`MP4 ${type} box is too large to inspect safely`);
    }

    const buffer = await file.slice(location.offset, location.offset + location.size).arrayBuffer() as MP4BoxBuffer;
    buffer.fileStart = location.offset;
    return { location, buffer };
};

const parseMetadata = async (file: Blob): Promise<Movie> => {
    registerPcmSampleEntries();
    const parser = createFile(false);
    let info: Movie | null = null;
    let parserError: Error | null = null;

    parser.onReady = (movie) => {
        info = movie;
    };
    parser.onError = (module, message) => {
        if (!info) parserError = new Error(`${module}: ${message}`);
    };

    parser.appendBuffer(await readMp4MetadataBuffer(file), true);

    if (!info) throw parserError || new Error('MP4 metadata is unavailable');
    return info;
};

export type TechnicalVideoMetadata = Pick<
    VideoMetadata,
    | 'duration'
    | 'width'
    | 'height'
    | 'videoCodec'
    | 'audioCodec'
    | 'sampleRate'
    | 'audioChannels'
    | 'bitrate'
    | 'videoBitrate'
    | 'audioBitrate'
>;

/** Read MP4/MOV track metadata without reading or decoding the large mdat payload. */
export const inspectMp4Metadata = async (file: Blob): Promise<TechnicalVideoMetadata> => {
    const info = await parseMetadata(file);
    const duration = info.timescale > 0 ? info.duration / info.timescale : undefined;
    const videoTrack = info.videoTracks[0];
    const audioTrack = info.audioTracks[0];

    return {
        duration,
        width: videoTrack?.video?.width,
        height: videoTrack?.video?.height,
        videoCodec: videoTrack?.codec,
        audioCodec: audioTrack?.codec,
        sampleRate: audioTrack?.audio?.sample_rate,
        audioChannels: audioTrack?.audio?.channel_count,
        bitrate: duration ? (file.size * 8) / duration : undefined,
        videoBitrate: videoTrack?.bitrate,
        audioBitrate: audioTrack?.bitrate
    };
};
