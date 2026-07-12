import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CaptionSegment, VideoMetadata } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { DownloadDropdown } from './DownloadDropdown';
import { SubtitleItem } from './SubtitleItem';
import { MaterialIcon } from './MaterialIcon';

interface SubtitleListProps {
    captions: CaptionSegment[];
    activeCaption: string | null;
    videoMeta: VideoMetadata | null;
    editingId: number | null;
    editText: string;
    isSubtitleOnly?: boolean;
    uiLanguage: Language;

    onJump: (time: string) => void;
    onEditStart: (id: number, text: string) => void;
    onEditChange: (text: string) => void;
    onEditSave: () => void;

}

export const SubtitleList: React.FC<SubtitleListProps> = ({
    captions,
    activeCaption,
    videoMeta,
    editingId,
    editText,
    isSubtitleOnly,
    uiLanguage,

    onJump,
    onEditStart,
    onEditChange,
    onEditSave,
}) => {
    const t = getTranslation(uiLanguage);
    const listRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: captions.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => isSubtitleOnly ? 112 : 104,
        getItemKey: (index) => captions[index]?.id ?? index,
        overscan: 8
    });

    return (
        <section className="app-panel panel-elevated flex h-[min(72vh,720px)] flex-col overflow-hidden rounded-2xl lg:h-full" aria-label={t.subtitlePreview}>
            <div className="subtitle-toolbar sticky top-0 z-20 border-b border-surface-variant bg-surface-container-low px-5 py-4 sm:px-6">
                <div className="subtitle-toolbar-layout">
                    <div className="subtitle-toolbar-meta">
                        <div className="min-w-0">
                            <div className="flex items-center gap-3">
                                <h2 className="text-[22px] font-medium leading-7 text-on-surface">{t.subtitlePreview}</h2>
                                <span className="rounded-full bg-surface-variant px-2 py-0.5 text-[11px] font-medium leading-4 text-on-surface-variant">
                                    {captions.length}
                                </span>
                            </div>
                            {videoMeta && captions.length > 0 && (
                                <p className="mt-0.5 truncate text-xs text-outline" title={videoMeta.name}>{videoMeta.name}</p>
                            )}
                        </div>
                    </div>

                    <div className={`subtitle-toolbar-actions transition-opacity duration-200 ${captions.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="subtitle-toolbar-export">
                            <DownloadDropdown
                                captions={captions}
                                videoName={videoMeta?.name || 'subtitles'}
                                uiLanguage={uiLanguage}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="hidden shrink-0 grid-cols-12 gap-4 overflow-hidden border-b border-surface-variant bg-surface-container-highest/30 px-6 py-2 text-sm font-medium leading-5 text-on-surface-variant [scrollbar-gutter:stable] sm:grid">
                <div className="col-span-2">{t.playPosition}</div>
                <div className="col-span-8">{t.originalContent}</div>
                <div className="col-span-2 flex justify-end">
                    <span className="flex w-11 justify-center">{t.manage}</span>
                </div>
            </div>

            <div ref={listRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-surface-container-low [scrollbar-gutter:stable]" id="subtitle-list-container" aria-live="polite">
                {captions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-outline opacity-70">
                        <MaterialIcon name="closed_caption_off" size={56} />
                        <p className="text-base leading-6">{t.noSubtitles}</p>
                    </div>
                ) : (
                    <div
                        className="relative w-full"
                        style={{ height: `${rowVirtualizer.getTotalSize() + 32}px` }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const cap = captions[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    ref={rowVirtualizer.measureElement}
                                    data-index={virtualRow.index}
                                    className="absolute left-0 top-0 w-full border-b border-surface-variant"
                                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                                >
                                    <SubtitleItem
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
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
};
