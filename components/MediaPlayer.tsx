import React from 'react';
import { VideoMetadata } from '../types';

interface MediaPlayerProps {
    videoMeta: VideoMetadata | null;
    isAudio: boolean;
    mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement | any>; // Using any to avoid TS issues with dual type
    canvasRef: React.RefObject<HTMLCanvasElement>;
    activeCaption: string | null;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
    videoMeta,
    isAudio,
    mediaRef,
    canvasRef,
    activeCaption
}) => {
    if (!videoMeta) return null;

    return (
        <div className={`rounded-xl overflow-hidden shadow-lg h-64 lg:h-80 ring-1 ring-slate-900/5 shrink-0 relative flex flex-col items-center justify-center ${isAudio ? 'bg-gradient-to-br from-slate-800 to-slate-950' : 'bg-black'}`}>
            {isAudio ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 gap-6 relative">
                    {/* 实时音频波形 */}
                    <canvas
                        ref={canvasRef}
                        width={320}
                        height={80}
                        className="w-80 h-20"
                    />
                    {/* Audio Subtitle Display */}
                    {activeCaption && (
                        <div className="absolute inset-0 flex items-center justify-center p-8 bg-black/40 backdrop-blur-sm pointer-events-none transition-opacity">
                            <p className="text-white text-lg text-center leading-relaxed drop-shadow-md">
                                {activeCaption.split('\n').map((line, i) => (
                                    <span key={i} className={i > 0 ? 'block text-primary-300 text-sm mt-1' : 'block'}>{line}</span>
                                ))}
                            </p>
                        </div>
                    )}
                    <audio ref={mediaRef} src={videoMeta.url} controls className="w-full max-w-sm accent-primary-600 mt-auto" />
                </div>
            ) : (
                <>
                    <video ref={mediaRef} src={videoMeta.url} controls className="w-full h-full" />
                    {/* Video Subtitle Overlay */}
                    {activeCaption && (
                        <div className="absolute bottom-16 left-0 right-0 px-6 flex justify-center pointer-events-none transition-all">
                            <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10 shadow-2xl">
                                <p className="text-white text-base sm:text-lg text-center leading-snug tracking-wide">
                                    {activeCaption.split('\n').map((line, i) => (
                                        <span key={i} className={i > 0 ? 'block text-primary-300 text-sm mt-0.5 ' : 'block'}>{line}</span>
                                    ))}
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
