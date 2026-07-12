const KNOWN_HALLUCINATION_PATTERNS = [
    /amara\s*\.?\s*org/i,
    /字幕(?:由|来自).*amara/i,
    /amara.*(?:社区|社區).*提供/i,
    /(?:字幕|翻译|翻譯).*(?:社区|社區).*提供/i,
    /^\s*org\s*(?:社区|社區)提供[。.!！]?\s*$/i,
    /(?:subtitles?|captions?).*(?:by|provided by).*amara/i,
    /translated by.*amara/i
];

const normalizeText = (text) => String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

export const isKnownSubtitleCreditHallucination = (text) => {
    const rawText = String(text || '').normalize('NFKC');
    return KNOWN_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(rawText));
};

export const getRejectionReason = (segment) => {
    const text = String(segment?.text || '').trim();
    if (!text) return 'empty';
    if (isKnownSubtitleCreditHallucination(text)) return 'known-subtitle-credit';

    const noSpeechProbability = Number(segment?.no_speech_prob);
    const averageLogProbability = Number(segment?.avg_logprob);
    const compressionRatio = Number(segment?.compression_ratio);

    if (
        Number.isFinite(noSpeechProbability)
        && Number.isFinite(averageLogProbability)
        && noSpeechProbability >= 0.6
        && averageLogProbability <= -0.5
    ) {
        return 'probable-silence';
    }
    if (Number.isFinite(averageLogProbability) && averageLogProbability <= -1.2) {
        return 'very-low-confidence';
    }
    if (Number.isFinite(compressionRatio) && compressionRatio >= 2.4) {
        return 'decoder-repetition';
    }
    return null;
};

export const filterWhisperSegments = (segments, onReject) => {
    const accepted = [];
    for (const segment of Array.isArray(segments) ? segments : []) {
        const reason = getRejectionReason(segment);
        if (reason) {
            onReject?.(segment, reason);
            continue;
        }
        accepted.push(segment);
    }
    return accepted;
};

export const suppressRepeatedCaptions = (segments) => {
    const result = [];
    const recentOccurrences = new Map();

    for (const segment of segments) {
        const normalized = normalizeText(segment.text);
        if (!normalized) continue;

        const previousStarts = (recentOccurrences.get(normalized) || [])
            .filter((start) => segment.start - start <= 30);
        const isLowConfidence = Number.isFinite(Number(segment.avg_logprob))
            && Number(segment.avg_logprob) < -0.5;

        // Keep two repetitions because repeated speech is common; suppress a loop
        // only when the decoder is also signaling weak confidence.
        if (isLowConfidence && previousStarts.length >= 2) continue;

        previousStarts.push(segment.start);
        recentOccurrences.set(normalized, previousStarts);
        result.push(segment);
    }
    return result;
};
