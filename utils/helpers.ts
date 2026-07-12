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
