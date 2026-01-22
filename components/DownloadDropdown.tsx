import React from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { ExportFormat, CaptionSegment, DownloadMode } from '../types';
import { downloadCaptions } from '../utils/captionUtils';
import { truncateFileName } from '../utils/helpers';

interface DownloadDropdownProps {
    captions: CaptionSegment[];
    videoName: string;
    captionMode: string;
    downloadDropdownFormat: ExportFormat | null;
    setDownloadDropdownFormat: (format: ExportFormat | null) => void;
    bilingualExportSeparate: boolean;
}

export const DownloadDropdown: React.FC<DownloadDropdownProps> = ({
    captions,
    videoName,
    captionMode,
    downloadDropdownFormat,
    setDownloadDropdownFormat,
    bilingualExportSeparate,
}) => {
    const handleDownload = (format: ExportFormat, mode: DownloadMode) => {
        downloadCaptions(captions, format, videoName.split('.')[0] || 'subtitles', mode, bilingualExportSeparate);
        setDownloadDropdownFormat(null);
    };

    const renderDropdownContent = (format: ExportFormat) => (
        <>
            <div className="fixed inset-0 z-[60]" onClick={() => setDownloadDropdownFormat(null)} />
            <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-[70] py-1 overflow-hidden animate-in fade-in zoom-in slide-in-from-top-2 duration-100 origin-top-right">
                <button
                    onClick={() => handleDownload(format, 'bilingual')}
                    className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                    双语对照
                </button>
                <button
                    onClick={() => handleDownload(format, 'translated')}
                    className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                >
                    仅译文
                </button>
                <button
                    onClick={() => handleDownload(format, 'original')}
                    className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 border-t border-slate-50"
                >
                    仅原文
                </button>
            </div>
        </>
    );

    return (
        <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
                <button
                    disabled={captions.length === 0}
                    onClick={() => {
                        if (captionMode === 'Original') {
                            downloadCaptions(captions, 'SRT', videoName.split('.')[0] || 'subtitles', 'original');
                        } else {
                            setDownloadDropdownFormat(downloadDropdownFormat === 'SRT' ? null : 'SRT');
                        }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] border border-slate-200 transition-colors disabled:opacity-40"
                >
                    <Download className="w-3 h-3" /> SRT {captionMode !== 'Original' && <ChevronDown className={`w-3 h-3 transition-transform ${downloadDropdownFormat === 'SRT' ? 'rotate-180' : ''}`} />}
                </button>
                {captionMode !== 'Original' && downloadDropdownFormat === 'SRT' && renderDropdownContent('SRT')}
            </div>

            <div className="relative">
                <button
                    disabled={captions.length === 0}
                    onClick={() => {
                        if (captionMode === 'Original') {
                            downloadCaptions(captions, 'VTT', videoName.split('.')[0] || 'subtitles', 'original');
                        } else {
                            setDownloadDropdownFormat(downloadDropdownFormat === 'VTT' ? null : 'VTT');
                        }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] border border-slate-200 transition-colors disabled:opacity-40"
                >
                    <Download className="w-3 h-3" /> VTT {captionMode !== 'Original' && <ChevronDown className={`w-3 h-3 transition-transform ${downloadDropdownFormat === 'VTT' ? 'rotate-180' : ''}`} />}
                </button>
                {captionMode !== 'Original' && downloadDropdownFormat === 'VTT' && renderDropdownContent('VTT')}
            </div>
        </div>
    );
};
