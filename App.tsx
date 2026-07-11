import React, { useState, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { AppStatus, CaptionSegment, VideoMetadata, ExportFormat, CaptionMode, ProgressInfo, SegmentStyle } from './types';
import { transcribeWithServer, checkServerHealth } from './services/serverService';
import { translateSegments } from './services/openaiService';
import { parseCaptions } from './utils/captionUtils';
import { detectLanguage } from './utils/helpers';
import { useAudioAnalyser } from './hooks/useAudioAnalyser';
import { useMediaSync } from './hooks/useMediaSync';
import { useApiKey } from './hooks/useApiKey';
import { Language, getTranslation } from './utils/i18n';

// Components
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { MediaPlayer } from './components/MediaPlayer';
import { ControlsPanel } from './components/ControlsPanel';
import { SubtitleList } from './components/SubtitleList';

const App: React.FC = () => {
    // State Management
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
    const [captions, setCaptions] = useState<CaptionSegment[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [uiLanguage, setUiLanguage] = useState<Language>(() => {
        return (localStorage.getItem('ui_language') as Language) || 'en';
    });
    const t = getTranslation(uiLanguage);

    const [sourceLang, setSourceLang] = useState('English');
    const [targetLang, setTargetLang] = useState('Chinese');
    const [captionMode, setCaptionMode] = useState<CaptionMode>('Original');
    const [segmentStyle, setSegmentStyle] = useState<SegmentStyle>('natural');
    const [styleTemp, setStyleTemp] = useState(0.5);
    const [contextPrompt, setContextPrompt] = useState('');


    // Language Auto-switching logic
    const prevSource = useRef(sourceLang);
    const prevTarget = useRef(targetLang);
    React.useEffect(() => {
        if (sourceLang === targetLang) {
            if (sourceLang !== prevSource.current) {
                setTargetLang(sourceLang === 'Chinese' ? 'English' : 'Chinese');
            } else if (targetLang !== prevTarget.current) {
                setSourceLang(targetLang === 'Chinese' ? 'English' : 'Chinese');
            }
        }
        prevSource.current = sourceLang;
        prevTarget.current = targetLang;
    }, [sourceLang, targetLang]);

    const [isTranslating, setIsTranslating] = useState(false);

    // Editing State
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');

    const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);

    // Refs
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const processingAbortRef = useRef<AbortController | null>(null);
    const previewUrlRef = useRef<string | null>(null);

    React.useEffect(() => () => {
        processingAbortRef.current?.abort();
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    // Custom Hooks
    const apiKeyData = useApiKey();
    const isAudio = videoMeta?.type.startsWith('audio/') || false;

    useAudioAnalyser({ mediaRef, canvasRef, isAudio });
    const { activeCaption, jumpToTime } = useMediaSync({ mediaRef, captions });

    // File Processing Logic
    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();

        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
        }

        // Check if it's a subtitle file
        if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) {
            const text = await file.text();
            const parsedCaptions = parseCaptions(text);

            if (parsedCaptions.length > 0) {
                setCaptions(parsedCaptions);
                const detectedLang = detectLanguage(parsedCaptions.map(c => c.text));
                setSourceLang(detectedLang);
                setTargetLang(detectedLang === 'Chinese' ? 'English' : 'Chinese');
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

        const previewAvailable = !fileName.endsWith('.ts');
        const previewUrl = previewAvailable ? URL.createObjectURL(file) : '';
        previewUrlRef.current = previewUrl || null;

        setVideoFile(file);
        setCaptions([]);
        setVideoMeta({
            name: file.name,
            size: file.size,
            type: fileType,
            url: previewUrl,
            previewAvailable
        });
        setErrorMsg('');
        setStatus(AppStatus.IDLE);
        setProgressInfo(null);
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

        processingAbortRef.current?.abort();
        const controller = new AbortController();
        processingAbortRef.current = controller;

        setStatus(AppStatus.PROCESSING);
        setErrorMsg('');
        setCaptions([]);
        setProgressInfo(null);

        try {
            let lastSegments: CaptionSegment[] = [];
            const userApiKey = apiKeyData.userApiKey;

            const isServerAvailable = await checkServerHealth();
            if (!isServerAvailable) {
                throw new Error(t.errorServerUnavailable);
            }

            await transcribeWithServer(
                videoFile,
                targetLang,
                captionMode,
                segmentStyle,
                contextPrompt,
                (streamedSegments) => {
                    setCaptions(streamedSegments);
                    lastSegments = streamedSegments;
                    scrollToBottom();
                },
                (info) => setProgressInfo(info),
                userApiKey,
                uiLanguage,
                controller.signal
            );

            if (controller.signal.aborted) return;
            if (lastSegments.length > 0) {
                const detectedLang = detectLanguage(lastSegments.map(c => c.text));
                setSourceLang(detectedLang);
            }

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
            setIsTranslating(false);
        }
    };

    const handleTranslateExisting = async () => {
        if (captions.length === 0 || isTranslating || sourceLang === targetLang) return;

        // Check if API Key exists
        if (!apiKeyData.userApiKey) {
            setErrorMsg(t.errorNoApiKey);
            apiKeyData.openPanel();
            return;
        }

        setIsTranslating(true);
        setErrorMsg('');

        // Extract original text (remove any existing translation)
        const originalCaptions = captions.map(cap => ({
            ...cap,
            text: cap.text.split('\n')[0] // Keep only original text
        }));

        // Initialize with empty translation placeholder (shows "正在翻译中..." / "Waiting for translation...")
        const initialPlaceholder = originalCaptions.map(cap => ({
            ...cap,
            text: `${cap.text}\n` // Empty second line triggers placeholder display
        }));
        setCaptions(initialPlaceholder);

        try {
            await translateSegments(originalCaptions, targetLang, styleTemp, (translatedChunks) => {
                // Real-time stream merge: Original + Translation
                const merged = originalCaptions.map((orig, i) => {
                    const translatedText = translatedChunks[i]?.text || '';
                    // Only show translation if it's different from original (actual translation received)
                    const isActualTranslation = translatedText && translatedText !== orig.text;
                    return {
                        ...orig,
                        text: `${orig.text}\n${isActualTranslation ? translatedText : ''}`
                    };
                });
                setCaptions(merged);
            }, apiKeyData.userApiKey, uiLanguage);
            setCaptionMode('Bilingual');
        } catch (err: any) {
            setErrorMsg(err.message || t.errorTranslateFailed);
        } finally {
            setIsTranslating(false);
        }
    };

    const handleReset = () => {
        const hasWorkToLose = captions.length > 0 || status === AppStatus.PROCESSING || isTranslating;
        if (hasWorkToLose && !window.confirm(t.confirmReset)) {
            return;
        }

        setVideoFile(null);
        setVideoMeta(null);
        setCaptions([]);
        processingAbortRef.current?.abort();
        processingAbortRef.current = null;
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
        }
        setStatus(AppStatus.IDLE);
        setCaptionMode('Original');
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
        <div className="app-shell min-h-screen flex flex-col font-sans text-zinc-950 dark:text-zinc-100">
            <Header
                apiKeyData={apiKeyData}
                onApiKeySuccess={() => setErrorMsg('')}
                uiLanguage={uiLanguage}
                setUiLanguage={(l) => {
                    setUiLanguage(l);
                    localStorage.setItem('ui_language', l);
                }}
            />

            <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-5 overflow-visible lg:overflow-hidden">
                {errorMsg && (
                    <div className="app-panel mb-4 p-3 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-300" role="alert">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <p className="text-xs">{errorMsg}</p>
                    </div>
                )}

                {!videoFile && captions.length === 0 ? (
                    <FileUploader onFileSelect={processFile} uiLanguage={uiLanguage} />
                ) : (
                    <div className={`grid grid-cols-1 ${(!videoFile && captions.length > 0) ? 'lg:grid-cols-1' : 'lg:grid-cols-8'} gap-4 lg:gap-5 lg:h-[calc(100vh-112px)]`}>
                        {/* Left Panel: Media & Processing Controls */}
                        {(!(!videoFile && captions.length > 0)) && (
                            <div className="lg:col-span-3 flex min-h-0 flex-col gap-4">
                                <MediaPlayer
                                    videoMeta={videoMeta}
                                    isAudio={isAudio}
                                    mediaRef={mediaRef}
                                    canvasRef={canvasRef}
                                    activeCaption={activeCaption}
                                    uiLanguage={uiLanguage}
                                />

                                <ControlsPanel
                                    videoMeta={videoMeta}
                                    isAudio={isAudio}
                                    status={status}
                                    captionMode={captionMode}
                                    setCaptionMode={setCaptionMode}
                                    contextPrompt={contextPrompt}
                                    setContextPrompt={setContextPrompt}
                                    styleTemp={styleTemp}
                                    setStyleTemp={setStyleTemp}
                                    targetLang={targetLang}
                                    setTargetLang={setTargetLang}
                                    isTranslating={isTranslating}
                                    progressInfo={progressInfo}
                                    captionsCount={captions.length}
                                    uiLanguage={uiLanguage}
                                    onReset={handleReset}
                                    onProcess={handleProcess}
                                />
                            </div>
                        )}

                        {/* Right Panel: Subtitle List */}
                        <div className={`${(!videoFile && captions.length > 0) ? 'lg:col-span-8' : 'lg:col-span-5'} min-h-0`}>
                            <SubtitleList
                                isSubtitleOnly={!videoFile && captions.length > 0}
                                captions={captions}
                                activeCaption={activeCaption}
                                videoMeta={videoMeta}
                                editingId={editingId}
                                editText={editText}
                                isTranslating={isTranslating}
                                sourceLang={sourceLang}
                                targetLang={targetLang}
                                captionMode={captionMode}
                                styleTemp={styleTemp}
                                uiLanguage={uiLanguage}

                                onReset={handleReset}
                                onJump={jumpToTime}
                                onEditStart={(id, text) => { setEditingId(id); setEditText(text); }}
                                onEditChange={setEditText}
                                onEditSave={handleEditSave}

                                setSourceLang={setSourceLang}
                                setTargetLang={setTargetLang}
                                setStyleTemp={setStyleTemp}
                                onTranslate={handleTranslateExisting}
                            />
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;
