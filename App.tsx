import React, { useState, useRef } from 'react';
import { AppStatus, CaptionSegment, VideoMetadata, ProgressInfo, SegmentStyle } from './types';
import { transcribeWithServer, checkServerHealth, cancelServerTranscription } from './services/serverService';
import { parseCaptions } from './utils/captionUtils';
import { useAudioAnalyser } from './hooks/useAudioAnalyser';
import { useMediaSync } from './hooks/useMediaSync';
import { useApiKey } from './hooks/useApiKey';
import { Language, getTranslation, isLanguage } from './utils/i18n';

// Components
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { MediaPlayer } from './components/MediaPlayer';
import { ControlsPanel } from './components/ControlsPanel';
import { SubtitleList } from './components/SubtitleList';
import { MaterialIcon } from './components/MaterialIcon';

const hasDraggedFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024;
const MAX_BROWSER_METADATA_BYTES = 256 * 1024 * 1024;
const SUPPORTED_FILE_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'ts', 'mp3', 'wav', 'm4a', 'aac', 'srt', 'vtt']);

const isSupportedFile = (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return file.type.startsWith('video/') || file.type.startsWith('audio/') || SUPPORTED_FILE_EXTENSIONS.has(extension);
};

const App: React.FC = () => {
    // State Management
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
    const [captions, setCaptions] = useState<CaptionSegment[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [uiLanguage, setUiLanguage] = useState<Language>(() => {
        const savedLanguage = localStorage.getItem('ui_language');
        if (isLanguage(savedLanguage)) return savedLanguage;
        return /^(zh-tw|zh-hk|zh-mo)/i.test(navigator.language) ? 'zh-TW' : 'zh';
    });
    const t = getTranslation(uiLanguage);

    React.useEffect(() => {
        document.documentElement.lang = uiLanguage === 'zh' ? 'zh-CN' : uiLanguage;
        document.title = t.brand;
    }, [t.brand, uiLanguage]);

    const segmentStyle: SegmentStyle = 'natural';
    const [contextPrompt, setContextPrompt] = useState('');
    const [isLeftDropActive, setIsLeftDropActive] = useState(false);

    // Editing State
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');

    const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);

    // Refs
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const processingAbortRef = useRef<AbortController | null>(null);
    const previewUrlRef = useRef<string | null>(null);
    const metadataInspectionRef = useRef(0);

    React.useEffect(() => () => {
        metadataInspectionRef.current++;
        processingAbortRef.current?.abort();
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    // Custom Hooks
    const apiKeyData = useApiKey(uiLanguage);
    const isAudio = videoMeta?.type.startsWith('audio/') || false;

    useAudioAnalyser({ mediaRef, canvasRef, isAudio });
    const { activeCaption, jumpToTime } = useMediaSync({ mediaRef, captions });

    // File Processing Logic
    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();

        // Check if it's a subtitle file
        if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) {
            const text = await file.text();
            const parsedCaptions = parseCaptions(text);

            if (parsedCaptions.length > 0) {
                metadataInspectionRef.current++;
                cancelServerTranscription(processingAbortRef.current);
                processingAbortRef.current = null;
                if (previewUrlRef.current) {
                    URL.revokeObjectURL(previewUrlRef.current);
                    previewUrlRef.current = null;
                }
                setCaptions(parsedCaptions);
                setVideoFile(null);
                setVideoMeta({
                    name: file.name,
                    size: file.size,
                    type: 'text/vtt',
                    url: ''
                });
                setStatus(AppStatus.SUCCESS);
                setErrorMsg('');
            } else {
                setErrorMsg(t.errorInvalidSub);
            }
            return;
        }

        // For .ts (MPEG Transport Stream) files, browser may report incorrect MIME type
        const fileType = fileName.endsWith('.ts') && !file.type.startsWith('video/')
            ? 'video/mp2t'
            : file.type;

        const inspectionId = ++metadataInspectionRef.current;
        cancelServerTranscription(processingAbortRef.current);
        processingAbortRef.current = null;
        const previewAvailable = !fileName.endsWith('.ts');
        const previewUrl = previewAvailable ? URL.createObjectURL(file) : '';
        const extension = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() : undefined;
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
        }
        previewUrlRef.current = previewUrl || null;

        setVideoFile(file);
        setCaptions([]);
        setVideoMeta({
            name: file.name,
            size: file.size,
            type: fileType,
            url: previewUrl,
            previewAvailable,
            container: extension || fileType.split('/').pop()?.toUpperCase()
        });
        setErrorMsg('');
        setStatus(AppStatus.IDLE);
        setProgressInfo(null);

        if (
            file.size <= MAX_BROWSER_METADATA_BYTES
            && ['mp4', 'm4v', 'mov'].some((extensionName) => fileName.endsWith(`.${extensionName}`))
        ) {
            void import('./utils/mediaMetadata')
                .then(({ inspectMp4Metadata }) => inspectMp4Metadata(file))
                .then((technicalMetadata) => {
                    if (metadataInspectionRef.current !== inspectionId) return;
                    setVideoMeta((current) => current ? { ...current, ...technicalMetadata } : current);
                })
                .catch(() => {
                    // Browser metadata still provides duration and dimensions when MP4 details are unavailable.
                });
        }
    };

    const handleFileSelect = async (file: File) => {
        if (!file.name || file.size <= 0) {
            setErrorMsg(t.errorInvalidFile);
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            setErrorMsg(t.errorFileTooLarge);
            return;
        }
        if (!isSupportedFile(file)) {
            setErrorMsg(t.errorUnsupportedFile);
            return;
        }

        const hasWorkToLose = captions.length > 0 || status === AppStatus.PROCESSING;
        if (hasWorkToLose && !window.confirm(t.confirmReset)) return;

        await processFile(file);
    };

    const handleLeftDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setIsLeftDropActive(true);
    };

    const handleLeftDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setIsLeftDropActive(true);
    };

    const handleLeftDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            setIsLeftDropActive(false);
        }
    };

    const handleLeftDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        const file = event.dataTransfer.files?.[0];
        if (!file && !hasDraggedFiles(event)) return;

        event.preventDefault();
        event.stopPropagation();
        setIsLeftDropActive(false);
        if (!file) return;
        await handleFileSelect(file);
    };

    const handleMediaMetadata = (metadata: Pick<VideoMetadata, 'duration' | 'width' | 'height'>) => {
        setVideoMeta((current) => {
            if (!current) return current;
            const duration = metadata.duration || current.duration;
            return {
                ...current,
                ...metadata,
                bitrate: current.bitrate || (duration ? (current.size * 8) / duration : undefined)
            };
        });
    };

    // Auto-scroll to bottom of subtitle list
    const scrollToBottom = () => {
        const listContainer = document.getElementById('subtitle-list-container');
        if (listContainer) {
            listContainer.scrollTo({
                top: listContainer.scrollHeight,
                behavior: 'smooth'
            });
        }
    };

    // AI Processing Logic
    const handleProcess = async () => {
        if (!videoFile) return;

        // Check if API Key exists
        if (!apiKeyData.userApiKey) {
            setErrorMsg(t.errorNoApiKey);
            apiKeyData.openPanel();
            return;
        }

        cancelServerTranscription(processingAbortRef.current);
        const controller = new AbortController();
        processingAbortRef.current = controller;

        setStatus(AppStatus.PROCESSING);
        setErrorMsg('');
        setCaptions([]);
        setProgressInfo(null);

        try {
            const userApiKey = apiKeyData.userApiKey;

            const isServerAvailable = await checkServerHealth();
            if (!isServerAvailable) {
                throw new Error(t.errorServerUnavailable);
            }

            await transcribeWithServer(
                videoFile,
                segmentStyle,
                contextPrompt,
                (streamedSegments) => {
                    if (controller.signal.aborted) return;
                    setCaptions(streamedSegments);
                    scrollToBottom();
                },
                (info) => {
                    if (!controller.signal.aborted) setProgressInfo(info);
                },
                userApiKey,
                uiLanguage,
                controller.signal
            );

            if (controller.signal.aborted) return;
            setStatus(AppStatus.SUCCESS);
            setProgressInfo(null);
        } catch (err: any) {
            if (controller.signal.aborted) return;
            setStatus(AppStatus.ERROR);
            setErrorMsg(err.message || t.errorProcessFailed);
            setProgressInfo(null);
        } finally {
            if (processingAbortRef.current === controller) {
                processingAbortRef.current = null;
            }
        }
    };

    const handleReset = () => {
        const hasWorkToLose = captions.length > 0 || status === AppStatus.PROCESSING;
        if (hasWorkToLose && !window.confirm(t.confirmReset)) {
            return;
        }

        metadataInspectionRef.current++;
        setVideoFile(null);
        setVideoMeta(null);
        setCaptions([]);
        cancelServerTranscription(processingAbortRef.current);
        processingAbortRef.current = null;
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
        }
        setStatus(AppStatus.IDLE);
        setProgressInfo(null);
        setErrorMsg('');
    };

    const handleEditSave = () => {
        if (editingId !== null) {
            setCaptions(c => c.map(x => x.id === editingId ? { ...x, text: editText } : x));
            setEditingId(null);
        }
    };

    return (
        <div className="app-shell flex min-h-screen flex-col font-sans text-on-surface">
            <Header
                apiKeyData={apiKeyData}
                onApiKeySuccess={() => setErrorMsg('')}
                uiLanguage={uiLanguage}
                setUiLanguage={(l) => {
                    setUiLanguage(l);
                    localStorage.setItem('ui_language', l);
                }}
            />

            <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-visible px-4 py-4 sm:px-6 sm:py-6 lg:overflow-hidden lg:pt-0">
                {errorMsg && (
                    <div className="mb-4 flex items-start gap-2 rounded-xl border border-error/20 bg-error-container p-3 text-on-error-container" role="alert">
                        <MaterialIcon name="error" size={18} className="mt-px text-error" />
                        <p className="text-xs">{errorMsg}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-68px)] lg:grid-cols-12">
                    {/* Left Panel: Media, upload, and processing controls */}
                    <div
                        className="relative flex min-h-0 flex-col gap-4 rounded-2xl lg:col-span-4"
                        onDragEnter={handleLeftDragEnter}
                        onDragOver={handleLeftDragOver}
                        onDragLeave={handleLeftDragLeave}
                        onDrop={handleLeftDrop}
                    >
                        <MediaPlayer
                            videoMeta={videoMeta}
                            isAudio={isAudio}
                            mediaRef={mediaRef}
                            canvasRef={canvasRef}
                            activeCaption={activeCaption}
                            uiLanguage={uiLanguage}
                            onMetadataLoaded={handleMediaMetadata}
                        />

                        {!videoFile && <FileUploader onFileSelect={handleFileSelect} uiLanguage={uiLanguage} />}

                        {videoFile && (
                            <ControlsPanel
                                videoMeta={videoMeta}
                                isAudio={isAudio}
                                status={status}
                                contextPrompt={contextPrompt}
                                setContextPrompt={setContextPrompt}
                                progressInfo={progressInfo}
                                captionsCount={captions.length}
                                uiLanguage={uiLanguage}
                                onReset={handleReset}
                                onProcess={handleProcess}
                            />
                        )}

                        {isLeftDropActive && (
                            <div
                                className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-primary-fixed/95 px-6 text-center shadow-lg backdrop-blur-sm"
                                aria-hidden="true"
                            >
                                <MaterialIcon name="upload" size={40} className="text-primary" />
                                <p className="text-sm font-semibold text-on-primary-fixed">{t.dropFileHere}</p>
                                <p className="text-xs text-on-primary-fixed/70">{t.supportFormat}</p>
                            </div>
                        )}
                    </div>

                    {/* Right Panel: Subtitle List */}
                    <div className="min-h-0 lg:col-span-8">
                        <SubtitleList
                            isSubtitleOnly={!videoFile && captions.length > 0}
                            captions={captions}
                            activeCaption={activeCaption}
                            videoMeta={videoMeta}
                            editingId={editingId}
                            editText={editText}
                            uiLanguage={uiLanguage}

                            onJump={jumpToTime}
                            onEditStart={(id, text) => { setEditingId(id); setEditText(text); }}
                            onEditChange={setEditText}
                            onEditSave={handleEditSave}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
