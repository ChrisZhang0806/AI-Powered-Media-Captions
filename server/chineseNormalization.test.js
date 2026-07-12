import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getDefaultChineseNormalizationMode,
    normalizeChineseText,
    normalizeWhisperSegments,
    parseChineseNormalizationDirective
} from './chineseNormalization.js';

const traditional = '臺灣的軟體與網路資訊，發佈在後臺。';

test('preserves Traditional Chinese by default', () => {
    assert.equal(normalizeChineseText(traditional), traditional);
    assert.equal(parseChineseNormalizationDirective('人名：陳先生').mode, 'off');
});

test('derives the default script mode from the interface language', () => {
    assert.equal(getDefaultChineseNormalizationMode('zh'), 'script');
    assert.equal(getDefaultChineseNormalizationMode('zh-TW'), 'traditional');
    assert.equal(getDefaultChineseNormalizationMode('en'), 'off');
    assert.equal(
        normalizeChineseText(traditional, parseChineseNormalizationDirective('', getDefaultChineseNormalizationMode('zh')).mode),
        '台湾的软体与网路资讯，发布在后台。'
    );
    assert.equal(
        normalizeChineseText('台湾的软件与网络信息，发布在后台。', parseChineseNormalizationDirective('', getDefaultChineseNormalizationMode('zh-TW')).mode),
        '臺灣的軟件與網絡信息，發佈在後臺。'
    );
});

test('simplified-caption directive changes script but preserves regional wording', () => {
    const directive = parseChineseNormalizationDirective('输出简体字幕；人名：陳先生');
    assert.equal(directive.mode, 'script');
    assert.equal(directive.transcriptionPrompt, '人名：陳先生');
    assert.equal(
        normalizeChineseText(traditional, directive.mode),
        '台湾的软体与网路资讯，发布在后台。'
    );
});

test('terminology directive also normalizes Taiwan vocabulary', () => {
    const directive = parseChineseNormalizationDirective('把台湾常用词也进行转换为大陆用词');
    assert.equal(directive.mode, 'vocabulary');
    assert.equal(
        normalizeChineseText(traditional, directive.mode),
        '台湾的软件与网络信息，发布在后台。'
    );
});

test('explicit Traditional instruction overrides conversion instructions', () => {
    const directive = parseChineseNormalizationDirective('输出简体字幕，但请保留繁体字幕');
    assert.equal(directive.mode, 'traditional');
    assert.equal(normalizeChineseText('台湾的软件', directive.mode), '臺灣的軟件');
});

test('explicit original-script instruction disables the interface default', () => {
    const directive = parseChineseNormalizationDirective('关闭简体转换', 'script');
    assert.equal(directive.mode, 'off');
    assert.equal(normalizeChineseText(traditional, directive.mode), traditional);
});

test('normalizes every segment only in the selected mode', () => {
    const source = [{ start: 1, end: 2, text: 'OpenAI API 測試', avg_logprob: -0.2 }];
    assert.equal(normalizeWhisperSegments(source)[0].text, 'OpenAI API 測試');
    assert.deepEqual(normalizeWhisperSegments(source, 'script')[0], {
        start: 1,
        end: 2,
        text: 'OpenAI API 测试',
        avg_logprob: -0.2
    });
});
