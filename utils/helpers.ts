/**
 * 辅助函数：将 HH:MM:SS,mmm 转换为秒
 */
export const timeToSeconds = (timeStr: string): number => {
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    const [h, m, s_ms] = parts;
    const [s, ms] = s_ms.split(/[,.]/);
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + (parseInt(ms) || 0) / 1000;
};

/**
 * 辅助函数：智能截断文件名（保留后缀，中间省略）
 */
export const truncateFileName = (name: string, maxLen = 40): string => {
    if (!name || name.length <= maxLen) return name;
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex === -1) return name.substring(0, maxLen - 3) + '...';

    const ext = name.substring(dotIndex);
    const baseName = name.substring(0, dotIndex);
    const charsToShow = maxLen - ext.length - 3; // 3是省略号长度

    if (charsToShow <= 0) return '...' + ext;

    const half = Math.floor(charsToShow / 2);
    const front = baseName.substring(0, half + (charsToShow % 2));
    const back = baseName.substring(baseName.length - half);

    return `${front}...${back}${ext}`;
};

/**
 * 辅助函数：检测字幕文本的语言
 */
export const detectLanguage = (texts: string[]): string => {
    const sampleText = texts.slice(0, 20).join(' '); // 取前20条字幕作为样本

    // 统计各语言字符数量
    let chineseCount = 0;
    let japaneseCount = 0;
    let koreanCount = 0;
    let latinCount = 0;

    for (const char of sampleText) {
        const code = char.charCodeAt(0);
        // 中文字符范围
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
            chineseCount++;
        }
        // 日文假名范围 (平假名 + 片假名)
        else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
            japaneseCount++;
        }
        // 韩文字符范围
        else if (code >= 0xAC00 && code <= 0xD7AF) {
            koreanCount++;
        }
        // 拉丁字母范围
        else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) {
            latinCount++;
        }
    }

    // 如果有日文假名，优先判断为日文（因为日文也包含汉字）
    if (japaneseCount > 5) {
        return 'Japanese';
    }
    // 韩文
    if (koreanCount > chineseCount && koreanCount > latinCount) {
        return 'Korean';
    }
    // 中文
    if (chineseCount > latinCount && chineseCount > 10) {
        return 'Chinese';
    }
    // 默认返回英文（拉丁字母为主的语言）
    return 'English';
};

export const LANGUAGES = ["Chinese", "English", "Japanese", "Korean", "French", "German", "Spanish"];
