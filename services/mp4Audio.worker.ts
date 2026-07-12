import {
    analyzeMp4Audio,
    buildAudioSegment,
    UnsupportedMp4AudioError,
    type Mp4AudioPlan
} from '../utils/mp4AudioDemux';

interface AnalyzeMessage {
    type: 'analyze';
    file: File;
}

interface BuildMessage {
    type: 'build';
    segmentIndex: number;
}

interface CancelMessage {
    type: 'cancel';
}

type WorkerMessage = AnalyzeMessage | BuildMessage | CancelMessage;

let mediaFile: File | null = null;
let audioPlan: Mp4AudioPlan | null = null;
let buildQueue = Promise.resolve();

const postError = (error: unknown, phase: 'analyze' | 'build', segmentIndex?: number) => {
    self.postMessage({
        type: 'error',
        phase,
        segmentIndex,
        unsupported: phase === 'analyze' || error instanceof UnsupportedMp4AudioError,
        message: error instanceof Error ? error.message : 'MP4 audio extraction failed'
    });
};

const analyze = async (file: File) => {
    mediaFile = file;
    audioPlan = null;
    try {
        const plan = await analyzeMp4Audio(file, {
            onProgress: (progress) => self.postMessage({ type: 'analysis-progress', progress })
        });
        audioPlan = plan;
        self.postMessage({
            type: 'ready',
            plan: {
                codec: plan.codec,
                audioFormat: plan.audioFormat,
                fileExtension: plan.fileExtension,
                mimeType: plan.mimeType,
                sampleRate: plan.sampleRate,
                channelCount: plan.channelCount,
                duration: plan.duration,
                encodedBytes: plan.encodedBytes,
                segments: plan.segments
            }
        });
    } catch (error) {
        postError(error, 'analyze');
    }
};

const build = async (segmentIndex: number) => {
    if (!mediaFile || !audioPlan) {
        postError(new Error('MP4 audio analysis has not completed'), 'build', segmentIndex);
        return;
    }
    const segment = audioPlan.segments[segmentIndex];
    if (!segment) {
        postError(new Error('MP4 audio segment does not exist'), 'build', segmentIndex);
        return;
    }

    try {
        const blob = await buildAudioSegment(mediaFile, audioPlan, segment);
        const buffer = await blob.arrayBuffer();
        self.postMessage({
            type: 'segment',
            segmentIndex,
            startTime: segment.startTime,
            encodedBytes: segment.encodedBytes,
            mimeType: audioPlan.mimeType,
            fileExtension: audioPlan.fileExtension,
            buffer
        }, { transfer: [buffer] });
    } catch (error) {
        postError(error, 'build', segmentIndex);
    }
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (event.data.type === 'cancel') {
        self.close();
        return;
    }
    if (event.data.type === 'analyze') {
        void analyze(event.data.file);
        return;
    }

    const segmentIndex = event.data.segmentIndex;
    buildQueue = buildQueue.then(() => build(segmentIndex));
};

export {};
