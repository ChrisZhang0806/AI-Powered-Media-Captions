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
    // 状态管理
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
    const [captions, setCaptions] = useState<CaptionSegment[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [uiLanguage, setUiLanguage] = useState<Language>(() => {
        return (localStorage.getItem('ui_language') as Language) || 'en';
    });
    const t = getTranslation(uiLanguage);

    const [sourceLang, setSourceLang] = useState('英文');
    const [targetLang, setTargetLang] = useState('中文');
    const [captionMode, setCaptionMode] = useState<CaptionMode>('Original');
    const [segmentStyle, setSegmentStyle] = useState<SegmentStyle>('natural');
    const [styleTemp, setStyleTemp] = useState(0.5);
    const [contextPrompt, setContextPrompt] = useState('');

    // 下载下拉菜单状态
    const [downloadDropdownFormat, setDownloadDropdownFormat] = useState<ExportFormat | null>(null);
    const [bilingualExportSeparate, setBilingualExportSeparate] = useState(false);

    const [isTranslating, setIsTranslating] = useState(false);

    // 编辑相关
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

    // 文件处理逻辑
    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();

        // 判断是否为字幕文件
        if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) {
            const text = await file.text();
            const parsedCaptions = parseCaptions(text);

            if (parsedCaptions.length > 0) {
                setCaptions(parsedCaptions);
                const detectedLang = detectLanguage(parsedCaptions.map(c => c.text));
                setSourceLang(detectedLang);
                if (detectedLang === targetLang) {
                    setTargetLang(detectedLang === '中文' ? '英文' : '中文');
                }
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

    // 自动滚动到字幕列表底部
    const scrollToBottom = () => {
        const listContainer = document.getElementById('subtitle-list-container');
        if (listContainer) {
            listContainer.scrollTo({
                top: listContainer.scrollHeight,
                behavior: 'smooth'
            });
        }
    };

    // AI 处理逻辑
    const handleProcess = async () => {
        if (!videoFile) return;

        // 检查是否有 API Key
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

            console.log('[App] 正在检查后端服务器...');
            const isServerAvailable = await checkServerHealth();

            if (isServerAvailable) {
                console.log('[App] 使用远程服务器进行高性能处理');
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
                    userApiKey
                );

                if (captionMode !== 'Original' && lastSegments.length > 0) {
                    setIsTranslating(true);
                    setProgressInfo({
                        stage: 'translating',
                        stageLabel: t.translating,
                        progress: 95,
                        detail: `${t.translating} ${targetLang}`
                    });

                    const translated = await translateSegments(lastSegments, targetLang, styleTemp, undefined, userApiKey);
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
                console.log('[App] 后端未启动，使用本地浏览器模式');
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
                    userApiKey
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

        // 检查是否有 API Key
        if (!apiKeyData.userApiKey) {
            setErrorMsg(t.errorNoApiKey);
            apiKeyData.openPanel();
            return;
        }

        setIsTranslating(true);
        setErrorMsg('');
        const originalCaptions = [...captions]; // 保存原文备份

        try {
            await translateSegments(originalCaptions, targetLang, styleTemp, (translatedChunks) => {
                // 实时流式合并：原文 + 译文
                const merged = originalCaptions.map((orig, i) => ({
                    ...orig,
                    text: `${orig.text}\n${translatedChunks[i]?.text || ''}`
                }));
                setCaptions(merged);
            }, apiKeyData.userApiKey);
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
                                bilingualExportSeparate={bilingualExportSeparate}
                                downloadDropdownFormat={downloadDropdownFormat}
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
                                setDownloadDropdownFormat={setDownloadDropdownFormat}
                                setBilingualExportSeparate={setBilingualExportSeparate}
                            />
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;
