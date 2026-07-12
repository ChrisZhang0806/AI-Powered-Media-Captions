import { Converter } from 'opencc-js';

const toSimplifiedScript = Converter({ from: 't', to: 'cn' });
const toTraditionalScript = Converter({ from: 'cn', to: 't' });
const toMainlandVocabulary = Converter({ from: 'twp', to: 'cn' });

const RAW_OUTPUT_PATTERNS = [
    /(?:不要|不需要|无需|無需|關閉|关闭|禁用|停用|取消).{0,10}(?:繁簡|繁简|字形|文字)(?:轉換|转换)?/i,
    /(?:關閉|关闭|禁用|停用|取消).{0,8}(?:簡體|简体)(?:字形)?(?:轉換|转换)/i,
    /(?:保留|維持|维持|輸出|输出|使用).{0,8}(?:原始|原文)(?:字形|文字|字幕)?/i,
    /\b(?:keep|preserve|use)\s+(?:the\s+)?original\s+(?:chinese\s+)?(?:script|text|captions?)\b/i
];

const TRADITIONAL_PATTERNS = [
    /(?:保留|輸出|输出|使用).{0,6}(?:繁體|繁体)(?:中文|字幕|字形)?/i,
    /(?:簡體|简体).{0,6}(?:轉|转)(?:換|换)?(?:為|为)?(?:繁體|繁体)/i,
    /\b(?:keep|preserve|output|use|convert to)\s+traditional\s+chinese\b/i
];

const VOCABULARY_PATTERNS = [
    /(?:常用詞|常用词|臺灣用詞|台湾用词|港台用詞|港台用词|地域用詞|地域用词).{0,16}(?:轉換|转换|歸一化|归一化|大陸用詞|大陆用词)/i,
    /(?:轉換|转换|歸一化|归一化).{0,16}(?:臺灣用詞|台湾用词|港台用詞|港台用词|常用詞|常用词)/i,
    /\b(?:normalize|convert).{0,24}(?:taiwan|taiwanese|regional).{0,24}(?:terms|terminology|vocabulary)\b/i
];

const SIMPLIFIED_PATTERNS = [
    /(?:輸出|输出|生成|產生|产生|使用|轉成|转成|轉換為|转换为|統一為|统一为).{0,8}(?:簡體|简体)(?:中文|字幕|字形)?/i,
    /(?:繁體|繁体).{0,6}(?:轉|转)(?:換|换)?(?:為|为)?(?:簡體|简体)/i,
    /\b(?:output|use|generate|convert to)\s+simplified\s+chinese(?:\s+captions?|\s+subtitles?)?\b/i
];

const CONTROL_INSTRUCTION_PATTERNS = [
    /(?:請|请)?(?:輸出|输出|生成|產生|产生|使用)(?:為|为|成)?(?:簡體|简体)(?:中文)?字幕[。；;，,]?/giu,
    /(?:請|请)?(?:將|将)字幕(?:轉換|转换|轉成|转成|統一|统一)(?:為|为|成)?(?:簡體|简体)(?:中文)?[。；;，,]?/giu,
    /(?:請|请)?(?:把|將|将)?(?:臺灣|台湾|港台|地域)?常用(?:詞|词)(?:也)?(?:進行|进行)?(?:轉換|转换|歸一化|归一化)(?:為|为)?(?:大陸|大陆)?用(?:詞|词)?[。；;，,]?/giu,
    /(?:請|请)?(?:保留|輸出|输出|使用)(?:為|为|成)?(?:繁體|繁体)(?:中文|字幕|字形)?[。；;，,]?/giu,
    /(?:不要|不需要|无需|無需|關閉|关闭|禁用|停用|取消).{0,10}(?:簡體|简体|繁轉簡|繁转简|字形轉換|字形转换)[。；;，,]?/giu,
    /(?:保留|維持|维持|輸出|输出|使用).{0,8}(?:原始|原文)(?:字形|文字|字幕)?[。；;，,]?/giu,
    /\b(?:output|use|generate|convert to)\s+simplified\s+chinese(?:\s+captions?|\s+subtitles?)?[.;,]?/giu,
    /\b(?:normalize|convert).{0,24}(?:taiwan|taiwanese|regional).{0,24}(?:terms|terminology|vocabulary)[.;,]?/giu,
    /\b(?:keep|preserve|output|use)\s+traditional\s+chinese[.;,]?/giu,
    /\b(?:disable|turn off).{0,16}simplified\s+chinese[.;,]?/giu
];

const matchesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const removeControlInstructions = (prompt) => {
    let result = prompt;
    for (const pattern of CONTROL_INSTRUCTION_PATTERNS) result = result.replace(pattern, ' ');
    return result.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
};

export const getDefaultChineseNormalizationMode = (uiLanguage) => {
    if (uiLanguage === 'zh') return 'script';
    if (uiLanguage === 'zh-TW') return 'traditional';
    return 'off';
};

export const parseChineseNormalizationDirective = (prompt, defaultMode = 'off') => {
    const source = typeof prompt === 'string' ? prompt : '';
    let mode = defaultMode;

    if (matchesAny(source, RAW_OUTPUT_PATTERNS)) {
        mode = 'off';
    } else if (matchesAny(source, TRADITIONAL_PATTERNS)) {
        mode = 'traditional';
    } else if (matchesAny(source, VOCABULARY_PATTERNS)) {
        mode = 'vocabulary';
    } else if (matchesAny(source, SIMPLIFIED_PATTERNS)) {
        mode = 'script';
    }

    return {
        mode,
        transcriptionPrompt: removeControlInstructions(source)
    };
};

export const normalizeChineseText = (text, mode = 'off') => {
    if (typeof text !== 'string' || text.length === 0 || mode === 'off') return text || '';
    if (mode === 'traditional') return toTraditionalScript(text);
    return mode === 'vocabulary'
        ? toMainlandVocabulary(text)
        : toSimplifiedScript(text);
};

export const normalizeWhisperSegments = (segments, mode = 'off') => (
    (Array.isArray(segments) ? segments : []).map((segment) => ({
        ...segment,
        text: normalizeChineseText(String(segment?.text || ''), mode)
    }))
);
