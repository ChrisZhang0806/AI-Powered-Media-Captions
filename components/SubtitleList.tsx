import React, { useRef, useEffect } from 'react';
import { ChevronRight, FileText, Files, Loader2, ChevronDown } from 'lucide-react';
import { CaptionSegment, VideoMetadata, ExportFormat } from '../types';
import { truncateFileName, LANGUAGES } from '../utils/helpers';
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
    bilingualExportSeparate: boolean;
    downloadDropdownFormat: ExportFormat | null;
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
    setDownloadDropdownFormat: (format: ExportFormat | null) => void;
    setBilingualExportSeparate: (b: boolean) => void;
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
    bilingualExportSeparate,
    downloadDropdownFormat,
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
    setDownloadDropdownFormat,
    setBilingualExportSeparate
}) => {
    const t = getTranslation(uiLanguage);
    const listRef = useRef<HTMLDivElement>(null);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[662px] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3 bg-white sticky top-0 z-20">
                <div className="flex items-center">
                    {/* 左侧：文件标题区域，最多占50%宽度 */}
                    {videoMeta && captions.length > 0 && (
                        <div className="flex items-center gap-2 pr-3 border-r border-slate-200 mr-3 max-w-[50%]">
                            {isSubtitleOnly && (
                                <button onClick={onReset} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors rounded-lg hover:bg-slate-100 -ml-2 shrink-0">
                                    <ChevronRight className="w-4 h-4 rotate-180" />
                                </button>
                            )}
                            <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-4 h-4 text-primary-500 shrink-0" />
                                <span className="text-sm font-medium text-slate-700 truncate" title={videoMeta.name}>
                                    {videoMeta.name}
                                </span>
                            </div>
                        </div>
                    )}
                    {/* 右侧：字幕预览标签 */}
                    <div className="flex items-center gap-2 shrink-0">
                        <h3 className="text-sm text-slate-900">{t.subtitlePreview}</h3>
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                            {captions.length}
                        </span>
                    </div>
                </div>

                <div className={`flex items-center gap-2 pb-1 sm:pb-0 transition-opacity duration-200 ${captions.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                    {/* 语言选择 */}
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                        <select
                            disabled={captions.length === 0}
                            value={sourceLang}
                            onChange={(e) => setSourceLang(e.target.value)}
                            className="bg-transparent border-none p-0 text-[11px] text-slate-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                        >
                            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <select
                            disabled={captions.length === 0}
                            value={targetLang}
                            onChange={(e) => setTargetLang(e.target.value)}
                            className="bg-transparent border-none p-0 text-[11px] text-slate-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                        >
                            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>

                    {/* 风格平衡器 */}
                    <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                        <span className="text-[10px] text-slate-500">{t.styleLiteral}</span>
                        <input
                            disabled={captions.length === 0}
                            type="range" min="0" max="1" step="0.1"
                            value={styleTemp}
                            onChange={(e) => setStyleTemp(parseFloat(e.target.value))}
                            className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span className="text-[10px] text-slate-500">{t.styleCreative}</span>
                    </div>

                    <div className="flex-1" />

                    <button
                        disabled={captions.length === 0 || isTranslating || sourceLang === targetLang}
                        onClick={onTranslate}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-[11px] transition-all shadow-sm hover:shadow active:scale-95 disabled:opacity-40 disabled:bg-slate-300 shrink-0"
                    >
                        {isTranslating && <Loader2 className="w-3 h-3 animate-spin" />}
                        {sourceLang === targetLang ? t.noTranslationNeeded : t.translateNow}
                    </button>

                    <DownloadDropdown
                        captions={captions}
                        videoName={videoMeta?.name || 'subtitles'}
                        captionMode={captionMode}
                        downloadDropdownFormat={downloadDropdownFormat}
                        setDownloadDropdownFormat={setDownloadDropdownFormat}
                        bilingualExportSeparate={bilingualExportSeparate}
                        uiLanguage={uiLanguage}
                    />
                </div>
            </div>

            <div className="flex bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider px-4 py-2 sticky top-0 z-10 shrink-0">
                <div className="w-32 flex-shrink-0">{t.playPosition}</div>
                {isSubtitleOnly ? (
                    <>
                        <div className="flex-1 px-4 border-r border-slate-200">{t.original} ({sourceLang})</div>
                        <div className="flex-1 px-4">{t.translation} ({targetLang})</div>
                    </>
                ) : (
                    <div className="flex-1 px-4">{t.originalContent}</div>
                )}
                <div className="w-16 text-right">{t.manage}</div>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto bg-white custom-scrollbar min-h-0" id="subtitle-list-container">
                {captions.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 py-12">
                        <Files className="w-12 h-12 mb-3 opacity-20" />
                        <p className="text-xs uppercase tracking-widest opacity-40">{t.noSubtitles}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
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

        </div>
    );
};
