import React from 'react';
import { Music, FileVideo, Trash2, Loader2 } from 'lucide-react';
import { VideoMetadata, AppStatus, CaptionMode, ProgressInfo } from '../types';
import { Button } from './Button';
import { truncateFileName, LANGUAGES } from '../utils/helpers';
import { Language, getTranslation } from '../utils/i18n';

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
    uiLanguage: Language;
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
    uiLanguage,
    onReset,
    onProcess
}) => {
    const t = getTranslation(uiLanguage);

    const getStyleLabel = (val: number) => {
        if (val < 0.3) return t.styleLiteral;
        if (val > 0.7) return t.styleCreative;
        return t.styleBalanced;
    };

    const showTranslationSettings = captionMode !== 'Original';
    const progressValue = Math.min(100, Math.max(0, progressInfo?.progress ?? (captionsCount > 0 ? 82 : 18)));

    return (
        <div className="app-panel flex min-h-[360px] flex-col rounded-lg p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-950/5 pb-3 dark:border-white/10">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/10">
                        {isAudio ? <Music className="w-4 h-4 text-zinc-600 dark:text-zinc-300" /> : <FileVideo className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />}
                    </div>
                    <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50" title={videoMeta?.name || ''}>{truncateFileName(videoMeta?.name || '')}</span>
                </div>
                <button
                    type="button"
                    onClick={onReset}
                    aria-label={uiLanguage === 'zh' ? '移除文件' : 'Remove file'}
                    className="focus-apple flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-400/10 dark:hover:text-red-300"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {status === AppStatus.IDLE && (
                <div className="mt-4 flex flex-1 flex-col gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.processMode}</label>
                        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-200/70 bg-zinc-950/5 p-1 dark:border-white/10 dark:bg-white/10">
                            {(['Original', 'Translation', 'Bilingual'] as CaptionMode[]).map(m => (
                                <button
                                    type="button"
                                    key={m}
                                    onClick={() => setCaptionMode(m)}
                                    aria-pressed={captionMode === m}
                                    className={`focus-apple min-h-10 rounded-md px-2 text-xs font-medium transition-all ${captionMode === m ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                                >
                                    {m === 'Original' ? t.originalOnly : m === 'Translation' ? t.translationOnly : t.bilingual}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.contextPrompt}</label>
                            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t.contextPromptTip}</span>
                        </div>
                        <textarea
                            value={contextPrompt}
                            onChange={(e) => setContextPrompt(e.target.value)}
                            placeholder={t.contextPromptPlaceholder}
                            className="focus-apple h-20 w-full resize-none rounded-lg border border-zinc-200/80 bg-white/70 p-3 text-sm leading-relaxed text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50"
                        />
                    </div>

                    {showTranslationSettings && (
                        <div className="animate-fade-up grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.targetLang}</label>
                                <select
                                    value={targetLang}
                                    onChange={(e) => setTargetLang(e.target.value)}
                                    className="focus-apple min-h-11 w-full rounded-lg border border-zinc-200/80 bg-white/70 px-3 text-sm text-zinc-800 outline-none dark:border-white/10 dark:bg-white/5 dark:text-zinc-50"
                                >
                                    {LANGUAGES.map(l => (
                                        <option key={l} value={l}>
                                            {t['lang' + l as keyof typeof t] || l}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.transStyle}</label>
                                    <span className="rounded-full bg-zinc-950/5 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{getStyleLabel(styleTemp)}</span>
                                </div>
                                <div className="flex min-h-11 items-center justify-between rounded-lg border border-zinc-200/70 bg-white/[0.55] px-3 dark:border-white/10 dark:bg-white/5">
                                    <span className={`text-[11px] transition-colors ${styleTemp <= 0.3 ? 'text-sky-700 font-medium dark:text-sky-300' : 'text-zinc-400'}`}>{t.styleLiteral}</span>
                                    <input
                                        type="range" min="0" max="1" step="0.1"
                                        value={styleTemp}
                                        onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                                        aria-label={t.transStyle}
                                        className="mx-3 h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-zinc-950 dark:bg-zinc-700 dark:accent-zinc-50"
                                    />
                                    <span className={`text-[11px] transition-colors ${styleTemp >= 0.7 ? 'text-sky-700 font-medium dark:text-sky-300' : 'text-zinc-400'}`}>{t.styleCreative}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <Button onClick={onProcess} className="mt-auto w-full">{t.startProcess}</Button>
                </div>
            )}

            {(status === AppStatus.PROCESSING || isTranslating) && (
                <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8" aria-live="polite" aria-busy="true">
                    <Loader2 className="h-10 w-10 animate-spin text-sky-600 stroke-[2.5] dark:text-sky-300" />
                    <div className="w-full space-y-3 text-center">
                        <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                            {progressInfo?.stageLabel || (isTranslating ? t.translating : t.engineStarting)}
                        </p>
                        {progressInfo?.detail && (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                {progressInfo.detail}
                            </p>
                        )}

                        <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10" role="progressbar" aria-valuenow={Math.round(progressValue)} aria-valuemin={0} aria-valuemax={100}>
                            <div
                                className="app-progress-fill h-full w-full rounded-full bg-sky-600 dark:bg-sky-300"
                                style={{ transform: `scaleX(${progressValue / 100})` }}
                            />
                        </div>

                        <p className="inline-block rounded-full border border-sky-200/70 bg-sky-50/80 px-3 py-1 text-xs text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300">
                            {captionsCount > 0 ? t.capturedSegments.replace('{count}', captionsCount.toString()) : t.showAfterFinish}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
