import React from 'react';
import { Music, FileVideo, Trash2, Loader2 } from 'lucide-react';
import { VideoMetadata, AppStatus, CaptionMode, ProgressInfo } from '../types';
import { Button } from './Button';
import { truncateFileName, LANGUAGES } from '../utils/helpers';

interface ControlsPanelProps {
    videoMeta: VideoMetadata | null;
    isAudio: boolean;
    status: AppStatus;
    captionMode: CaptionMode;
    setCaptionMode: (m: CaptionMode) => void;
    contextPrompt: string;
    setContextPrompt: (s: string) => void;
    styleTemp: number;
    setStyleTemp: (t: number) => void;
    targetLang: string;
    setTargetLang: (l: string) => void;
    isTranslating: boolean;
    progressInfo: ProgressInfo | null;
    captionsCount: number;
    onReset: () => void;
    onProcess: () => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
    videoMeta,
    isAudio,
    status,
    captionMode,
    setCaptionMode,
    contextPrompt,
    setContextPrompt,
    styleTemp,
    setStyleTemp,
    targetLang,
    setTargetLang,
    isTranslating,
    progressInfo,
    captionsCount,
    onReset,
    onProcess
}) => {

    const getStyleLabel = (val: number) => {
        if (val < 0.3) return "直译";
        if (val > 0.7) return "创意";
        return "平衡";
    };

    const showTranslationSettings = captionMode !== 'Original';

    return (
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-50 rounded-lg">
                        {isAudio ? <Music className="w-4 h-4 text-slate-500" /> : <FileVideo className="w-4 h-4 text-slate-500" />}
                    </div>
                    <span className=" text-sm text-slate-900 max-w-[320px]">{truncateFileName(videoMeta?.name || '')}</span>
                </div>
                <button onClick={onReset} className="text-slate-400 hover:text-red-500 p-2 transition-colors rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
            </div>

            {status === AppStatus.IDLE && (
                <div className="space-y-3">
                    <div className="space-y-1.5">
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
                            className="w-full h-14 text-[11px] border border-slate-200 rounded-lg focus:outline-none focus:border-slate-200 focus:ring-0 p-2 bg-slate-50/50 resize-none font-normal leading-relaxed"
                        />
                    </div>

                    <div className={`grid grid-cols-2 gap-3 transition-opacity duration-200 ${showTranslationSettings ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'}`}>
                        <div className="space-y-1">
                            <label className="text-[11px] text-slate-400 uppercase">翻译语言</label>
                            <select
                                value={targetLang}
                                onChange={(e) => setTargetLang(e.target.value)}
                                className="w-full text-xs border-slate-200 rounded-lg focus:ring-primary-500 py-1.5 bg-slate-50"
                            >
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[11px] text-slate-400 uppercase">翻译风格</label>
                            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-100 h-[34px]">
                                <span className={`text-[10px] transition-colors ${styleTemp <= 0.3 ? 'text-primary-600 font-medium' : 'text-slate-400'}`}>直译</span>
                                <input
                                    type="range" min="0" max="1" step="0.1"
                                    value={styleTemp}
                                    onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                                    className="mx-3 flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
                                />
                                <span className={`text-[10px] transition-colors ${styleTemp >= 0.7 ? 'text-primary-600 font-medium' : 'text-slate-400'}`}>创意</span>
                            </div>
                        </div>
                    </div>

                    <Button onClick={onProcess} className="w-full py-3 text-sm shadow-lg shadow-primary-100 rounded-xl">开始 AI 解析</Button>
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
                            已捕获 {captionsCount} 条字幕段
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
