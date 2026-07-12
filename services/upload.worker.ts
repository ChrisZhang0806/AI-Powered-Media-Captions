interface StartUploadMessage {
    type: 'start';
    file: File;
    serverUrl: string;
    taskId: string;
    uploadToken: string;
    chunkSize: number;
    totalChunks: number;
    receivedChunks: number[];
    concurrency: number;
}

interface CancelUploadMessage {
    type: 'cancel';
}

type UploadWorkerMessage = StartUploadMessage | CancelUploadMessage;

const activeRequests = new Set<XMLHttpRequest>();
let cancelled = false;
let highestReportedBytes = 0;
let lastProgressPostAt = 0;

const postProgress = (loaded: number, total: number, force = false) => {
    highestReportedBytes = Math.max(highestReportedBytes, loaded);
    const now = Date.now();
    if (!force && now - lastProgressPostAt < 250) return;
    lastProgressPostAt = now;
    self.postMessage({
        type: 'progress',
        loaded: highestReportedBytes,
        total,
        percent: total > 0 ? Math.min(100, Math.round((highestReportedBytes / total) * 100)) : 0
    });
};

const wait = (duration: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, duration);
});

const uploadChunk = (
    message: StartUploadMessage,
    chunkIndex: number,
    inFlightBytes: Map<number, number>,
    getCompletedBytes: () => number
): Promise<number> => {
    const start = chunkIndex * message.chunkSize;
    const end = Math.min(start + message.chunkSize, message.file.size);
    const chunk = message.file.slice(start, end);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeRequests.add(xhr);
        xhr.open(
            'PUT',
            `${message.serverUrl}/api/uploads/${message.taskId}/chunks/${chunkIndex}`
        );
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${message.file.size}`);
        xhr.setRequestHeader('X-Upload-Token', message.uploadToken);

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || cancelled) return;
            inFlightBytes.set(chunkIndex, event.loaded);
            const activeBytes = Array.from(inFlightBytes.values()).reduce((sum, value) => sum + value, 0);
            postProgress(getCompletedBytes() + activeBytes, message.file.size);
        };

        const finish = () => {
            activeRequests.delete(xhr);
            inFlightBytes.delete(chunkIndex);
        };

        xhr.onload = () => {
            finish();
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(chunk.size);
                return;
            }

            let detail = `HTTP ${xhr.status}`;
            try {
                detail = JSON.parse(xhr.responseText).error || detail;
            } catch {
                // Keep the HTTP status when the proxy returned a non-JSON response.
            }
            reject(new Error(detail));
        };

        xhr.onerror = () => {
            finish();
            reject(new Error('Network error'));
        };

        xhr.onabort = () => {
            finish();
            reject(new DOMException('Upload cancelled', 'AbortError'));
        };

        xhr.send(chunk);
    });
};

const runUpload = async (message: StartUploadMessage) => {
    cancelled = false;
    highestReportedBytes = 0;
    lastProgressPostAt = 0;
    const alreadyReceived = new Set(
        (message.receivedChunks || [])
            .filter((value) => Number.isInteger(value) && value >= 0 && value < message.totalChunks)
    );
    const chunkOrder: number[] = [];
    const lastChunk = message.totalChunks - 1;
    if (!alreadyReceived.has(0)) chunkOrder.push(0);
    if (lastChunk > 0 && !alreadyReceived.has(lastChunk)) chunkOrder.push(lastChunk);
    for (let chunkIndex = 1; chunkIndex < lastChunk; chunkIndex++) {
        if (!alreadyReceived.has(chunkIndex)) chunkOrder.push(chunkIndex);
    }

    let nextOrderIndex = 0;
    let completedBytes = [...alreadyReceived].reduce((total, chunkIndex) => {
        const start = chunkIndex * message.chunkSize;
        return total + Math.min(message.chunkSize, message.file.size - start);
    }, 0);
    const inFlightBytes = new Map<number, number>();
    postProgress(completedBytes, message.file.size, true);

    const uploadWithRetry = async (chunkIndex: number) => {
        const maxAttempts = 4;
        let lastError: unknown;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (cancelled) throw new DOMException('Upload cancelled', 'AbortError');

            try {
                const uploadedBytes = await uploadChunk(
                    message,
                    chunkIndex,
                    inFlightBytes,
                    () => completedBytes
                );
                completedBytes += uploadedBytes;
                postProgress(completedBytes, message.file.size, true);
                return;
            } catch (error) {
                lastError = error;
                if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
                    throw error;
                }
                if (attempt < maxAttempts - 1) {
                    await wait(500 * (2 ** attempt));
                }
            }
        }

        throw lastError instanceof Error ? lastError : new Error('Chunk upload failed');
    };

    const runner = async () => {
        while (!cancelled) {
            const chunkIndex = chunkOrder[nextOrderIndex++];
            if (chunkIndex === undefined) return;
            await uploadWithRetry(chunkIndex);
        }
    };

    const runnerCount = Math.max(1, Math.min(message.concurrency, message.totalChunks));
    await Promise.all(Array.from({ length: runnerCount }, () => runner()));

    if (!cancelled) {
        self.postMessage({ type: 'complete' });
    }
};

self.onmessage = (event: MessageEvent<UploadWorkerMessage>) => {
    if (event.data.type === 'cancel') {
        cancelled = true;
        activeRequests.forEach((request) => request.abort());
        activeRequests.clear();
        return;
    }

    runUpload(event.data).catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
            self.postMessage({ type: 'cancelled' });
            return;
        }
        self.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : 'Chunk upload failed'
        });
    });
};

export {};
