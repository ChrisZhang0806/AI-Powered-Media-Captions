import { useRef, useEffect } from 'react';

interface UseAudioAnalyserOptions {
    mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement | null>;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    isAudio: boolean;
}

export const useAudioAnalyser = ({ mediaRef, canvasRef, isAudio }: UseAudioAnalyserOptions) => {
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const animationRef = useRef<number>(0);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media || !isAudio) return;

        const initAudioAnalyser = () => {
            if (audioContextRef.current) return; // 已初始化

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.8;

            const source = audioContext.createMediaElementSource(media);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;
            sourceRef.current = source;
        };

        const drawWaveform = () => {
            const canvas = canvasRef.current;
            const analyser = analyserRef.current;
            if (!canvas || !analyser) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 0.8;
            const gap = (canvas.width / bufferLength) * 0.2;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.9;

                // 渐变色
                const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, '#71717a'); // primary-500
                gradient.addColorStop(1, '#27272a'); // primary-600

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.roundRect(x, canvas.height - barHeight, barWidth, barHeight, 2);
                ctx.fill();

                x += barWidth + gap;
            }

            animationRef.current = requestAnimationFrame(drawWaveform);
        };

        const handlePlay = () => {
            initAudioAnalyser();
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }
            drawWaveform();
        };

        const handlePause = () => {
            cancelAnimationFrame(animationRef.current);
        };

        media.addEventListener('play', handlePlay);
        media.addEventListener('pause', handlePause);
        media.addEventListener('ended', handlePause);

        return () => {
            media.removeEventListener('play', handlePlay);
            media.removeEventListener('pause', handlePause);
            media.removeEventListener('ended', handlePause);
            cancelAnimationFrame(animationRef.current);
        };
    }, [isAudio, mediaRef, canvasRef]);

    return { audioContextRef, analyserRef };
};
