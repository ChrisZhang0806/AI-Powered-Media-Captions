import React from 'react';
import { CaptionSegment } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { MaterialIcon } from './MaterialIcon';

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

    return (
        <div className={`group grid grid-cols-1 gap-4 px-5 py-4 transition-colors sm:grid-cols-12 sm:items-start sm:px-6 ${isActive ? 'bg-primary-fixed/70 ring-1 ring-inset ring-primary-fixed-dim' : 'hover:bg-surface-container-high'}`}>
            {/* Time Column */}
            <div className="sm:col-span-2 sm:pt-1">
                <button
                    type="button"
                    onClick={() => onJump(cap.startTime)}
                    className={`focus-apple flex min-h-11 flex-row items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors sm:-ml-2 sm:flex-col sm:items-start sm:gap-1 ${isActive ? 'text-primary' : 'text-outline hover:text-primary'}`}
                >
                    <span className="text-[11px]">{cap.startTime}</span>
                    <span className="text-[11px] opacity-60">{cap.endTime}</span>
                </button>
            </div>

            {/* Content Column */}
            <div className="min-w-0 sm:col-span-8">
                {isEditing ? (
                    <textarea
                        className="min-h-[92px] w-full resize-none rounded-[4px] border border-outline bg-transparent px-4 py-3 text-sm leading-5 text-on-surface caret-primary outline-none transition-colors hover:border-on-surface focus:border-2 focus:border-primary focus:px-[15px] focus:py-[11px]"
                        value={editText}
                        onChange={(e) => onEditChange(e.target.value)}
                        autoFocus
                    />
                ) : (
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-on-surface">
                        {cap.text}
                    </div>
                )}
            </div>

            {/* Action Column */}
            <div className="flex justify-end gap-1 opacity-100 transition-opacity sm:col-span-2 sm:opacity-0 sm:group-hover:opacity-100">
                {isEditing ? (
                    <button
                        type="button"
                        onClick={onEditSave}
                        aria-label={t.saveCaption}
                        className="focus-apple flex h-11 w-11 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary-fixed"
                    >
                        <MaterialIcon name="save" size={20} />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onEditStart(cap.text)}
                        aria-label={t.editCaption}
                        className="focus-apple flex h-11 w-11 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-highest hover:text-primary"
                    >
                        <MaterialIcon name="edit" size={20} />
                    </button>
                )}
            </div>
        </div>
    );
};
