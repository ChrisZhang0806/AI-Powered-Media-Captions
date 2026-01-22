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

    const formatOptions: ExportFormat[] = ['SRT', 'VTT'];

    return (
        <div className="relative">
            {/* Main button - click to download directly, dropdown arrow for options */}
            <div className="flex items-center bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <button
                    disabled={captions.length === 0 || isTranslating}
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 hover:bg-slate-700 text-white text-[11px] transition-colors disabled:opacity-40"
                >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.exportSubtitle}</span>
                </button>
                <div className="w-px h-4 bg-slate-600/50" />
                <button
                    disabled={captions.length === 0 || isTranslating}
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center px-2 py-1.5 hover:bg-slate-700 text-white text-[11px] transition-colors disabled:opacity-40"
                >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-slate-200 rounded-lg shadow-xl z-[70] overflow-hidden animate-in fade-in zoom-in slide-in-from-top-2 duration-100 origin-top-right">
                        {/* Content Selection - only show when translated content exists */}
                        {hasTranslatedContent && (
                            <div className="px-2.5 py-2 border-b border-slate-100">
                                <label className="text-[9px] text-slate-400 uppercase tracking-wider mb-1 block">
                                    {t.contentType}
                                </label>
                                <div className="space-y-0.5">
                                    {contentOptions.map(option => (
                                        <label
                                            key={option.value}
                                            className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer transition-colors"
                                        >
                                            <input
                                                type="radio"
                                                name="contentMode"
                                                value={option.value}
                                                checked={selectedMode === option.value}
                                                onChange={() => setSelectedMode(option.value)}
                                                className="w-3 h-3 text-slate-700 border-slate-300 focus:ring-slate-500"
                                            />
                                            <span className="text-[11px] text-slate-700">{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Format Selection - radio options */}
                        <div className="px-2.5 py-2">
                            <label className="text-[9px] text-slate-400 uppercase tracking-wider mb-1 block">
                                {t.formatType}
                            </label>
                            <div className="space-y-0.5">
                                {formatOptions.map(format => (
                                    <label
                                        key={format}
                                        className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer transition-colors"
                                    >
                                        <input
                                            type="radio"
                                            name="formatType"
                                            value={format}
                                            checked={selectedFormat === format}
                                            onChange={() => setSelectedFormat(format)}
                                            className="w-3 h-3 text-slate-700 border-slate-300 focus:ring-slate-500"
                                        />
                                        <span className="text-[11px] text-slate-700">{format}</span>
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
