
import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileVideo, Download, Play, Clock, AlertCircle, Trash2, Edit2, Save, Loader2, Languages, Sliders, Type as TypeIcon, FileStack, Files, Sparkles, Music, ChevronRight, Globe, ChevronDown, FileText, Check, Plus, Pause, FastForward, Rewind, Settings } from 'lucide-react';
import { AppStatus, CaptionSegment, VideoMetadata, ExportFormat, DownloadMode } from './types';
import { generateCaptionsStream, translateSegments, refineSegments, CaptionMode, ProgressInfo, SegmentStyle, validateApiKey } from './services/openaiService';
import { transcribeWithServer, checkServerHealth } from './services/serverService';
import { downloadCaptions, parseCaptions } from './utils/captionUtils';
import { Button } from './components/Button';

const LANGUAGES = ["Chinese", "English", "Japanese", "Korean", "French", "German", "Spanish"];

// 辅助函数：将 HH:MM:SS,mmm 转换为秒
const timeToSeconds = (timeStr: string): number => {
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    const [h, m, s_ms] = parts;
    const [s, ms] = s_ms.split(/[,.]/);
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + (parseInt(ms) || 0) / 1000;
};

// 辅助函数：智能截断文件名（保留后缀，中间省略）
const truncateFileName = (name: string, maxLen = 40): string => {
    if (!name || name.length <= maxLen) return name;
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex === -1) return name.substring(0, maxLen - 3) + '...';

    const ext = name.substring(dotIndex);
    const baseName = name.substring(0, dotIndex);
    const charsToShow = maxLen - ext.length - 3; // 3是省略号长度

    if (charsToShow <= 0) return '...' + ext;

    const half = Math.floor(charsToShow / 2);
    const front = baseName.substring(0, half + (charsToShow % 2));
    const back = baseName.substring(baseName.length - half);

    return `${front}...${back}${ext}`;
};

// 辅助函数：检测字幕文本的语言
const detectLanguage = (texts: string[]): string => {
    const sampleText = texts.slice(0, 20).join(' '); // 取前20条字幕作为样本

    // 统计各语言字符数量
    let chineseCount = 0;
    let japaneseCount = 0;
    let koreanCount = 0;
    let latinCount = 0;

    for (const char of sampleText) {
        const code = char.charCodeAt(0);
        // 中文字符范围
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
            chineseCount++;
        }
        // 日文假名范围 (平假名 + 片假名)
        else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
            japaneseCount++;
        }
        // 韩文字符范围
        else if (code >= 0xAC00 && code <= 0xD7AF) {
            koreanCount++;
        }
        // 拉丁字母范围
        else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) {
            latinCount++;
        }
    }

    // 如果有日文假名，优先判断为日文（因为日文也包含汉字）
    if (japaneseCount > 5) {
        return 'Japanese';
    }
    // 韩文
    if (koreanCount > chineseCount && koreanCount > latinCount) {
        return 'Korean';
    }
    // 中文
    if (chineseCount > latinCount && chineseCount > 10) {
        return 'Chinese';
    }
    // 默认返回英文（拉丁字母为主的语言）
    return 'English';
};

const App: React.FC = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
    const [captions, setCaptions] = useState<CaptionSegment[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');

    const [sourceLang, setSourceLang] = useState('English');
    const [targetLang, setTargetLang] = useState('Chinese');
    const [captionMode, setCaptionMode] = useState<CaptionMode>('Original');
    const [segmentStyle, setSegmentStyle] = useState<SegmentStyle>('natural');
    const [styleTemp, setStyleTemp] = useState(0.5);
    const [contextPrompt, setContextPrompt] = useState('');
    const [downloadDropdownFormat, setDownloadDropdownFormat] = useState<ExportFormat | null>(null);
    const [bilingualExportSeparate, setBilingualExportSeparate] = useState(false);

    const [isTranslating, setIsTranslating] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');

    // 实时同步相关状态
    const [activeCaption, setActiveCaption] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // 进度状态
    const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);

    // API Key 状态
    const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('openai_api_key') || '');
    const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
    const [tempApiKey, setTempApiKey] = useState('');
    const [isValidatingKey, setIsValidatingKey] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const animationRef = useRef<number>(0);
    const listRef = useRef<HTMLDivElement>(null);

    const isAudio = videoMeta?.type.startsWith('audio/');

    // 初始化音频分析器
    useEffect(() => {
        const media = mediaRef.current;
        if (!media || !isAudio) return;

        const initAudioAnalyser = () => {
            if (audioContextRef.current) return; // 已初始化

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.8;

            const source = audioContext.createMediaElementSource(media);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;
            sourceRef.current = source;
        };

        const drawWaveform = () => {
            const canvas = canvasRef.current;
            const analyser = analyserRef.current;
            if (!canvas || !analyser) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 0.8;
            const gap = (canvas.width / bufferLength) * 0.2;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.9;

                // 渐变色
                const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, '#71717a'); // primary-500
                gradient.addColorStop(1, '#27272a'); // primary-600

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.roundRect(x, canvas.height - barHeight, barWidth, barHeight, 2);
                ctx.fill();

                x += barWidth + gap;
            }

            animationRef.current = requestAnimationFrame(drawWaveform);
        };

        const handlePlay = () => {
            initAudioAnalyser();
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }
            drawWaveform();
        };

        const handlePause = () => {
            cancelAnimationFrame(animationRef.current);
        };

        media.addEventListener('play', handlePlay);
        media.addEventListener('pause', handlePause);
        media.addEventListener('ended', handlePause);

        return () => {
            media.removeEventListener('play', handlePlay);
            media.removeEventListener('pause', handlePause);
            media.removeEventListener('ended', handlePause);
            cancelAnimationFrame(animationRef.current);
        };
    }, [isAudio, videoMeta]);


    // 监听媒体播放进度
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        const handleTimeUpdate = () => {
            const currentTime = media.currentTime;
            const currentCap = captions.find(cap => {
                const start = timeToSeconds(cap.startTime);
                const end = timeToSeconds(cap.endTime);
                return currentTime >= start && currentTime <= end;
            });
            setActiveCaption(currentCap ? currentCap.text : null);
        };

        media.addEventListener('timeupdate', handleTimeUpdate);
        return () => media.removeEventListener('timeupdate', handleTimeUpdate);
    }, [captions]);

    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();

        // 判断是否为字幕文件
        if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) {
            const text = await file.text();
            const parsedCaptions = parseCaptions(text);

            if (parsedCaptions.length > 0) {
                setCaptions(parsedCaptions);
                // 自动检测字幕语言
                const detectedLang = detectLanguage(parsedCaptions.map(c => c.text));
                setSourceLang(detectedLang);
                // 如果检测到的语言与目标语言相同，自动切换目标语言
                if (detectedLang === targetLang) {
                    setTargetLang(detectedLang === 'Chinese' ? 'English' : 'Chinese');
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
                setErrorMsg('无效的字幕文件，请检查格式是否正确');
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
        setActiveCaption(null);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            await processFile(e.target.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            await processFile(e.dataTransfer.files[0]);
        }
    };

    const scrollToBottom = () => {
        if (listRef.current) {
            listRef.current.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    };

    const handleProcess = async () => {
        if (!videoFile) return;
        setStatus(AppStatus.PROCESSING);
        setErrorMsg('');
        setCaptions([]);
        setProgressInfo(null);

        try {
            let lastSegments: CaptionSegment[] = [];

            // 1. 优先尝试使用后端服务器（速度快，支持大文件）
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

                // 如果需要翻译，在前端执行（后端只负责转录）
                if (captionMode !== 'Original' && lastSegments.length > 0) {
                    setIsTranslating(true);
                    setProgressInfo({
                        stage: 'translating',
                        stageLabel: '翻译中...',
                        progress: 95,
                        detail: `正在翻译为 ${targetLang}`
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
                // 2. 降级到本地浏览器处理 (FFmpeg WASM)
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

            // 断句优化已禁用 - Whisper 原生断句效果已经很好
            // 如需启用，取消下方注释
            // if (lastSegments.length > 1) {
            //  setIsTranslating(true);
            //  setProgressInfo({
            //   stage: 'refining',
            //   stageLabel: '优化断句中...',
            //   progress: 0,
            //   detail: '调整字幕分段'
            //  });
            //  const refined = await refineSegments(lastSegments);
            //  setCaptions(refined);
            // }

            setStatus(AppStatus.SUCCESS);
            setProgressInfo(null);
        } catch (err: any) {
            setStatus(AppStatus.ERROR);
            setErrorMsg(err.message || "生成失败");
            setProgressInfo(null);
        } finally {
            setIsTranslating(false);
        }
    };

    const handleTranslateExisting = async () => {
        if (captions.length === 0 || isTranslating || sourceLang === targetLang) return;
        setIsTranslating(true);
        setErrorMsg('');
        try {
            // 传入风格值和回调，实现实时预览
            await translateSegments(captions, targetLang, styleTemp, (updatedChunks) => {
                setCaptions(updatedChunks);
            }, userApiKey);
            // 翻译开始后立即切换模式
            setCaptionMode('Bilingual');
        } catch (err: any) {
            setErrorMsg(err.message || "翻译失败");
        } finally {
            setIsTranslating(false);
        }
    };

    const handleSaveApiKey = async () => {
        if (!tempApiKey.trim()) {
            setUserApiKey('');
            localStorage.removeItem('openai_api_key');
            setShowApiKeyPanel(false);
            return;
        }

        setIsValidatingKey(true);
        const isValid = await validateApiKey(tempApiKey);
        setIsValidatingKey(false);

        if (isValid) {
            setUserApiKey(tempApiKey);
            localStorage.setItem('openai_api_key', tempApiKey);
            setShowApiKeyPanel(false);
        } else {
            setErrorMsg('API Key 验证失败，请检查是否输入正确。');
        }
    };

    const handleReset = () => {
        setVideoFile(null);
        setVideoMeta(null);
        setCaptions([]);
        setStatus(AppStatus.IDLE);
        setCaptionMode('Original');
        setActiveCaption(null);
        if (videoMeta?.url) URL.revokeObjectURL(videoMeta.url);
    };

    const jumpToTime = (timeStr: string) => {
        if (mediaRef.current) {
            mediaRef.current.currentTime = timeToSeconds(timeStr);
            mediaRef.current.play();
        }
    };

    const getStyleLabel = (val: number) => {
        if (val < 0.3) return "直译";
        if (val > 0.7) return "创意";
        return "平衡";
    };

    const showTranslationSettings = captionMode !== 'Original';

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReset}
                            className="text-lg text-slate-900 tracking-tight transition-all hover:scale-[1.02] active:scale-95 hover:opacity-80 flex items-center gap-2"
                        >
                            AI Powered <span className="text-primary-600">Media Captions</span>
                        </button>
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => {
                                setTempApiKey(userApiKey);
                                setShowApiKeyPanel(!showApiKeyPanel);
                            }}
                            className={`flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-medium transition-all ${userApiKey ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'} hover:shadow-sm active:scale-95`}
                        >
                            OPENAI API KEY
                        </button>

                        {showApiKeyPanel && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={() => setShowApiKeyPanel(false)} />
                                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-[70] p-4 animate-in fade-in zoom-in slide-in-from-top-2 duration-150 origin-top-right">
                                    <h4 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                        配置 OpenAI API Key
                                    </h4>
                                    <p className="text-[10px] text-slate-500 mb-3 leading-normal">
                                        配置您自己的 API Key 后，系统将优先使用该 Key 进行处理。Key 将仅保存在您的浏览器本地。
                                    </p>
                                    <div className="space-y-3">
                                        <input
                                            type="password"
                                            value={tempApiKey}
                                            onChange={(e) => setTempApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className="w-full text-xs border-slate-200 rounded-lg focus:ring-primary-500 p-2 bg-slate-50"
                                            autoFocus
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowApiKeyPanel(false)}
                                                className="flex-1 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-slate-50 transition-colors"
                                            >
                                                取消
                                            </button>
                                            <button
                                                onClick={handleSaveApiKey}
                                                disabled={isValidatingKey}
                                                className="flex-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                                            >
                                                {isValidatingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                                验证并确认
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {errorMsg && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <p className="text-xs ">{errorMsg}</p>
                    </div>
                )}

                {!videoFile && captions.length === 0 ? (
                    <div className="max-w-xl mx-auto space-y-8 py-12 text-center">
                        <div className="space-y-4">
                            <h2 className="text-4xl text-slate-900 tracking-tight">AI 智能音视频转录与翻译</h2>
                            <p className="text-lg text-slate-600 ">支持极速转写、语义断句、双语翻译及 SRT/VTT 字幕加工。</p>
                        </div>
                        <div
                            className={`group border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer bg-white shadow-sm flex flex-col items-center justify-center min-h-[300px] ${isDragging
                                ? 'border-primary-500 bg-primary-50 scale-[1.02]'
                                : 'border-slate-300 hover:border-primary-500 hover:bg-primary-50'
                                }`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <div className="p-4 bg-primary-100 text-primary-600 rounded-2xl group-hover:scale-110 transition-transform mb-6 flex gap-3">
                                <FileVideo className="w-8 h-8" />
                                <Music className="w-8 h-8" />
                                <FileText className="w-8 h-8" />
                            </div>
                            <p className="text-xl text-slate-900">点击或拖拽上传媒体或字幕文件</p>
                            <p className="text-sm text-slate-400 mt-2 ">支持 MP4, MP3, WAV 及 SRT, VTT 格式</p>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="video/*,audio/*,.srt,.vtt"
                                onChange={handleFileChange}
                            />
                        </div>
                    </div>
                ) : (
                    <div className={`grid grid-cols-1 ${(!videoFile && captions.length > 0) ? 'lg:grid-cols-1' : 'lg:grid-cols-12'} gap-6 h-[calc(100vh-100px)]`}>
                        {/* Left Panel: Media & Real-time Preview */}
                        {(!(!videoFile && captions.length > 0)) && (
                            <div className="lg:col-span-5 flex flex-col gap-4 h-full">
                                <div className={`rounded-xl overflow-hidden shadow-lg h-64 lg:h-80 ring-1 ring-slate-900/5 shrink-0 relative flex flex-col items-center justify-center ${isAudio ? 'bg-gradient-to-br from-slate-800 to-slate-950' : 'bg-black'}`}>
                                    {isAudio ? (
                                        <div className="w-full h-full flex flex-col items-center justify-center p-6 gap-6 relative">
                                            {/* 实时音频波形 */}
                                            <canvas
                                                ref={canvasRef}
                                                width={320}
                                                height={80}
                                                className="w-80 h-20"
                                            />
                                            {/* Audio Subtitle Display */}
                                            {activeCaption && (
                                                <div className="absolute inset-0 flex items-center justify-center p-8 bg-black/40 backdrop-blur-sm pointer-events-none transition-opacity">
                                                    <p className="text-white text-lg text-center leading-relaxed drop-shadow-md">
                                                        {activeCaption.split('\n').map((line, i) => (
                                                            <span key={i} className={i > 0 ? 'block text-primary-300 text-sm mt-1' : 'block'}>{line}</span>
                                                        ))}
                                                    </p>
                                                </div>
                                            )}
                                            <audio ref={mediaRef as any} src={videoMeta?.url} controls className="w-full max-w-sm accent-primary-600 mt-auto" />
                                        </div>
                                    ) : (
                                        <>
                                            <video ref={mediaRef as any} src={videoMeta?.url} controls className="w-full h-full" />
                                            {/* Video Subtitle Overlay */}
                                            {activeCaption && (
                                                <div className="absolute bottom-16 left-0 right-0 px-6 flex justify-center pointer-events-none transition-all">
                                                    <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10 shadow-2xl">
                                                        <p className="text-white text-base sm:text-lg text-center leading-snug tracking-wide">
                                                            {activeCaption.split('\n').map((line, i) => (
                                                                <span key={i} className={i > 0 ? 'block text-primary-300 text-sm mt-0.5 ' : 'block'}>{line}</span>
                                                            ))}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4 flex-1 flex flex-col">
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-slate-50 rounded-lg">
                                                {isAudio ? <Music className="w-4 h-4 text-slate-500" /> : <FileVideo className="w-4 h-4 text-slate-500" />}
                                            </div>
                                            <span className=" text-sm text-slate-900 max-w-[320px]">{truncateFileName(videoMeta?.name || '')}</span>
                                        </div>
                                        <button onClick={handleReset} className="text-slate-400 hover:text-red-500 p-2 transition-colors rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                                    </div>

                                    {status === AppStatus.IDLE && (
                                        <div className="space-y-4">
                                            <div className="space-y-3">
                                                <label className="text-[11px] text-slate-400 uppercase">识别模式</label>
                                                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-50 rounded-lg border border-slate-100">
                                                    {(['Original', 'Translation', 'Bilingual'] as CaptionMode[]).map(m => (
                                                        <button
                                                            key={m}
                                                            onClick={() => setCaptionMode(m)}
                                                            className={`py-1.5 text-[11px] rounded-md transition-all ${captionMode === m ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            {m === 'Original' ? '仅原文' : m === 'Translation' ? '仅翻译' : '双语对照'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] text-slate-400 uppercase tracking-tight">识别背景提示</label>
                                                    <span className="text-[9px] text-slate-400 italic px-1">提高专业词汇准确率</span>
                                                </div>
                                                <textarea
                                                    value={contextPrompt}
                                                    onChange={(e) => setContextPrompt(e.target.value)}
                                                    placeholder="输入专有名词、人名或背景说明..."
                                                    className="w-full h-14 text-[11px] border-slate-200 rounded-lg focus:ring-primary-500 p-2 bg-slate-50/50 resize-none font-normal leading-relaxed"
                                                />
                                            </div>

                                            {showTranslationSettings && (
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <label className="text-[11px] text-slate-400 uppercase">翻译语言</label>
                                                        <select
                                                            value={targetLang}
                                                            onChange={(e) => setTargetLang(e.target.value)}
                                                            className="w-full text-xs border-slate-200 rounded-lg focus:ring-primary-500 py-2 bg-slate-50"
                                                        >
                                                            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[11px] text-slate-400 uppercase flex justify-between">
                                                            风格 <span>{getStyleLabel(styleTemp)}</span>
                                                        </label>
                                                        <input
                                                            type="range" min="0" max="1" step="0.1"
                                                            value={styleTemp}
                                                            onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-600 mt-2"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <Button onClick={handleProcess} className="w-full py-3 text-sm shadow-lg shadow-primary-100 rounded-xl">开始 AI 解析</Button>
                                        </div>
                                    )}

                                    {(status === AppStatus.PROCESSING || isTranslating) && (
                                        <div className="py-4 flex flex-col items-center gap-4">
                                            <Loader2 className="w-12 h-12 text-primary-600 animate-spin stroke-[2.5]" />
                                            <div className="text-center space-y-2">
                                                <p className="text-slate-900 text-lg">
                                                    {progressInfo?.stageLabel || (isTranslating ? '正在 AI 智能翻译...' : 'AI 引擎启动中')}
                                                </p>
                                                {progressInfo?.detail && (
                                                    <p className="text-xs text-slate-500">
                                                        {progressInfo.detail}
                                                    </p>
                                                )}
                                                {progressInfo && progressInfo.progress > 0 && (
                                                    <div className="w-full max-w-xs mx-auto mt-3">
                                                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-primary-500 transition-all duration-300 ease-out"
                                                                style={{ width: `${progressInfo.progress}%` }}
                                                            />
                                                        </div>
                                                        <p className="text-[10px] text-slate-400 mt-1">{Math.round(progressInfo.progress)}%</p>
                                                    </div>
                                                )}
                                                <p className="text-[11px] text-primary-600 bg-primary-50 border border-primary-100 px-3 py-1 rounded-full mt-2 inline-block">
                                                    已捕获 {captions.length} 条字幕段
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Right Panel: Subtitle List */}
                        <div className={`${(!videoFile && captions.length > 0) ? 'lg:col-span-12' : 'lg:col-span-7'} bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden`}>
                            <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3 bg-white sticky top-0 z-20">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {!videoFile && captions.length > 0 && (
                                            <div className="flex items-center gap-2 pr-3 border-r border-slate-100 mr-1">
                                                <button onClick={handleReset} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors rounded-lg hover:bg-slate-100">
                                                    <ChevronRight className="w-4 h-4 rotate-180" />
                                                </button>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <FileText className="w-4 h-4 text-primary-500 shrink-0" />
                                                    <span className="text-sm text-slate-900 whitespace-nowrap">{truncateFileName(videoMeta?.name || '')}</span>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <h3 className="text-sm text-slate-900">字幕预览</h3>
                                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                                {captions.length}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 pb-1 sm:pb-0">
                                    {/* 语言选择 */}
                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                                        <select
                                            value={sourceLang}
                                            onChange={(e) => setSourceLang(e.target.value)}
                                            className="bg-transparent border-none p-0 text-[11px] text-slate-600 focus:ring-0 cursor-pointer"
                                        >
                                            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                        <ChevronRight className="w-3 h-3 text-slate-300" />
                                        <select
                                            value={targetLang}
                                            onChange={(e) => setTargetLang(e.target.value)}
                                            className="bg-transparent border-none p-0 text-[11px] text-slate-600 focus:ring-0 cursor-pointer"
                                        >
                                            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>

                                    {/* 风格平衡器 */}
                                    <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                                        <span className="text-[10px] text-slate-500">直译</span>
                                        <input
                                            type="range" min="0" max="1" step="0.1"
                                            value={styleTemp}
                                            onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                                            className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
                                        />
                                        <span className="text-[10px] text-slate-500">创意</span>
                                    </div>

                                    <div className="flex-1" />

                                    <button
                                        disabled={captions.length === 0 || isTranslating || sourceLang === targetLang}
                                        onClick={handleTranslateExisting}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-[11px] transition-all shadow-sm hover:shadow active:scale-95 disabled:opacity-40 disabled:bg-slate-300 shrink-0"
                                    >
                                        {isTranslating && <Loader2 className="w-3 h-3 animate-spin" />}
                                        {sourceLang === targetLang ? '无需翻译' : '立即翻译'}
                                    </button>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className="relative">
                                            <button
                                                disabled={captions.length === 0}
                                                onClick={() => {
                                                    if (captionMode === 'Original') {
                                                        downloadCaptions(captions, 'SRT', videoMeta?.name.split('.')[0] || 'subtitles', 'original');
                                                    } else {
                                                        setDownloadDropdownFormat(downloadDropdownFormat === 'SRT' ? null : 'SRT');
                                                    }
                                                }}
                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] border border-slate-200 transition-colors disabled:opacity-40"
                                            >
                                                <Download className="w-3 h-3" /> SRT {captionMode !== 'Original' && <ChevronDown className={`w-3 h-3 transition-transform ${downloadDropdownFormat === 'SRT' ? 'rotate-180' : ''}`} />}
                                            </button>
                                            {captionMode !== 'Original' && downloadDropdownFormat === 'SRT' && (
                                                <>
                                                    <div className="fixed inset-0 z-[60]" onClick={() => setDownloadDropdownFormat(null)} />
                                                    <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-[70] py-1 overflow-hidden animate-in fade-in zoom-in slide-in-from-top-2 duration-100 origin-top-right">
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'SRT', videoMeta?.name.split('.')[0] || 'subtitles', 'bilingual', bilingualExportSeparate); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                                        >
                                                            双语对照 {bilingualExportSeparate && '(分列)'}
                                                        </button>
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'SRT', videoMeta?.name.split('.')[0] || 'subtitles', 'translated'); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                                                        >
                                                            仅译文
                                                        </button>
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'SRT', videoMeta?.name.split('.')[0] || 'subtitles', 'original'); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                                                        >
                                                            仅原文
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div className="relative">
                                            <button
                                                disabled={captions.length === 0}
                                                onClick={() => {
                                                    if (captionMode === 'Original') {
                                                        downloadCaptions(captions, 'VTT', videoMeta?.name.split('.')[0] || 'subtitles', 'original');
                                                    } else {
                                                        setDownloadDropdownFormat(downloadDropdownFormat === 'VTT' ? null : 'VTT');
                                                    }
                                                }}
                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] border border-slate-200 transition-colors disabled:opacity-40"
                                            >
                                                <Download className="w-3 h-3" /> VTT {captionMode !== 'Original' && <ChevronDown className={`w-3 h-3 transition-transform ${downloadDropdownFormat === 'VTT' ? 'rotate-180' : ''}`} />}
                                            </button>
                                            {captionMode !== 'Original' && downloadDropdownFormat === 'VTT' && (
                                                <>
                                                    <div className="fixed inset-0 z-[60]" onClick={() => setDownloadDropdownFormat(null)} />
                                                    <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-[70] py-1 overflow-hidden animate-in fade-in zoom-in slide-in-from-top-2 duration-100 origin-top-right">
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'VTT', videoMeta?.name.split('.')[0] || 'subtitles', 'bilingual', bilingualExportSeparate); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                                        >
                                                            双语对照
                                                        </button>
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'VTT', videoMeta?.name.split('.')[0] || 'subtitles', 'translated'); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                                                        >
                                                            仅译文
                                                        </button>
                                                        <button
                                                            onClick={() => { downloadCaptions(captions, 'VTT', videoMeta?.name.split('.')[0] || 'subtitles', 'original'); setDownloadDropdownFormat(null); }}
                                                            className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                                                        >
                                                            仅原文
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider px-4 py-2">
                                <div className="w-32 flex-shrink-0">播放位置</div>
                                <div className="flex-1 px-4">文本内容</div>
                                <div className="w-16 text-right">管理</div>
                            </div>

                            <div ref={listRef} className="flex-1 overflow-y-auto bg-white custom-scrollbar">
                                {captions.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-300 py-12">
                                        <Files className="w-12 h-12 mb-3 opacity-20" />
                                        <p className="text-xs uppercase tracking-widest opacity-40">暂无字幕内容</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-50">
                                        {captions.map((cap) => {
                                            const isActive = activeCaption === cap.text;
                                            const textParts = cap.text.split('\n');
                                            const isBilingual = textParts.length > 1;

                                            return (
                                                <div key={cap.id} className={`group flex items-start px-4 py-3 transition-colors ${isActive ? 'bg-primary-50/60 ring-1 ring-inset ring-primary-100' : 'hover:bg-slate-50/80'}`}>
                                                    {/* Time Column */}
                                                    <div className="w-32 flex-shrink-0 pt-1">
                                                        <button
                                                            onClick={() => jumpToTime(cap.startTime)}
                                                            className={`flex flex-col items-start gap-1 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-400 hover:text-primary-500'}`}
                                                        >
                                                            <span className="text-[10px] font-mono ">{cap.startTime}</span>
                                                            <span className="text-[10px] font-mono opacity-60">{cap.endTime}</span>
                                                        </button>
                                                    </div>

                                                    {/* Content Column */}
                                                    <div className="flex-1 px-4 min-w-0">
                                                        {editingId === cap.id ? (
                                                            <textarea
                                                                className="w-full text-sm text-slate-800 bg-white border-slate-200 rounded-lg focus:ring-1 focus:ring-primary-500 p-2 min-h-[70px]"
                                                                value={editText}
                                                                onChange={(e) => setEditText(e.target.value)}
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <div className={`text-sm leading-relaxed break-words ${isActive ? 'text-primary-900' : 'text-slate-700'}`}>
                                                                {isBilingual ? (
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                                                                            <span className="text-[10px] text-slate-400 uppercase block mb-1 ">Original</span>
                                                                            {textParts[0]}
                                                                        </div>
                                                                        <div className="p-2.5 bg-primary-50/30 rounded-lg border border-primary-100/50">
                                                                            <span className="text-[10px] text-primary-400 uppercase block mb-1 ">Translation</span>
                                                                            <span className="text-primary-900">{textParts[1]}</span>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    cap.text
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Action Column */}
                                                    <div className="w-16 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {editingId === cap.id ? (
                                                            <button
                                                                onClick={() => {
                                                                    setCaptions(c => c.map(x => x.id === cap.id ? { ...x, text: editText } : x));
                                                                    setEditingId(null);
                                                                }}
                                                                className="p-1.5 text-green-600 hover:bg-green-100 rounded"
                                                            >
                                                                <Save className="w-4 h-4" />
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => { setEditingId(cap.id); setEditText(cap.text); }}
                                                                className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-white rounded border border-transparent hover:border-slate-200"
                                                            >
                                                                <Edit2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <div className="h-8" />
                                    </div>
                                )}
                            </div>

                            {/* Footer Options (Only for Bilingual) */}
                            {captions.length > 0 && captionMode === 'Bilingual' && (
                                <div className="px-4 py-2 border-t border-slate-100 bg-white flex items-center justify-end">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400 uppercase">双语导出配置:</span>
                                        <button
                                            onClick={() => setBilingualExportSeparate(!bilingualExportSeparate)}
                                            className="text-[10px] text-slate-600 hover:text-primary-600 bg-slate-50 hover:bg-primary-50 px-2 py-1 rounded border border-slate-200 hover:border-primary-200 transition-all"
                                        >
                                            {bilingualExportSeparate ? '分离为两个文件' : '合并为一个文件'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;
