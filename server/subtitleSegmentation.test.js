import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyleLimits, segmentSubtitles } from './subtitleSegmentation.js';

const examples = [
    { start: 0, end: 5.64, text: '就是你的意思是说还是有点太僵了是吗就是还是要再活泼一点' },
    { start: 10, end: 17.385, text: '刚刚岁月又送了一个鲜花吗?鲜花树蒂吗?是刚刚的吗?没事多谢几次,' },
    { start: 20, end: 33, text: '是要对任何人的训练不要把认为是正式人主观上对自己喜欢的东西。' }
];

test('enforces the Chinese character limit for reported long examples', () => {
    const result = segmentSubtitles(examples, 'natural');
    const limits = getStyleLimits('natural');
    assert.ok(result.length > examples.length);
    for (const segment of result) {
        assert.ok(Array.from(segment.text).length <= limits.chineseChars, segment.text);
    }
});

test('never turns sparse text with a long timestamp into one character per caption', () => {
    const result = segmentSubtitles([{
        start: 2516.887,
        end: 2553.887,
        text: '要加画吗加一点'
    }], 'natural');
    assert.ok(result.length <= 2);
    assert.ok(result.every((segment) => Array.from(segment.text).length >= 3));
    assert.equal(result.map((segment) => segment.text).join(''), '要加画吗加一点');
});

test('uses word timestamps instead of stretching captions across silent gaps', () => {
    const result = segmentSubtitles([{
        start: 0,
        end: 40,
        text: '要加画吗加一点',
        words: [
            { start: 1, end: 1.2, text: '要' },
            { start: 1.2, end: 1.4, text: '加' },
            { start: 1.4, end: 1.6, text: '画' },
            { start: 1.6, end: 1.8, text: '吗' },
            { start: 30, end: 30.2, text: '加' },
            { start: 30.2, end: 30.4, text: '一' },
            { start: 30.4, end: 30.6, text: '点' }
        ]
    }], 'natural');
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(({ start, end }) => [start, end]), [[1, 1.8], [30, 30.6]]);
});

test('treats a half-second word pause as a hard subtitle boundary', () => {
    const result = segmentSubtitles([{
        start: 0,
        end: 2.1,
        text: '你好，继续吧',
        words: [
            { start: 0, end: 0.2, text: '你' },
            { start: 0.2, end: 0.4, text: '好' },
            { start: 1.1, end: 1.3, text: '继' },
            { start: 1.3, end: 1.5, text: '续' },
            { start: 1.5, end: 1.7, text: '吧' }
        ]
    }], 'natural');

    assert.deepEqual(result.map(({ text, start, end }) => ({ text, start, end })), [
        { text: '你好，', start: 0, end: 0.4 },
        { text: '继续吧', start: 1.1, end: 1.7 }
    ]);
});

test('does not force a break for normal short gaps', () => {
    const result = segmentSubtitles([{
        start: 0,
        end: 1.4,
        text: '我们继续',
        words: [
            { start: 0, end: 0.3, text: '我' },
            { start: 0.3, end: 0.6, text: '们' },
            { start: 0.9, end: 1.1, text: '继' },
            { start: 1.1, end: 1.4, text: '续' }
        ]
    }], 'natural');

    assert.equal(result.length, 1);
    assert.equal(result[0].text, '我们继续');
});

test('merges a continuous run of single-character captions but keeps an isolated interjection', () => {
    const result = segmentSubtitles([
        { start: 0, end: 0.5, text: '嗯' },
        { start: 5, end: 5.5, text: '要' },
        { start: 5.5, end: 6, text: '加' },
        { start: 6, end: 6.5, text: '画' },
        { start: 6.5, end: 7, text: '吗' }
    ], 'natural');
    assert.equal(result[0].text, '嗯');
    assert.equal(result[1].text, '要加画吗');
    assert.equal(result.length, 2);
});

test('preserves all text and the original range when word timestamps are unavailable', () => {
    for (const source of examples) {
        const result = segmentSubtitles([source], 'natural');
        assert.equal(result.map((segment) => segment.text).join(''), source.text);
        assert.equal(result[0].start, source.start);
        assert.equal(result.at(-1).end, source.end);
    }
});

test('segment styles produce progressively wider captions', () => {
    const source = [{ start: 0, end: 4, text: '这是一个用于验证不同字幕模式长度限制的完整中文句子。' }];
    assert.ok(segmentSubtitles(source, 'compact').length >= segmentSubtitles(source, 'natural').length);
    assert.ok(segmentSubtitles(source, 'natural').length >= segmentSubtitles(source, 'detailed').length);
});
