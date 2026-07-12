const STYLE_LIMITS = {
    compact: { chineseChars: 10, latinChars: 28, minChineseChars: 3, maxDuration: 3.5 },
    natural: { chineseChars: 12, latinChars: 36, minChineseChars: 3, maxDuration: 4.5 },
    detailed: { chineseChars: 16, latinChars: 44, minChineseChars: 4, maxDuration: 6 }
};

const hasChinese = (text) => /[\u3400-\u9fff]/.test(text);
const isStrongBoundary = (character) => /[。！？!?；;]/.test(character);
const isSoftBoundary = (character) => /[，,、：:]/.test(character);
const speechLength = (text) => Array.from(String(text || ''))
    .filter((character) => !/[\s\p{P}\p{S}]/u.test(character)).length;

const findChineseCut = (characters, desiredLength, hardLimit) => {
    const limit = Math.min(hardLimit, characters.length);
    const minimum = Math.max(2, Math.floor(desiredLength * 0.6));

    for (let index = limit - 1; index >= minimum - 1; index--) {
        if (isStrongBoundary(characters[index])) return index + 1;
    }
    for (let index = limit - 1; index >= minimum - 1; index--) {
        if (isSoftBoundary(characters[index])) return index + 1;
    }

    const window = characters.slice(0, limit).join('');
    const naturalBreaks = ['是不是', '但是', '所以', '然后', '就是', '还是', '不要', '可以', '因为', '如果', '的话', '是吗', '对吗'];
    let bestCut = -1;
    for (const marker of naturalBreaks) {
        const markerIndex = window.lastIndexOf(marker);
        if (markerIndex >= minimum && markerIndex < limit) bestCut = Math.max(bestCut, markerIndex);
    }
    return bestCut > 0 ? bestCut : limit;
};

const mergeTinyChunks = (chunks, hardLimit) => {
    const result = [];
    for (const chunk of chunks) {
        if (speechLength(chunk) >= 2 || result.length === 0) {
            result.push(chunk);
            continue;
        }
        const previous = result[result.length - 1];
        if (Array.from(previous + chunk).length <= hardLimit) {
            result[result.length - 1] = previous + chunk;
        } else {
            result.push(chunk);
        }
    }
    if (result.length > 1 && speechLength(result[0]) < 2) {
        const combined = result[0] + result[1];
        if (Array.from(combined).length <= hardLimit) result.splice(0, 2, combined);
    }
    return result;
};

const splitChinese = (text, targetCount, hardLimit) => {
    const chunks = [];
    let remaining = Array.from(text.trim());

    while (remaining.length > 0) {
        const chunksLeft = Math.max(1, targetCount - chunks.length);
        const desiredLength = Math.min(hardLimit, Math.ceil(remaining.length / chunksLeft));
        if (remaining.length <= hardLimit && chunksLeft === 1) {
            chunks.push(remaining.join('').trim());
            break;
        }
        const cut = findChineseCut(remaining, desiredLength, Math.min(hardLimit, Math.max(desiredLength, 2)));
        chunks.push(remaining.slice(0, cut).join('').trim());
        remaining = remaining.slice(cut);
    }
    return mergeTinyChunks(chunks.filter(Boolean), hardLimit);
};

const splitLatin = (text, targetCount, hardLimit) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    let buffer = '';

    for (const word of words) {
        const candidate = buffer ? `${buffer} ${word}` : word;
        const chunksLeft = Math.max(1, targetCount - chunks.length);
        const targetLength = Math.min(hardLimit, Math.ceil((text.length - chunks.join(' ').length) / chunksLeft));
        if (buffer && candidate.length > Math.max(targetLength, Math.floor(hardLimit * 0.65))) {
            chunks.push(buffer);
            buffer = word;
        } else {
            buffer = candidate;
        }
    }
    if (buffer) chunks.push(buffer);
    return chunks;
};

const validWordTimings = (segment) => (Array.isArray(segment.words) ? segment.words : [])
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start)
    .sort((a, b) => a.start - b.start);

const allocateUsingWordTimings = (segment, chunks) => {
    const words = validWordTimings(segment);
    if (words.length < chunks.length || words.length === 0) return null;

    const result = [];
    let wordIndex = 0;
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const wordsLeftForLater = chunks.length - chunkIndex - 1;
        const startIndex = wordIndex;
        let consumedWeight = 0;
        const targetWeight = Math.max(1, speechLength(chunks[chunkIndex]));

        while (wordIndex < words.length - wordsLeftForLater) {
            consumedWeight += Math.max(1, speechLength(words[wordIndex].text));
            wordIndex++;
            if (consumedWeight >= targetWeight) break;
        }

        const assigned = words.slice(startIndex, wordIndex);
        if (assigned.length === 0) return null;
        result.push({
            ...segment,
            start: assigned[0].start,
            end: assigned[assigned.length - 1].end,
            text: chunks[chunkIndex]
        });
    }
    return result;
};

const allocateProportionally = (segment, chunks) => {
    const duration = Math.max(0, segment.end - segment.start);
    const weights = chunks.map((chunk) => Math.max(1, speechLength(chunk)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = segment.start;

    return chunks.map((text, index) => {
        const end = index === chunks.length - 1
            ? segment.end
            : cursor + duration * (weights[index] / totalWeight);
        const result = { ...segment, start: cursor, end, text };
        cursor = end;
        return result;
    });
};

const allocateTimes = (segment, chunks) => (
    allocateUsingWordTimings(segment, chunks) || allocateProportionally(segment, chunks)
);

const mergeSingleCharacterRuns = (segments, hardLimit) => {
    const result = [];
    let index = 0;

    while (index < segments.length) {
        const run = [segments[index]];
        let cursor = index + 1;
        while (
            cursor < segments.length
            && speechLength(segments[cursor].text) === 1
            && speechLength(run[run.length - 1].text) === 1
            && segments[cursor].start - run[run.length - 1].end <= 0.15
        ) {
            run.push(segments[cursor]);
            cursor++;
        }

        if (run.length < 3 || speechLength(run[0].text) !== 1) {
            result.push(segments[index]);
            index++;
            continue;
        }

        const groupCount = Math.ceil(run.length / hardLimit);
        let runIndex = 0;
        for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
            const remaining = run.length - runIndex;
            const groupsLeft = groupCount - groupIndex;
            const groupSize = Math.ceil(remaining / groupsLeft);
            const group = run.slice(runIndex, runIndex + groupSize);
            result.push({
                ...group[0],
                start: group[0].start,
                end: group[group.length - 1].end,
                text: group.map((segment) => segment.text).join('')
            });
            runIndex += groupSize;
        }
        index = cursor;
    }
    return result;
};

export const segmentSubtitles = (segments, style = 'natural') => {
    const limits = STYLE_LIMITS[style] || STYLE_LIMITS.natural;
    const result = [];

    for (const segment of segments) {
        const text = String(segment.text || '').trim();
        if (!text) continue;
        const duration = Math.max(0, Number(segment.end) - Number(segment.start));
        const chinese = hasChinese(text);
        const hardLimit = chinese ? limits.chineseChars : limits.latinChars;
        const units = chinese ? Array.from(text).length : text.length;
        const lengthCount = Math.ceil(units / hardLimit);
        const durationCount = Math.ceil(duration / limits.maxDuration);
        const readableCountLimit = chinese
            ? Math.max(1, Math.floor(Math.max(1, speechLength(text)) / limits.minChineseChars))
            : Math.max(1, text.trim().split(/\s+/).length);
        const targetCount = Math.max(lengthCount, Math.min(durationCount, readableCountLimit));
        const chunks = chinese
            ? splitChinese(text, targetCount, hardLimit)
            : splitLatin(text, targetCount, hardLimit);
        result.push(...allocateTimes(segment, chunks));
    }
    return mergeSingleCharacterRuns(result, limits.chineseChars);
};

export const getStyleLimits = (style = 'natural') => STYLE_LIMITS[style] || STYLE_LIMITS.natural;

