import React, { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { ExportFormat, CaptionSegment, DownloadMode } from '../types';
import { downloadCaptions } from '../utils/captionUtils';
import { Language, getTranslation } from '../utils/i18n';

interface DownloadDropdownProps {
    captions: CaptionSegment[];
    videoName: string;
    captionMode: string;
    uiLanguage: Language;
    targetLang: string;
    sourceLang: string;
    isTranslating: boolean;
}

export const DownloadDropdown: React.FC<DownloadDropdownProps> = ({
    captions,
    videoName,
    captionMode,
    uiLanguage,
    targetLang,
    sourceLang,
    isTranslating,
}) => {
    const t = getTranslation(uiLanguage);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedMode, setSelectedMode] = useState<DownloadMode>('bilingual');
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('SRT');

    // Check if captions contain translated content (bilingual with newline separator)
    const hasTranslatedContent = captions.some(cap => cap.text.includes('\n'));

    const handleDownload = () => {
        const effectiveMode = hasTranslatedContent ? selectedMode : 'original';
        downloadCaptions(
            captions,
            selectedFormat,
            videoName.split('.')[0] || 'subtitles',
            effectiveMode,
            false,
            { targetLang, sourceLang, uiLanguage }
        );
        setIsOpen(false);
    };

    const contentOptions: { value: DownloadMode; label: string }[] = [
        { value: 'bilingual', label: t.bilingualMode },
        { value: 'translated', label: t.onlyTranslation },
        { value: 'original', label: t.onlyOriginal },
    ];

    const formatOptions: { value: ExportFormat; label: string }[] = [
        { value: 'SRT', label: 'SRT' },
        { value: 'VTT', label: 'VTT' },
        { value: 'TXT', label: t.textOnly },
    ];

    return (
        <div className="relative w-full shrink-0">
            {/* Main button - click to download directly, dropdown arrow for options */}
            <div className="flex min-h-11 items-center overflow-hidden rounded-lg bg-zinc-950 shadow-sm shadow-zinc-950/15 dark:bg-zinc-50">
                <button
                    type="button"
                    disabled={captions.length === 0 || isTranslating}
                    onClick={handleDownload}
                    className="focus-apple flex min-h-11 flex-1 items-center justify-center gap-1.5 pl-3 pr-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:text-zinc-950 dark:hover:bg-zinc-100"
                >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.exportSubtitle}</span>
                </button>
                <div className="h-4 w-px bg-white/20 dark:bg-zinc-950/15" />
                <button
                    type="button"
                    disabled={captions.length === 0 || isTranslating}
                    onClick={() => setIsOpen(!isOpen)}
                    aria-expanded={isOpen}
                    aria-label={uiLanguage === 'zh' ? '选择导出选项' : 'Choose export options'}
                    aria-haspopup="dialog"
                    className="focus-apple flex min-h-11 items-center px-2 text-xs text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:text-zinc-950 dark:hover:bg-zinc-100"
                >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
                    <div className="app-popover animate-popover-in absolute right-0 top-full z-[70] mt-2 w-48 origin-top-right overflow-hidden rounded-lg p-2" role="dialog" aria-label={uiLanguage === 'zh' ? '导出选项' : 'Export options'}>
                        {/* Content Selection - only show when translated content exists */}
                        {hasTranslatedContent && (
                            <div className="border-b border-zinc-950/5 pb-2 dark:border-white/10">
                                <label className="mb-1 block px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                    {t.contentType}
                                </label>
                                <div className="space-y-0.5">
                                    {contentOptions.map(option => (
                                        <label
                                            key={option.value}
                                            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-950/5 dark:text-zinc-200 dark:hover:bg-white/10"
                                        >
                                            <input
                                                type="radio"
                                                name="contentMode"
                                                value={option.value}
                                                checked={selectedMode === option.value}
                                                onChange={() => setSelectedMode(option.value)}
                                                className="h-3 w-3 border-zinc-300 text-zinc-950 focus:ring-zinc-500 dark:border-zinc-600 dark:text-zinc-50"
                                            />
                                            <span>{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Format Selection */}
                        <div className={hasTranslatedContent ? 'pt-2' : ''}>
                            <label className="mb-1 block px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                {t.formatType}
                            </label>
                            <div className="space-y-0.5">
                                {formatOptions.map(option => (
                                    <label
                                        key={option.value}
                                        className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-950/5 dark:text-zinc-200 dark:hover:bg-white/10"
                                    >
                                        <input
                                            type="radio"
                                            name="formatType"
                                            value={option.value}
                                            checked={selectedFormat === option.value}
                                            onChange={() => setSelectedFormat(option.value)}
                                            className="h-3 w-3 border-zinc-300 text-zinc-950 focus:ring-zinc-500 dark:border-zinc-600 dark:text-zinc-50"
                                        />
                                        <span>{option.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
