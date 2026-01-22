import React, { useState, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { AppStatus, CaptionSegment, VideoMetadata, ExportFormat, CaptionMode, ProgressInfo, SegmentStyle } from './types';
import { generateCaptionsStream, translateSegments } from './services/openaiService';
import { transcribeWithServer, checkServerHealth } from './services/serverService';
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

    // Custom Hooks
    const apiKeyData = useApiKey();
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

        setVideoFile(file);
        setVideoMeta({
            name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file)
        });
        setErrorMsg('');
        setStatus(AppStatus.IDLE);
        setCaptions([]);
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

        setStatus(AppStatus.PROCESSING);
        setErrorMsg('');
        setCaptions([]);
        setProgressInfo(null);

        try {
            let lastSegments: CaptionSegment[] = [];
            const userApiKey = apiKeyData.userApiKey;

            console.log('[App] Checking backend server...');
            const isServerAvailable = await checkServerHealth();
            const MAX_FRONTEND_SIZE = 25 * 1024 * 1024; // 25MB

            // Deciding processing strategy:
            // 1. Files < 25MB -> Browser (FAST, no upload overhead)
            // 2. Files >= 25MB -> Server (STABLE, handles heavy extraction/splitting)
            // 3. Fallback: If server is down, use browser for everything
            const shouldUseServer = isServerAvailable && videoFile.size >= MAX_FRONTEND_SIZE;

            if (shouldUseServer) {
                console.log('[App] File >= 25MB, using remote server for high-performance processing');
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
                    uiLanguage
                );

                if (captionMode !== 'Original' && lastSegments.length > 0) {
                    setIsTranslating(true);
                    setProgressInfo({
                        stage: 'translating',
                        stageLabel: t.translating,
                        progress: 95,
                        detail: `${t.translating} ${t['lang' + targetLang as keyof typeof t] || targetLang}`
                    });

                    const translated = await translateSegments(lastSegments, targetLang, styleTemp, undefined, userApiKey, uiLanguage);
                    if (captionMode === 'Translation') {
                        setCaptions(translated);
                        lastSegments = translated;
                    } else {
                        const bilingual = lastSegments.map((cap, i) => ({
                            ...cap,
                            text: `${cap.text}\n${translated[i]?.text || ''}`
                        }));
                        setCaptions(bilingual);
                        lastSegments = bilingual;
                    }
                }
            } else {
                if (isServerAvailable && videoFile.size < MAX_FRONTEND_SIZE) {
                    console.log('[App] Small file (< 25MB), bypassing server for direct browser processing');
                } else if (!isServerAvailable) {
                    console.log('[App] Backend not started, falling back to browser-only mode');
                }

                await generateCaptionsStream(
                    videoFile,
                    targetLang,
                    captionMode,
                    segmentStyle,
                    (streamedSegments) => {
                        setCaptions(streamedSegments);
                        lastSegments = streamedSegments;
                        scrollToBottom();
                    },
                    (info) => {
                        setProgressInfo(info);
                    },
                    userApiKey,
                    uiLanguage
                );
            }

            if (lastSegments.length > 0) {
                const detectedLang = detectLanguage(lastSegments.map(c => c.text));
                setSourceLang(detectedLang);
            }

            setStatus(AppStatus.SUCCESS);
            setProgressInfo(null);
        } catch (err: any) {
            setStatus(AppStatus.ERROR);
            setErrorMsg(err.message || t.errorProcessFailed);
            setProgressInfo(null);
        } finally {
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
        const originalCaptions = [...captions]; // Backup original captions

        try {
            await translateSegments(originalCaptions, targetLang, styleTemp, (translatedChunks) => {
                // Real-time stream merge: Original + Translation
                const merged = originalCaptions.map((orig, i) => ({
                    ...orig,
                    text: `${orig.text}\n${translatedChunks[i]?.text || ''}`
                }));
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
        setVideoFile(null);
        setVideoMeta(null);
        setCaptions([]);
        setStatus(AppStatus.IDLE);
        setCaptionMode('Original');
        if (videoMeta?.url) URL.revokeObjectURL(videoMeta.url);
    };

    const handleEditSave = () => {
        if (editingId !== null) {
            setCaptions(c => c.map(x => x.id === editingId ? { ...x, text: editText } : x));
            setEditingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
            <Header
                onReset={handleReset}
                apiKeyData={apiKeyData}
                onApiKeySuccess={() => setErrorMsg('')}
                uiLanguage={uiLanguage}
                setUiLanguage={(l) => {
                    setUiLanguage(l);
                    localStorage.setItem('ui_language', l);
                }}
            />

            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-hidden">
                {errorMsg && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <p className="text-xs ">{errorMsg}</p>
                    </div>
                )}

                {!videoFile && captions.length === 0 ? (
                    <FileUploader onFileSelect={processFile} uiLanguage={uiLanguage} />
                ) : (
                    <div className={`grid grid-cols-1 ${(!videoFile && captions.length > 0) ? 'lg:grid-cols-1' : 'lg:grid-cols-8'} gap-6 h-[calc(100vh-124px)]`}>
                        {/* Left Panel: Media & Processing Controls */}
                        {(!(!videoFile && captions.length > 0)) && (
                            <div className="lg:col-span-3 flex flex-col gap-4">
                                <MediaPlayer
                                    videoMeta={videoMeta}
                                    isAudio={isAudio}
                                    mediaRef={mediaRef}
                                    canvasRef={canvasRef}
                                    activeCaption={activeCaption}
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
                        <div className={`${(!videoFile && captions.length > 0) ? 'lg:col-span-8' : 'lg:col-span-5'}`}>
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
