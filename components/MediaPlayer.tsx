import React from 'react';
import { VideoMetadata } from '../types';
import { Language, getTranslation } from '../utils/i18n';
import { MaterialIcon } from './MaterialIcon';

interface MediaPlayerProps {
    videoMeta: VideoMetadata | null;
    isAudio: boolean;
    mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement | any>; // Using any to avoid TS issues with dual type
    canvasRef: React.RefObject<HTMLCanvasElement>;
    activeCaption: string | null;
    uiLanguage: Language;
    onMetadataLoaded: (metadata: Pick<VideoMetadata, 'duration' | 'width' | 'height'>) => void;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
    videoMeta,
    isAudio,
    mediaRef,
    canvasRef,
    activeCaption,
    uiLanguage,
    onMetadataLoaded
}) => {
    const t = getTranslation(uiLanguage);

    const handleLoadedMetadata = (event: React.SyntheticEvent<HTMLMediaElement>) => {
        const media = event.currentTarget;
        const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined;
        const video = media as HTMLVideoElement;
        onMetadataLoaded({
            duration,
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined
        });
    };

    return (
        <div className={`app-panel media-chrome relative flex aspect-video w-full shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl ${videoMeta ? '!bg-black' : ''}`}>
            {!videoMeta ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-8 text-center transition-colors hover:bg-surface-variant/40">
                    <MaterialIcon name="smart_display" size={48} className="text-outline" />
                    <p className="text-base font-medium leading-6 text-on-surface-variant">{t.mediaPreview}</p>
                </div>
            ) : videoMeta.previewAvailable === false ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center text-outline">
                    <MaterialIcon name="video_file" size={40} />
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
                                    <span key={i} className={i > 0 ? 'mt-1 block' : 'block'}>{line}</span>
                                ))}
                            </p>
                        </div>
                    )}
                    <audio
                        ref={mediaRef}
                        src={videoMeta.url}
                        controls
                        preload="metadata"
                        onLoadedMetadata={handleLoadedMetadata}
                        className="mt-auto w-full max-w-sm accent-primary"
                        aria-label={videoMeta.name}
                    />
                </div>
            ) : (
                <>
                    <video
                        ref={mediaRef}
                        src={videoMeta.url}
                        controls
                        preload="metadata"
                        playsInline
                        onLoadedMetadata={handleLoadedMetadata}
                        className="h-full w-full"
                        aria-label={videoMeta.name}
                    />
                    {/* Video Subtitle Overlay */}
                    {activeCaption && (
                        <div className="absolute bottom-16 left-0 right-0 flex justify-center px-6 pointer-events-none transition-all" aria-live="polite">
                            <div className="max-w-[88%] rounded-xl border border-white/15 bg-black/[0.62] px-4 py-2 shadow-2xl backdrop-blur-md">
                                <p className="text-center text-base leading-snug text-white sm:text-lg">
                                    {activeCaption.split('\n').map((line, i) => (
                                        <span key={i} className={i > 0 ? 'mt-0.5 block' : 'block'}>{line}</span>
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
