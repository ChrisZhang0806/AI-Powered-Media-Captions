import React from 'react';
import { FileVideo } from 'lucide-react';
import { VideoMetadata } from '../types';
import { Language, getTranslation } from '../utils/i18n';

interface MediaPlayerProps {
    videoMeta: VideoMetadata | null;
    isAudio: boolean;
    mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement | any>; // Using any to avoid TS issues with dual type
    canvasRef: React.RefObject<HTMLCanvasElement>;
    activeCaption: string | null;
    uiLanguage: Language;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
    videoMeta,
    isAudio,
    mediaRef,
    canvasRef,
    activeCaption,
    uiLanguage
}) => {
    if (!videoMeta) return null;
    const t = getTranslation(uiLanguage);

    return (
        <div className={`app-panel media-chrome relative flex h-64 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg lg:h-[280px] ${isAudio ? 'bg-gradient-to-br from-zinc-800 via-zinc-900 to-black' : 'bg-black'}`}>
            {videoMeta.previewAvailable === false ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center text-zinc-300">
                    <FileVideo className="h-10 w-10" aria-hidden="true" />
                    <p className="max-w-sm text-sm leading-relaxed">{t.previewUnavailable}</p>
                </div>
            ) : isAudio ? (
                <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 p-6">
                    {/* 实时音频波形 */}
                    <canvas
                        ref={canvasRef}
                        width={320}
                        height={80}
                        className="h-20 w-full max-w-80"
                    />
                    {/* Audio Subtitle Display */}
                    {activeCaption && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-8 backdrop-blur-md pointer-events-none transition-opacity" aria-live="polite">
                            <p className="max-w-xl text-center text-lg leading-relaxed text-white drop-shadow-md">
                                {activeCaption.split('\n').map((line, i) => (
                                    <span key={i} className={i > 0 ? 'mt-1 block text-sm text-sky-200' : 'block'}>{line}</span>
                                ))}
                            </p>
                        </div>
                    )}
                    <audio
                        ref={mediaRef}
                        src={videoMeta.url}
                        controls
                        className="mt-auto w-full max-w-sm accent-sky-600"
                        aria-label={videoMeta.name}
                    />
                </div>
            ) : (
                <>
                    <video
                        ref={mediaRef}
                        src={videoMeta.url}
                        controls
                        playsInline
                        className="h-full w-full"
                        aria-label={videoMeta.name}
                    />
                    {/* Video Subtitle Overlay */}
                    {activeCaption && (
                        <div className="absolute bottom-16 left-0 right-0 flex justify-center px-6 pointer-events-none transition-all" aria-live="polite">
                            <div className="max-w-[88%] rounded-lg border border-white/15 bg-black/[0.62] px-4 py-2 shadow-2xl backdrop-blur-md">
                                <p className="text-center text-base leading-snug text-white sm:text-lg">
                                    {activeCaption.split('\n').map((line, i) => (
                                        <span key={i} className={i > 0 ? 'mt-0.5 block text-sm text-sky-200' : 'block'}>{line}</span>
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
