import React from 'react';
import { Save, Edit2 } from 'lucide-react';
import { CaptionSegment } from '../types';
import { Language, getTranslation } from '../utils/i18n';

interface SubtitleItemProps {
    cap: CaptionSegment;
    isActive: boolean;
    isEditing: boolean;
    editText: string;
    onJump: (time: string) => void;
    onEditStart: (text: string) => void;
    onEditChange: (text: string) => void;
    onEditSave: () => void;
    isSubtitleOnly?: boolean;
    uiLanguage: Language;
}

export const SubtitleItem: React.FC<SubtitleItemProps> = ({
    cap,
    isActive,
    isEditing,
    editText,
    onJump,
    onEditStart,
    onEditChange,
    onEditSave,
    isSubtitleOnly,
    uiLanguage
}) => {
    const t = getTranslation(uiLanguage);
    const textParts = cap.text.split('\n');
    const isBilingual = textParts.length > 1;

    return (
        <div className={`group grid grid-cols-1 gap-3 px-4 py-3 transition-colors sm:grid-cols-[8rem_minmax(0,1fr)_4rem] sm:items-start ${isActive ? 'bg-sky-50/80 ring-1 ring-inset ring-sky-100 dark:bg-sky-400/10 dark:ring-sky-400/20' : 'hover:bg-white/70 dark:hover:bg-white/5'}`}>
            {/* Time Column */}
            <div className="sm:pt-1">
                <button
                    type="button"
                    onClick={() => onJump(cap.startTime)}
                    className={`focus-apple flex min-h-11 flex-row items-center gap-2 rounded-md px-2 py-1 text-left transition-colors sm:flex-col sm:items-start sm:gap-1 ${isActive ? 'text-sky-700 dark:text-sky-300' : 'text-zinc-400 hover:text-sky-700 dark:text-zinc-500 dark:hover:text-sky-300'}`}
                >
                    <span className="font-mono text-[11px]">{cap.startTime}</span>
                    <span className="font-mono text-[11px] opacity-60">{cap.endTime}</span>
                </button>
            </div>

            {/* Content Column */}
            <div className="min-w-0 sm:px-4">
                {isEditing ? (
                    <textarea
                        className="focus-apple min-h-[92px] w-full rounded-lg border border-zinc-200/80 bg-white/[0.85] p-3 text-sm leading-relaxed text-zinc-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-zinc-50"
                        value={editText}
                        onChange={(e) => onEditChange(e.target.value)}
                        autoFocus
                    />
                ) : (
                    <div className={`break-words text-sm leading-relaxed ${isActive ? 'text-zinc-950 dark:text-zinc-50' : 'text-zinc-700 dark:text-zinc-200'}`}>
                        {isBilingual ? (
                            <div className="grid min-h-[40px] grid-cols-1 gap-3 md:grid-cols-2 md:gap-0">
                                <div className="md:border-r md:border-zinc-200 md:pr-4 dark:md:border-white/10">
                                    {textParts[0]}
                                </div>
                                <div className="text-sky-800 md:pl-4 dark:text-sky-200">
                                    {textParts[1] || <span className="text-[11px] italic text-zinc-300 dark:text-zinc-600">{t.waitingForTranslation}</span>}
                                </div>
                            </div>
                        ) : (
                            cap.text
                        )}
                    </div>
                )}
            </div>

            {/* Action Column */}
            <div className="flex justify-end gap-1 opacity-100 transition-opacity sm:w-16 sm:opacity-0 sm:group-hover:opacity-100">
                {isEditing ? (
                    <button
                        type="button"
                        onClick={onEditSave}
                        aria-label={uiLanguage === 'zh' ? '保存字幕' : 'Save caption'}
                        className="focus-apple flex h-11 w-11 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                    >
                        <Save className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onEditStart(cap.text)}
                        aria-label={uiLanguage === 'zh' ? '编辑字幕' : 'Edit caption'}
                        className="focus-apple flex h-11 w-11 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:border-zinc-200 hover:bg-white hover:text-sky-700 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-sky-300"
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
};
