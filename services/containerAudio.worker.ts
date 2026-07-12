import {
    ContainerAudioDemuxer,
    UnsupportedContainerAudioError,
    type ContainerAudioPlan
} from '../utils/containerAudioDemux';

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

let demuxer: ContainerAudioDemuxer | null = null;
let plan: ContainerAudioPlan | null = null;
let buildQueue = Promise.resolve();

const postError = (error: unknown, phase: 'analyze' | 'build', segmentIndex?: number) => {
    self.postMessage({
        type: 'error',
        phase,
        segmentIndex,
        unsupported: phase === 'analyze' || error instanceof UnsupportedContainerAudioError,
        message: error instanceof Error ? error.message : 'Container audio extraction failed'
    });
};

const analyze = async (file: File) => {
    demuxer?.dispose();
    demuxer = new ContainerAudioDemuxer(file);
    plan = null;
    try {
        plan = await demuxer.analyze({
            onProgress: (progress) => self.postMessage({ type: 'analysis-progress', progress })
        });
        self.postMessage({ type: 'ready', plan });
    } catch (error) {
        postError(error, 'analyze');
    }
};

const build = async (segmentIndex: number) => {
    const segment = plan?.segments[segmentIndex];
    if (!demuxer || !plan || !segment) {
        postError(new Error('Container audio analysis has not completed'), 'build', segmentIndex);
        return;
    }

    try {
        const blob = await demuxer.buildSegment(segmentIndex);
        const buffer = await blob.arrayBuffer();
        self.postMessage({
            type: 'segment',
            segmentIndex,
            startTime: segment.startTime,
            encodedBytes: buffer.byteLength,
            mimeType: plan.mimeType,
            fileExtension: plan.fileExtension,
            buffer
        }, { transfer: [buffer] });
    } catch (error) {
        postError(error, 'build', segmentIndex);
    }
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (event.data.type === 'cancel') {
        demuxer?.dispose();
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
