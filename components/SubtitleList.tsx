import React, { useRef } from 'react';
import { ChevronRight, FileText, Files, Loader2 } from 'lucide-react';
import { CaptionSegment, VideoMetadata } from '../types';
import { LANGUAGES } from '../utils/helpers';
import { Language, getTranslation } from '../utils/i18n';
import { DownloadDropdown } from './DownloadDropdown';
import { SubtitleItem } from './SubtitleItem';

interface SubtitleListProps {
    captions: CaptionSegment[];
    activeCaption: string | null;
    videoMeta: VideoMetadata | null;
    editingId: number | null;
    editText: string;
    isTranslating: boolean;
    sourceLang: string;
    targetLang: string;
    captionMode: string;
    styleTemp: number;
    isSubtitleOnly?: boolean;
    uiLanguage: Language;

    onReset: () => void;
    onJump: (time: string) => void;
    onEditStart: (id: number, text: string) => void;
    onEditChange: (text: string) => void;
    onEditSave: () => void;

    setSourceLang: (l: string) => void;
    setTargetLang: (l: string) => void;
    setStyleTemp: (t: number) => void;
    onTranslate: () => void;
}

export const SubtitleList: React.FC<SubtitleListProps> = ({
    captions,
    activeCaption,
    videoMeta,
    editingId,
    editText,
    isTranslating,
    sourceLang,
    targetLang,
    captionMode,
    styleTemp,
    isSubtitleOnly,
    uiLanguage,

    onReset,
    onJump,
    onEditStart,
    onEditChange,
    onEditSave,

    setSourceLang,
    setTargetLang,
    setStyleTemp,
    onTranslate,
}) => {
    const t = getTranslation(uiLanguage);
    const listRef = useRef<HTMLDivElement>(null);

    return (
        <section className="app-panel flex h-[min(72vh,720px)] flex-col overflow-hidden rounded-lg lg:h-full" aria-label={t.subtitlePreview}>
            <div className="subtitle-toolbar sticky top-0 z-20 border-b border-zinc-950/5 bg-white/[0.74] px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/[0.72]">
                <div className="subtitle-toolbar-layout">
                    <div className="subtitle-toolbar-meta">
                        {/* 文件标题区域 */}
                        {videoMeta && captions.length > 0 && (
                            <div className="mr-3 flex min-w-0 flex-1 items-center gap-2 border-r border-zinc-200 pr-3 dark:border-white/10">
                                {isSubtitleOnly && (
                                    <button
                                        type="button"
                                        onClick={onReset}
                                        aria-label={uiLanguage === 'zh' ? '返回上传' : 'Back to upload'}
                                        className="focus-apple -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                                    >
                                        <ChevronRight className="w-4 h-4 rotate-180" />
                                    </button>
                                )}
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <FileText className="w-4 h-4 text-sky-600 shrink-0 dark:text-sky-300" />
                                    <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200" title={videoMeta.name}>
                                        {videoMeta.name}
                                    </span>
                                </div>
                            </div>
                        )}
                        {/* 字幕预览标签 */}
                        <div className="flex shrink-0 items-center gap-2">
                            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{t.subtitlePreview}</h3>
                            <span className="rounded-full bg-zinc-950/5 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-300">
                                {captions.length}
                            </span>
                        </div>
                    </div>

                    <div className={`subtitle-toolbar-actions transition-opacity duration-200 ${captions.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                        {/* 语言选择 */}
                        <div className="subtitle-toolbar-languages flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white/[0.62] px-2 dark:border-white/10 dark:bg-white/5">
                            <select
                                disabled={captions.length === 0}
                                value={sourceLang}
                                onChange={(e) => setSourceLang(e.target.value)}
                                aria-label={uiLanguage === 'zh' ? '原文语言' : 'Source language'}
                                className="focus-apple min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-xs text-zinc-600 disabled:cursor-not-allowed dark:text-zinc-200"
                            >
                                {LANGUAGES.map(l => (
                                    <option key={l} value={l}>
                                        {t['lang' + l as keyof typeof t] || l}
                                    </option>
                                ))}
                            </select>
                            <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-500" />
                            <select
                                disabled={captions.length === 0}
                                value={targetLang}
                                onChange={(e) => setTargetLang(e.target.value)}
                                aria-label={uiLanguage === 'zh' ? '目标语言' : 'Target language'}
                                className="focus-apple min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-xs text-zinc-600 disabled:cursor-not-allowed dark:text-zinc-200"
                            >
                                {LANGUAGES.map(l => (
                                    <option key={l} value={l}>
                                        {t['lang' + l as keyof typeof t] || l}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 风格平衡器 */}
                        <div className="subtitle-toolbar-style flex min-h-11 items-center gap-2 rounded-lg border border-zinc-200/80 bg-white/[0.62] px-2 dark:border-white/10 dark:bg-white/5">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t.styleLiteral}</span>
                            <input
                                disabled={captions.length === 0}
                                type="range" min="0" max="1" step="0.1"
                                value={styleTemp}
                                onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                                aria-label={t.transStyle}
                                className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:accent-zinc-50"
                            />
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t.styleCreative}</span>
                        </div>

                        <button
                            type="button"
                            disabled={captions.length === 0 || isTranslating || sourceLang === targetLang}
                            onClick={onTranslate}
                            className="subtitle-toolbar-translate focus-apple flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm shadow-zinc-950/15 transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:bg-zinc-300 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300"
                        >
                            {isTranslating && <Loader2 className="w-3 h-3 animate-spin" />}
                            {sourceLang === targetLang ? t.noTranslationNeeded : t.translateNow}
                        </button>

                        <div className="subtitle-toolbar-export">
                            <DownloadDropdown
                                captions={captions}
                                videoName={videoMeta?.name || 'subtitles'}
                                captionMode={captionMode}
                                uiLanguage={uiLanguage}
                                targetLang={targetLang}
                                sourceLang={sourceLang}
                                isTranslating={isTranslating}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="hidden shrink-0 border-b border-zinc-950/5 bg-zinc-950/[0.025] px-4 py-2 text-xs font-medium text-zinc-400 dark:border-white/10 dark:bg-white/[0.035] dark:text-zinc-500 sm:flex">
                <div className="w-32 flex-shrink-0">{t.playPosition}</div>
                {captions.some(c => c.text.includes('\n')) ? (
                    <>
                        <div className="flex-1 px-4 border-r border-zinc-200 dark:border-white/10">{t.original} ({t['lang' + sourceLang as keyof typeof t] || sourceLang})</div>
                        <div className="flex-1 px-4">{t.translation} ({t['lang' + targetLang as keyof typeof t] || targetLang})</div>
                    </>
                ) : (
                    <div className="flex-1 px-4">{t.originalContent}</div>
                )}
                <div className="w-16 text-right">{t.manage}</div>
            </div>

            <div ref={listRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-white/[0.62] dark:bg-zinc-950/30" id="subtitle-list-container" aria-live={isTranslating ? 'polite' : 'off'}>
                {captions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center py-12 text-zinc-300 dark:text-zinc-600">
                        <Files className="w-12 h-12 mb-3 opacity-20" />
                        <p className="text-xs opacity-50">{t.noSubtitles}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-950/5 dark:divide-white/10">
                        {captions.map((cap) => (
                            <SubtitleItem
                                key={cap.id}
                                cap={cap}
                                isActive={activeCaption === cap.text}
                                isEditing={editingId === cap.id}
                                editText={editText}
                                isSubtitleOnly={isSubtitleOnly}
                                onJump={onJump}
                                onEditStart={(text) => onEditStart(cap.id, text)}
                                onEditChange={onEditChange}
                                onEditSave={onEditSave}
                                uiLanguage={uiLanguage}
                            />
                        ))}
                        <div className="h-8" />
                    </div>
                )}
            </div>
        </section>
    );
};
