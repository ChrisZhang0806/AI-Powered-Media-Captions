import React from 'react';
import { VideoMetadata, AppStatus, ProgressInfo } from '../types';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { truncateFileName } from '../utils/helpers';
import { Language, getTranslation } from '../utils/i18n';

interface ControlsPanelProps {
    videoMeta: VideoMetadata | null;
    isAudio: boolean;
    status: AppStatus;
    contextPrompt: string;
    setContextPrompt: (s: string) => void;
    progressInfo: ProgressInfo | null;
    captionsCount: number;
    uiLanguage: Language;
    onReset: () => void;
    onProcess: () => void;
}

const formatDuration = (seconds?: number) => {
    if (!seconds || !Number.isFinite(seconds)) return '—';
    const totalSeconds = Math.max(0, Math.round(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
        : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const formatFileSize = (bytes?: number) => {
    if (!bytes || !Number.isFinite(bytes)) return '—';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
};

const formatBitrate = (bitsPerSecond?: number) => {
    if (!bitsPerSecond || !Number.isFinite(bitsPerSecond)) return null;
    return bitsPerSecond >= 1_000_000
        ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
        : `${Math.round(bitsPerSecond / 1000)} kbps`;
};

const formatCodec = (codec?: string) => {
    if (!codec) return null;
    const normalized = codec.toLowerCase();
    if (normalized.startsWith('avc1') || normalized.startsWith('avc3')) return 'H.264';
    if (normalized.startsWith('hvc1') || normalized.startsWith('hev1')) return 'HEVC';
    if (normalized.startsWith('av01')) return 'AV1';
    if (normalized.startsWith('vp09')) return 'VP9';
    if (normalized === 'mp4a.40.2') return 'AAC-LC';
    if (normalized.startsWith('mp4a')) return 'AAC';
    if (['lpcm', 'twos', 'sowt', 'in24', 'in32'].includes(normalized)) return 'Linear PCM';
    return codec.toUpperCase();
};

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
    videoMeta,
    isAudio,
    status,
    contextPrompt,
    setContextPrompt,
    progressInfo,
    captionsCount,
    uiLanguage,
    onReset,
    onProcess
}) => {
    const t = getTranslation(uiLanguage);
    const progressValue = Math.min(100, Math.max(0, progressInfo?.progress ?? (captionsCount > 0 ? 82 : 18)));
    const videoDetails = [
        formatCodec(videoMeta?.videoCodec),
        formatBitrate(videoMeta?.videoBitrate)
    ].filter(Boolean).join(' · ') || '—';
    const audioDetails = [
        formatCodec(videoMeta?.audioCodec),
        videoMeta?.sampleRate ? `${Math.round(videoMeta.sampleRate / 100) / 10} kHz` : null,
        videoMeta?.audioChannels === 1
            ? t.mono
            : videoMeta?.audioChannels === 2
                ? t.stereo
                : videoMeta?.audioChannels
                    ? `${videoMeta.audioChannels} ch`
                    : null,
        formatBitrate(videoMeta?.audioBitrate)
    ].filter(Boolean).join(' · ') || '—';
    const formatDetails = [
        videoMeta?.container,
        formatBitrate(videoMeta?.bitrate)
    ].filter(Boolean).join(' · ') || '—';
    const overviewItems = [
        { label: t.mediaFormat, value: formatDetails },
        { label: t.mediaDuration, value: formatDuration(videoMeta?.duration) },
        {
            label: t.mediaResolution,
            value: videoMeta?.width && videoMeta?.height ? `${Math.round(videoMeta.width)} × ${Math.round(videoMeta.height)}` : '—'
        },
        { label: t.mediaFileSize, value: formatFileSize(videoMeta?.size) }
    ];
    const technicalItems = [
        { label: t.mediaVideoCodec, value: videoDetails },
        { label: t.mediaAudioCodec, value: audioDetails }
    ];

    return (
        <div className="app-panel flex min-h-[300px] flex-col overflow-hidden rounded-2xl p-4 lg:min-h-0 lg:flex-1">
            <div className="border-b border-surface-variant pb-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <MaterialIcon name={isAudio ? 'audio_file' : 'video_file'} size={24} className="text-on-surface-variant" />
                        <span className="truncate text-sm font-medium leading-5 text-on-surface" title={videoMeta?.name || ''}>{truncateFileName(videoMeta?.name || '')}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onReset}
                        aria-label={t.removeFile}
                        className="focus-apple flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-outline transition-colors hover:bg-error-container hover:text-error"
                    >
                        <MaterialIcon name="delete" size={20} />
                    </button>
                </div>

                <div className="mt-4">
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 min-[1400px]:grid-cols-[minmax(0,1.25fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
                        {overviewItems.map((item) => (
                            <div key={item.label} className="min-w-0">
                                <dt className="text-[10px] font-medium leading-3.5 text-outline">{item.label}</dt>
                                <dd className="mt-0.5 whitespace-nowrap text-sm font-medium leading-[18px] text-on-surface-variant">{item.value}</dd>
                            </div>
                        ))}
                    </dl>

                    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-surface-variant pt-3">
                        {technicalItems.map((item) => (
                            <div key={item.label} className="flex items-baseline gap-2">
                                <dt className="shrink-0 text-[10px] font-medium leading-4 text-outline">{item.label}</dt>
                                <dd className="whitespace-nowrap text-xs leading-4 text-on-surface-variant">{item.value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            {status === AppStatus.IDLE && (
                <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                        <div className="flex shrink-0 items-center justify-between">
                            <label className="text-xs font-medium leading-4 text-on-surface-variant">{t.contextPrompt}</label>
                            <span className="text-[10px] leading-3.5 text-outline">{t.contextPromptTip}</span>
                        </div>
                        <textarea
                            value={contextPrompt}
                            onChange={(e) => setContextPrompt(e.target.value)}
                            placeholder={t.contextPromptPlaceholder}
                            className="focus-apple min-h-16 w-full flex-1 resize-none rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] leading-[18px] text-on-surface outline-none transition-colors placeholder:text-outline"
                        />
                    </div>

                    <Button onClick={onProcess} className="w-full shrink-0">{t.startProcess}</Button>
                </div>
            )}

            {status === AppStatus.PROCESSING && (
                <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8" aria-live="polite" aria-busy="true">
                    <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary" />
                    <div className="w-full space-y-3 text-center">
                        <p className="min-h-7 whitespace-nowrap text-lg font-medium leading-7 text-on-surface">
                            {progressInfo?.stageLabel || t.progressPreparing}
                        </p>
                        <p
                            className={`min-h-5 whitespace-nowrap text-sm leading-5 tabular-nums text-on-surface-variant ${progressInfo?.detail ? 'visible' : 'invisible'}`}
                        >
                            {progressInfo?.detail || '\u00a0'}
                        </p>

                        <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-container-highest" role="progressbar" aria-valuenow={Math.round(progressValue)} aria-valuemin={0} aria-valuemax={100}>
                            <div
                                className="app-progress-fill h-full w-full rounded-full bg-primary"
                                style={{ transform: `scaleX(${progressValue / 100})` }}
                            />
                        </div>

                    </div>
                </div>
            )}

            {status === AppStatus.SUCCESS && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center" aria-live="polite">
                    <MaterialIcon name="check_circle" size={44} className="text-primary" />
                    <div className="space-y-2">
                        <p className="text-lg font-medium text-on-surface">{t.progressDone}</p>
                        <p className="text-sm leading-5 text-on-surface-variant">
                            {t.completionHint.replace('{count}', captionsCount.toString())}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
