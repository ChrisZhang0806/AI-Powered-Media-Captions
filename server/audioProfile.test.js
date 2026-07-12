import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesStandardMp3Profile } from './audioProfile.js';

const metadata = {
    streams: [{
        codec_type: 'audio',
        codec_name: 'mp3',
        sample_rate: '16000',
        channels: 1,
        bit_rate: '48000',
        duration: '120'
    }],
    format: {
        format_name: 'mp3',
        duration: '120',
        bit_rate: '48000'
    }
};

test('accepts a bounded mono 16 kHz MP3 transcription profile', () => {
    assert.equal(matchesStandardMp3Profile(metadata, 720_000), true);
});

test('rejects media that would require normalization', () => {
    assert.equal(matchesStandardMp3Profile({
        ...metadata,
        streams: [{ ...metadata.streams[0], sample_rate: '48000' }]
    }, 720_000), false);
    assert.equal(matchesStandardMp3Profile({
        ...metadata,
        streams: [{ ...metadata.streams[0], channels: 2 }]
    }, 720_000), false);
    assert.equal(matchesStandardMp3Profile({
        ...metadata,
        format: { ...metadata.format, format_name: 'wav' }
    }, 720_000), false);
});

test('rejects oversized bitrate and duration claims', () => {
    assert.equal(matchesStandardMp3Profile(metadata, 2_000_000), false);
    assert.equal(matchesStandardMp3Profile({
        ...metadata,
        streams: [{ ...metadata.streams[0], duration: '600' }],
        format: { ...metadata.format, duration: '600' }
    }, 3_600_000), false);
});
