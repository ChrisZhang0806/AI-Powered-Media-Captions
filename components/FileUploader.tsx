import React, { useRef, useState } from 'react';
import { FileVideo, Music, FileText, Upload } from 'lucide-react';
import { Language, getTranslation } from '../utils/i18n';

interface FileUploaderProps {
    onFileSelect: (file: File) => Promise<void>;
    uiLanguage: Language;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, uiLanguage }) => {
    const t = getTranslation(uiLanguage);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const supportTextId = 'supported-file-formats';

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            await onFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            await onFileSelect(e.target.files[0]);
        }
    };

    return (
        <section className="mx-auto flex max-w-5xl flex-col gap-4 py-5 lg:py-8">
            <div className="mx-auto max-w-3xl space-y-2 text-center">
                <h2 className="break-words text-2xl font-semibold leading-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">{t.mainTitle}</h2>
                <p className="text-sm leading-6 text-zinc-600 sm:text-base dark:text-zinc-300">{t.mainSubtitle}</p>
            </div>
            <button
                type="button"
                className={`focus-apple app-panel group relative mx-auto flex min-h-[300px] w-full max-w-3xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed p-8 text-center transition-all duration-300 sm:p-10 ${isDragging
                    ? 'border-sky-400 bg-sky-50/80 shadow-xl shadow-sky-500/10 scale-[1.01] dark:bg-sky-400/10'
                    : 'border-zinc-300/80 hover:border-sky-400 hover:bg-white/90 dark:border-white/15 dark:hover:border-sky-300 dark:hover:bg-white/10'
                    }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                aria-label={t.uploadTip}
                aria-describedby={supportTextId}
            >
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-lg shadow-zinc-950/20 transition-transform duration-300 group-hover:scale-[1.03] dark:bg-zinc-50 dark:text-zinc-950">
                    <Upload className="h-7 w-7" />
                </div>
                <p className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t.uploadTip}</p>
                <p id={supportTextId} className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t.supportFormat}</p>
                <div className="mt-5 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/10">
                        <FileVideo className="h-4 w-4" />
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/10">
                        <Music className="h-4 w-4" />
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/10">
                        <FileText className="h-4 w-4" />
                    </span>
                </div>
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="video/*,audio/*,.srt,.vtt,.ts"
                    onChange={handleFileChange}
                />
            </button>
        </section>
    );
};
