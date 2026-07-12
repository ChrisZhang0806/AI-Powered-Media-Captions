import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    createWavBuffer,
    decodeMediaToSpeechSegments,
    parseByteRange,
    PcmSpeechSegmenter
} from './streamingMedia.js';
import {
    attachUploadRuntime,
    notifyUploadChanged,
    streamUploadedRange
} from './resumableUpload.js';

const makePcm = (duration, amplitude) => {
    const samples = Math.round(16_000 * duration);
    const buffer = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index++) {
        buffer.writeInt16LE(amplitude === 0 ? 0 : (index % 2 === 0 ? amplitude : -amplitude), index * 2);
    }
    return buffer;
};

test('parses normal, open-ended, and suffix byte ranges', () => {
    assert.deepEqual(parseByteRange(undefined, 100), { start: 0, end: 99, partial: false });
    assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19, partial: true });
    assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99, partial: true });
    assert.deepEqual(parseByteRange('bytes=-8', 100), { start: 92, end: 99, partial: true });
    assert.equal(parseByteRange('bytes=100-101', 100), null);
});

test('segments PCM near silence and removes silent edges', () => {
    const segmenter = new PcmSpeechSegmenter({
        targetDuration: 0.5,
        maxDuration: 1,
        silenceDuration: 0.1,
        minimumSpeechDuration: 0.1,
        edgePaddingDuration: 0.02,
        silenceThreshold: 300
    });
    const source = Buffer.concat([
        makePcm(0.1, 0),
        makePcm(0.5, 2400),
        makePcm(0.5, 0)
    ]);
    const segments = [];
    for (let offset = 0; offset < source.length; offset += 777) {
        segments.push(...segmenter.push(source.subarray(offset, offset + 777)));
    }
    segments.push(...segmenter.finish());

    const speech = segments.filter((segment) => segment.hasSpeech);
    assert.equal(speech.length, 1);
    assert.ok(speech[0].startTime >= 0.06 && speech[0].startTime <= 0.1, speech[0].startTime);
    assert.ok(speech[0].duration >= 0.5 && speech[0].duration < 0.6, speech[0].duration);
    assert.ok(segments.some((segment) => !segment.hasSpeech));
});

test('wraps streaming PCM in a valid mono 16 kHz WAV file', () => {
    const pcm = makePcm(0.1, 1200);
    const wav = createWavBuffer(pcm);
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
});

test('decodes a moov-at-end MP4 while its chunks arrive', { timeout: 20_000 }, async (t) => {
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
        t.skip('FFmpeg is not installed');
        return;
    }

    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'caption-stream-test-'));
    const sourcePath = path.join(directory, 'source.mp4');
    const uploadPath = path.join(directory, 'upload.mp4');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

    const generated = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=3',
        '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=3',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac', '-shortest', sourcePath
    ]);
    assert.equal(generated.status, 0, generated.stderr?.toString());

    const source = await fs.promises.readFile(sourcePath);
    assert.ok(source.indexOf('moov') > source.indexOf('mdat'), 'fixture must keep MP4 metadata at the tail');
    const chunkSize = Math.max(1024, Math.ceil(source.length / 8));
    const totalChunks = Math.ceil(source.length / chunkSize);
    await fs.promises.writeFile(uploadPath, Buffer.alloc(0));
    await fs.promises.truncate(uploadPath, source.length);

    const task = attachUploadRuntime({
        taskId: 'integration',
        filePath: uploadPath,
        totalBytes: source.length,
        chunkSize,
        totalChunks,
        receivedChunks: new Set(),
        status: 'processing',
        cancelled: false
    });
    const server = createServer(async (req, res) => {
        const range = parseByteRange(req.headers.range, task.totalBytes);
        if (!range) {
            res.writeHead(416).end();
            return;
        }
        const headers = {
            'Accept-Ranges': 'bytes',
            'Content-Length': range.end - range.start + 1,
            'Content-Type': 'video/mp4'
        };
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${task.totalBytes}`;
        res.writeHead(range.partial ? 206 : 200, headers);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        await streamUploadedRange(task, range.start, range.end, res);
        res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const uploadChunk = async (chunkIndex) => {
        const start = chunkIndex * chunkSize;
        const end = Math.min(source.length, start + chunkSize);
        const handle = await fs.promises.open(uploadPath, 'r+');
        try {
            await handle.write(source.subarray(start, end), 0, end - start, start);
        } finally {
            await handle.close();
        }
        task.receivedChunks.add(chunkIndex);
        notifyUploadChanged(task);
    };
    const order = [0, totalChunks - 1];
    for (let index = 1; index < totalChunks - 1; index++) order.push(index);

    const speechSegments = [];
    const decodePromise = decodeMediaToSpeechSegments({
        inputUrl: `http://127.0.0.1:${address.port}/media`,
        segmentOptions: {
            targetDuration: 0.6,
            maxDuration: 0.8,
            silenceThreshold: 100
        },
        onSegment: async (segment) => {
            if (segment.hasSpeech) speechSegments.push(segment);
        }
    });
    const uploadPromise = (async () => {
        for (const chunkIndex of [...new Set(order)]) {
            await uploadChunk(chunkIndex);
            await new Promise((resolve) => setTimeout(resolve, 8));
        }
    })();

    await Promise.all([decodePromise, uploadPromise]);
    assert.ok(speechSegments.length >= 3);
    assert.ok(speechSegments.reduce((total, segment) => total + segment.duration, 0) > 2.5);
});
