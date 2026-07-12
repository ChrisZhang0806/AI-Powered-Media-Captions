import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const MANIFEST_SUFFIX = '.upload.json';

export function attachUploadRuntime(task) {
    if (!task.uploadEvents) {
        task.uploadEvents = new EventEmitter();
        task.uploadEvents.setMaxListeners(0);
    }
    task.manifestWrite = task.manifestWrite || Promise.resolve();
    return task;
}

export function notifyUploadChanged(task) {
    task?.uploadEvents?.emit('change');
}

function cancellationError() {
    const error = new Error('Upload is no longer available');
    error.name = 'AbortError';
    return error;
}

export function waitForUploadedChunk(task, chunkIndex, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || cancellationError());
    if (task.receivedChunks.has(chunkIndex)) return Promise.resolve();
    if (task.cancelled || ['error', 'cancelled'].includes(task.status)) return Promise.reject(cancellationError());

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            task.uploadEvents.off('change', check);
            signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
            cleanup();
            reject(signal?.reason instanceof Error ? signal.reason : cancellationError());
        };
        const check = () => {
            if (task.receivedChunks.has(chunkIndex)) {
                cleanup();
                resolve();
            } else if (task.cancelled || ['error', 'cancelled'].includes(task.status)) {
                cleanup();
                reject(cancellationError());
            }
        };

        task.uploadEvents.on('change', check);
        signal?.addEventListener('abort', abort, { once: true });
        check();
    });
}

async function waitForDrain(writable, signal) {
    if (signal?.aborted || writable.destroyed) throw cancellationError();
    await new Promise((resolve, reject) => {
        const cleanup = () => {
            writable.off('drain', onDrain);
            writable.off('close', onClose);
            signal?.removeEventListener('abort', onAbort);
        };
        const onDrain = () => {
            cleanup();
            resolve();
        };
        const onClose = () => {
            cleanup();
            reject(cancellationError());
        };
        const onAbort = () => {
            cleanup();
            reject(signal?.reason || cancellationError());
        };

        writable.once('drain', onDrain);
        writable.once('close', onClose);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}

/** Stream a requested byte interval, blocking at every not-yet-uploaded chunk. */
export async function streamUploadedRange(task, start, end, writable, signal) {
    let cursor = start;
    while (cursor <= end) {
        const chunkIndex = Math.floor(cursor / task.chunkSize);
        await waitForUploadedChunk(task, chunkIndex, signal);

        const chunkEnd = Math.min(end, (chunkIndex + 1) * task.chunkSize - 1, task.totalBytes - 1);
        const reader = fs.createReadStream(task.filePath, { start: cursor, end: chunkEnd });
        try {
            for await (const data of reader) {
                if (signal?.aborted || writable.destroyed) throw cancellationError();
                if (!writable.write(data)) await waitForDrain(writable, signal);
            }
        } finally {
            reader.destroy();
        }
        cursor = chunkEnd + 1;
    }
}

export class UploadManifestStore {
    constructor(directory) {
        this.directory = directory;
    }

    pathFor(taskId) {
        return path.join(this.directory, `${taskId}${MANIFEST_SUFFIX}`);
    }

    snapshot(task) {
        return {
            version: 1,
            taskId: task.taskId,
            uploadToken: task.uploadToken,
            filePath: task.filePath,
            fileName: task.fileName,
            mimeType: task.mimeType,
            totalBytes: task.totalBytes,
            uploadedBytes: task.uploadedBytes,
            chunkSize: task.chunkSize,
            totalChunks: task.totalChunks,
            receivedChunks: [...task.receivedChunks].sort((a, b) => a - b),
            uploadComplete: Boolean(task.uploadComplete),
            status: task.status,
            progress: task.progress,
            stage: task.stage,
            revision: task.revision || 0,
            captions: task.captions,
            error: task.error,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            config: {
                segmentStyle: task.config?.segmentStyle || 'natural',
                contextPrompt: task.config?.contextPrompt || '',
                uiLanguage: task.config?.uiLanguage || 'en'
            }
        };
    }

    persist(task) {
        if (!task?.resumable) return Promise.resolve();
        const manifestPath = this.pathFor(task.taskId);
        const snapshot = JSON.stringify(this.snapshot(task));
        task.manifestWrite = (task.manifestWrite || Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
                const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
                await fs.promises.writeFile(temporaryPath, snapshot, { mode: 0o600 });
                await fs.promises.rename(temporaryPath, manifestPath);
            });
        return task.manifestWrite;
    }

    async remove(taskId) {
        await fs.promises.rm(this.pathFor(taskId), { force: true });
    }

    async loadAll() {
        const entries = await fs.promises.readdir(this.directory, { withFileTypes: true });
        const manifests = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(MANIFEST_SUFFIX)) continue;
            const manifestPath = path.join(this.directory, entry.name);
            try {
                const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                manifests.push(manifest);
            } catch (error) {
                console.warn(`[Upload] Ignoring invalid manifest ${entry.name}:`, error.message);
                await fs.promises.rm(manifestPath, { force: true });
            }
        }
        return manifests;
    }
}
