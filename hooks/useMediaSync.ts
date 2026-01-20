import { useState, useEffect } from 'react';
import { CaptionSegment } from '../types';
import { timeToSeconds } from '../utils/helpers';

interface UseMediaSyncOptions {
    mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement | null>;
    captions: CaptionSegment[];
}

export const useMediaSync = ({ mediaRef, captions }: UseMediaSyncOptions) => {
    const [activeCaption, setActiveCaption] = useState<string | null>(null);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        const handleTimeUpdate = () => {
            const currentTime = media.currentTime;
            const currentCap = captions.find(cap => {
                const start = timeToSeconds(cap.startTime);
                const end = timeToSeconds(cap.endTime);
                return currentTime >= start && currentTime <= end;
            });
            setActiveCaption(currentCap ? currentCap.text : null);
        };

        media.addEventListener('timeupdate', handleTimeUpdate);
        return () => media.removeEventListener('timeupdate', handleTimeUpdate);
    }, [captions, mediaRef]);

    const jumpToTime = (timeStr: string) => {
        if (mediaRef.current) {
            mediaRef.current.currentTime = timeToSeconds(timeStr);
            mediaRef.current.play();
        }
    };

    return { activeCaption, setActiveCaption, jumpToTime };
};
