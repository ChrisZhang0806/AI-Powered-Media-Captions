export const STANDARD_MP3_PROFILE = 'mp3-mono-16k-v1';

const TARGET_SAMPLE_RATE = 16_000;
const MAX_CHANNELS = 1;
const MAX_BITRATE = 80_000;
const MAX_DURATION_SECONDS = 305;

/** Check untrusted ffprobe output before bypassing server-side normalization. */
export function matchesStandardMp3Profile(metadata, fileSize) {
    const streams = Array.isArray(metadata?.streams) ? metadata.streams : [];
    const audio = streams.find((stream) => stream?.codec_type === 'audio');
    const format = metadata?.format || {};
    const duration = Number(audio?.duration || format.duration || 0);
    const measuredBitrate = duration > 0 && Number.isFinite(fileSize)
        ? (Number(fileSize) * 8) / duration
        : 0;
    const reportedBitrate = Number(audio?.bit_rate || format.bit_rate || 0);
    const bitrate = Math.max(measuredBitrate, reportedBitrate);
    const formatNames = String(format.format_name || '').split(',');

    return audio?.codec_name === 'mp3'
        && Number(audio.sample_rate) === TARGET_SAMPLE_RATE
        && Number(audio.channels) === MAX_CHANNELS
        && formatNames.includes('mp3')
        && Number.isFinite(duration)
        && duration > 0
        && duration <= MAX_DURATION_SECONDS
        && Number.isFinite(bitrate)
        && bitrate > 0
        && bitrate <= MAX_BITRATE;
}
