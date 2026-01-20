import React, { useRef, useState } from 'react';
import { FileVideo, Music, FileText } from 'lucide-react';

interface FileUploaderProps {
    onFileSelect: (file: File) => Promise<void>;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect }) => {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
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
        <div className="max-w-xl mx-auto space-y-8 py-12 text-center">
            <div className="space-y-4">
                <h2 className="text-4xl text-slate-900 tracking-tight">AI 智能音视频转录与翻译</h2>
                <p className="text-lg text-slate-600 ">支持极速转写、语义断句、双语翻译及 SRT/VTT 字幕加工。</p>
            </div>
            <div
                className={`group border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer bg-white shadow-sm flex flex-col items-center justify-center min-h-[300px] ${isDragging
                    ? 'border-primary-500 bg-primary-50 scale-[1.02]'
                    : 'border-slate-300 hover:border-primary-500 hover:bg-primary-50'
                    }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="p-4 bg-primary-100 text-primary-600 rounded-2xl group-hover:scale-110 transition-transform mb-6 flex gap-3">
                    <FileVideo className="w-8 h-8" />
                    <Music className="w-8 h-8" />
                    <FileText className="w-8 h-8" />
                </div>
                <p className="text-xl text-slate-900">点击或拖拽上传媒体或字幕文件</p>
                <p className="text-sm text-slate-400 mt-2 ">支持 MP4, MP3, WAV 及 SRT, VTT 格式</p>
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="video/*,audio/*,.srt,.vtt"
                    onChange={handleFileChange}
                />
            </div>
        </div>
    );
};
