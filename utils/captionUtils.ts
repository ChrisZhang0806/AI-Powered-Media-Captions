import { CaptionSegment, ExportFormat, DownloadMode } from "../types";
import { Language } from "./i18n";

const normalizeTimestamp = (time: string, format: ExportFormat): string => {
  const parts = time.split(/[,.]/);
  const main = parts[0];
  const ms = parts[1] || '000';
  return format === 'SRT' ? `${main},${ms}` : `${main}.${ms}`;
};

export const generateFileContent = (captions: CaptionSegment[], format: ExportFormat): string => {
  if (format === 'SRT') {
    let content = '';
    captions.forEach((cap, index) => {
      content += `${index + 1}\n`;
      content += `${normalizeTimestamp(cap.startTime, 'SRT')} --> ${normalizeTimestamp(cap.endTime, 'SRT')}\n`;
      content += `${cap.text}\n\n`;
    });
    return content;
  }
  if (format === 'VTT') {
    let content = 'WEBVTT\n\n';
    captions.forEach((cap) => {
      content += `${normalizeTimestamp(cap.startTime, 'VTT')} --> ${normalizeTimestamp(cap.endTime, 'VTT')}\n`;
      content += `${cap.text}\n\n`;
    });
    return content;
  }
  return '';
};

export const downloadCaptions = (
  captions: CaptionSegment[],
  format: ExportFormat,
  filename: string,
  mode: DownloadMode = 'bilingual',
  splitBilingual: boolean = false,
  metadata?: { targetLang?: string; sourceLang?: string; uiLanguage?: Language }
) => {
  console.log('[Download] 开始下载:', { format, filename, mode, captionsCount: captions.length });

  if (splitBilingual && mode === 'bilingual') {
    const originalCaptions = captions.map(c => ({
      ...c,
      text: c.text.split('\n')[0] || ''
    }));
    const translatedCaptions = captions.map(c => ({
      ...c,
      text: c.text.split('\n')[1] || ''
    }));

    downloadSingleFile(originalCaptions, format, `${filename}_original`);
    setTimeout(() => {
      const translatedFilename = metadata?.targetLang ? `${filename}_translated_${metadata.targetLang}` : `${filename}_translated`;
      downloadSingleFile(translatedCaptions, format, translatedFilename);
    }, 500);
    return;
  }

  let finalCaptions = captions;
  if (mode === 'original') {
    finalCaptions = captions.map(c => ({ ...c, text: c.text.split('\n')[0] || '' }));
  } else if (mode === 'translated') {
    finalCaptions = captions.map(c => ({ ...c, text: c.text.split('\n')[1] || c.text }));
  }

  let finalFilename = filename;
  if (mode === 'translated') {
    finalFilename = metadata?.targetLang ? `${filename}_translated_${metadata.targetLang}` : `${filename}_translated`;
  } else if (mode === 'bilingual') {
    finalFilename = (metadata?.sourceLang && metadata?.targetLang)
      ? `${filename}_bilingual_${metadata.sourceLang}-${metadata.targetLang}`
      : `${filename}_bilingual`;
  }

  downloadSingleFile(finalCaptions, format, finalFilename);
};

const downloadSingleFile = (captions: CaptionSegment[], format: ExportFormat, filename: string) => {
  if (captions.length === 0) {
    console.warn('[Download] 没有字幕可下载');
    alert('没有字幕可下载');
    return;
  }

  const content = generateFileContent(captions, format);
  console.log('[Download] 生成内容长度:', content.length);

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format.toLowerCase()}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // 延迟清理以确保下载开始
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('[Download] 下载触发完成');
  }, 100);
};

/**
 * 解析 SRT 或 VTT 内容为 CaptionSegment 数组
 */
export const parseCaptions = (content: string): CaptionSegment[] => {
  const segments: CaptionSegment[] = [];
  // 移除可能存在的 BOM 标记并统一换行符
  const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = cleanContent.split('\n');

  let currentSegment: Partial<CaptionSegment> = {};
  let textLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 匹配时间轴行: 支持 00:00:00,000 或 00:00:00.000
    const timeMatch = line.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/);

    if (timeMatch) {
      // 存储上一段
      if (currentSegment.startTime && textLines.length > 0) {
        currentSegment.text = textLines.join('\n');
        segments.push(currentSegment as CaptionSegment);
      }

      // 开始新的一段
      currentSegment = {
        id: segments.length,
        startTime: timeMatch[1].replace('.', ','),
        endTime: timeMatch[2].replace('.', ',')
      };
      // 确保时间戳是 00:00:00,000 格式（补零）
      const fixTime = (t: string) => {
        let [hms, ms] = t.split(',');
        let [h, m, s] = hms.split(':');
        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')},${ms.padEnd(3, '0')}`;
      };
      currentSegment.startTime = fixTime(currentSegment.startTime);
      currentSegment.endTime = fixTime(currentSegment.endTime);

      textLines = [];
    } else if (line && !line.match(/^\d+$/) && !line.includes('WEBVTT') && !line.includes('NOTE')) {
      // 文本行
      textLines.push(line);
    }
  }

  // 存入最后一段
  if (currentSegment.startTime && textLines.length > 0) {
    currentSegment.text = textLines.join('\n');
    segments.push(currentSegment as CaptionSegment);
  }

  return segments;
};