import React from 'react';
import { Save, Edit2 } from 'lucide-react';
import { CaptionSegment } from '../types';

interface SubtitleItemProps {
    cap: CaptionSegment;
    isActive: boolean;
    isEditing: boolean;
    editText: string;
    onJump: (time: string) => void;
    onEditStart: (text: string) => void;
    onEditChange: (text: string) => void;
    onEditSave: () => void;
}

export const SubtitleItem: React.FC<SubtitleItemProps> = ({
    cap,
    isActive,
    isEditing,
    editText,
    onJump,
    onEditStart,
    onEditChange,
    onEditSave
}) => {
    const textParts = cap.text.split('\n');
    const isBilingual = textParts.length > 1;

    return (
        <div className={`group flex items-start px-4 py-3 transition-colors ${isActive ? 'bg-primary-50/60 ring-1 ring-inset ring-primary-100' : 'hover:bg-slate-50/80'}`}>
            {/* Time Column */}
            <div className="w-32 flex-shrink-0 pt-1">
                <button
                    onClick={() => onJump(cap.startTime)}
                    className={`flex flex-col items-start gap-1 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-400 hover:text-primary-500'}`}
                >
                    <span className="text-[10px] font-mono ">{cap.startTime}</span>
                    <span className="text-[10px] font-mono opacity-60">{cap.endTime}</span>
                </button>
            </div>

            {/* Content Column */}
            <div className="flex-1 px-4 min-w-0">
                {isEditing ? (
                    <textarea
                        className="w-full text-sm text-slate-800 bg-white border-slate-200 rounded-lg focus:ring-1 focus:ring-primary-500 p-2 min-h-[70px]"
                        value={editText}
                        onChange={(e) => onEditChange(e.target.value)}
                        autoFocus
                    />
                ) : (
                    <div className={`text-sm leading-relaxed break-words ${isActive ? 'text-primary-900' : 'text-slate-700'}`}>
                        {isBilingual ? (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                                    <span className="text-[10px] text-slate-400 uppercase block mb-1 ">Original</span>
                                    {textParts[0]}
                                </div>
                                <div className="p-2.5 bg-primary-50/30 rounded-lg border border-primary-100/50">
                                    <span className="text-[10px] text-primary-400 uppercase block mb-1 ">Translation</span>
                                    <span className="text-primary-900">{textParts[1]}</span>
                                </div>
                            </div>
                        ) : (
                            cap.text
                        )}
                    </div>
                )}
            </div>

            {/* Action Column */}
            <div className="w-16 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isEditing ? (
                    <button
                        onClick={onEditSave}
                        className="p-1.5 text-green-600 hover:bg-green-100 rounded"
                    >
                        <Save className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        onClick={() => onEditStart(cap.text)}
                        className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-white rounded border border-transparent hover:border-slate-200"
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
};
