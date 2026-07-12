import React, { useRef } from 'react';
import { Language, getTranslation } from '../utils/i18n';
import { MaterialIcon } from './MaterialIcon';

interface FileUploaderProps {
    onFileSelect: (file: File) => Promise<void>;
    uiLanguage: Language;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, uiLanguage }) => {
    const t = getTranslation(uiLanguage);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const supportTextId = 'supported-file-formats';

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            await onFileSelect(e.target.files[0]);
            e.target.value = '';
        }
    };

    return (
        <section className="flex min-h-[300px] flex-1 lg:min-h-0">
            <button
                type="button"
                className="focus-apple app-panel group relative flex min-h-[300px] w-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-outline-variant px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary-fixed/30 lg:min-h-0"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t.uploadTip}
                aria-describedby={supportTextId}
            >
                <MaterialIcon name="upload" size={44} className="text-primary transition-transform duration-200 group-hover:-translate-y-0.5" />
                <div className="min-w-0">
                    <p className="text-base font-medium leading-6 text-on-surface">{t.uploadTip}</p>
                    <p id={supportTextId} className="mt-1 text-sm leading-5 text-outline">{t.supportFormat}</p>
                </div>
                <div className="mt-1 flex shrink-0 items-center gap-3 text-outline" aria-hidden="true">
                    <MaterialIcon name="video_file" size={24} />
                    <MaterialIcon name="audio_file" size={24} />
                    <MaterialIcon name="description" size={24} />
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
