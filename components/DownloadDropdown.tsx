import React, { useState } from 'react';
import { ExportFormat, CaptionSegment } from '../types';
import { downloadCaptions } from '../utils/captionUtils';
import { Language, getTranslation } from '../utils/i18n';
import { MaterialIcon } from './MaterialIcon';

interface DownloadDropdownProps {
    captions: CaptionSegment[];
    videoName: string;
    uiLanguage: Language;
}

export const DownloadDropdown: React.FC<DownloadDropdownProps> = ({
    captions,
    videoName,
    uiLanguage,
}) => {
    const t = getTranslation(uiLanguage);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('SRT');

    const handleDownload = () => {
        downloadCaptions(
            captions,
            selectedFormat,
            videoName.split('.')[0] || 'subtitles'
        );
        setIsOpen(false);
    };

    const formatOptions: { value: ExportFormat; label: string }[] = [
        { value: 'SRT', label: 'SRT' },
        { value: 'VTT', label: 'VTT' },
        { value: 'TXT', label: t.textOnly },
    ];

    return (
        <div className="relative w-full shrink-0">
            {/* Main button - click to download directly, dropdown arrow for options */}
            <div className="flex min-h-11 items-center overflow-hidden rounded-full bg-primary shadow-md">
                <button
                    type="button"
                    disabled={captions.length === 0}
                    onClick={handleDownload}
                    className="focus-apple flex min-h-11 flex-1 items-center justify-center gap-2 pl-6 pr-3 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                    <MaterialIcon name="download" size={20} />
                    <span>{t.exportSubtitle}</span>
                </button>
                <div className="h-5 w-px bg-on-primary/30" />
                <button
                    type="button"
                    disabled={captions.length === 0}
                    onClick={() => setIsOpen(!isOpen)}
                    aria-expanded={isOpen}
                    aria-label={t.selectExportOptions}
                    aria-haspopup="dialog"
                    className="focus-apple flex min-h-11 items-center pl-3 pr-4 text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                    <MaterialIcon name="keyboard_arrow_down" size={20} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
                    <div className="app-popover animate-popover-in absolute right-0 top-full z-[70] mt-2 w-48 origin-top-right overflow-hidden rounded-xl p-2" role="dialog" aria-label={t.exportOptions}>
                        <div>
                            <label className="mb-1 block px-1 text-[11px] font-medium text-outline">
                                {t.formatType}
                            </label>
                            <div className="space-y-0.5">
                                {formatOptions.map(option => (
                                    <label
                                        key={option.value}
                                        className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
                                    >
                                        <input
                                            type="radio"
                                            name="formatType"
                                            value={option.value}
                                            checked={selectedFormat === option.value}
                                            onChange={() => setSelectedFormat(option.value)}
                                            className="h-4 w-4 border-outline-variant text-primary focus:ring-primary"
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
