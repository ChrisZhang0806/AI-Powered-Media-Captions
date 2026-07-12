import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import {
    attachUploadRuntime,
    notifyUploadChanged,
    streamUploadedRange,
    UploadManifestStore
} from './resumableUpload.js';

test('range streaming waits for a missing middle chunk', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'caption-range-test-'));
    const filePath = path.join(directory, 'upload.bin');
    await fs.promises.writeFile(filePath, Buffer.from('abcdefghijkl'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

    const task = attachUploadRuntime({
        filePath,
        totalBytes: 12,
        chunkSize: 4,
        totalChunks: 3,
        receivedChunks: new Set([0, 2]),
        status: 'processing',
        cancelled: false
    });
    const output = [];
    const writable = new Writable({
        write(chunk, encoding, callback) {
            output.push(Buffer.from(chunk));
            callback();
        }
    });

    let finished = false;
    const streaming = streamUploadedRange(task, 0, 11, writable).then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(finished, false);
    assert.equal(Buffer.concat(output).toString(), 'abcd');

    task.receivedChunks.add(1);
    notifyUploadChanged(task);
    await streaming;
    assert.equal(Buffer.concat(output).toString(), 'abcdefghijkl');
});

test('upload manifests persist chunk state without persisting API keys', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'caption-manifest-test-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const store = new UploadManifestStore(directory);
    const task = attachUploadRuntime({
        resumable: true,
        taskId: 'task-id',
        uploadToken: 'upload-token',
        filePath: path.join(directory, 'task-id.mp4'),
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        totalBytes: 10,
        uploadedBytes: 8,
        chunkSize: 4,
        totalChunks: 3,
        receivedChunks: new Set([0, 1]),
        uploadComplete: false,
        status: 'uploading',
        progress: 16,
        stage: 'uploading',
        revision: 3,
        captions: [],
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        config: {
            segmentStyle: 'natural',
            contextPrompt: 'name: Ada',
            uiLanguage: 'en',
            apiKey: 'must-not-be-written'
        }
    });

    await store.persist(task);
    const [manifest] = await store.loadAll();
    assert.deepEqual(manifest.receivedChunks, [0, 1]);
    assert.equal(manifest.revision, 3);
    assert.equal(manifest.config.contextPrompt, 'name: Ada');
    assert.equal(JSON.stringify(manifest).includes('must-not-be-written'), false);
});
