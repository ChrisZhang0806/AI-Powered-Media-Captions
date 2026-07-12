import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterWhisperSegments,
    isKnownSubtitleCreditHallucination,
    suppressRepeatedCaptions
} from './transcriptionQuality.js';

test('removes known Amara subtitle credit hallucinations', () => {
    assert.equal(isKnownSubtitleCreditHallucination('字幕由 Amara.org 社区提供'), true);
    assert.equal(isKnownSubtitleCreditHallucination('Translated by Amara.org community'), true);
    assert.equal(isKnownSubtitleCreditHallucination('字幕由Amara.'), true);
    assert.equal(isKnownSubtitleCreditHallucination('org社区提供'), true);
    assert.deepEqual(filterWhisperSegments([
        { start: 0, end: 2, text: '字幕由 Amara.org 社区提供' }
    ]), []);
});

test('removes probable silence and pathological decoder repetition', () => {
    const result = filterWhisperSegments([
        { text: 'ghost text', no_speech_prob: 0.92, avg_logprob: -0.8 },
        { text: 'loop loop loop', no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 2.8 },
        { text: '正常语音', no_speech_prob: 0.05, avg_logprob: -0.25, compression_ratio: 1.1 }
    ]);
    assert.deepEqual(result.map((segment) => segment.text), ['正常语音']);
});

test('keeps confident repeated speech but suppresses a low-confidence loop', () => {
    const confident = [0, 4, 8].map((start) => ({ start, end: start + 1, text: '谢谢', avg_logprob: -0.2 }));
    assert.equal(suppressRepeatedCaptions(confident).length, 3);

    const weak = [0, 4, 8, 12].map((start) => ({ start, end: start + 1, text: '谢谢', avg_logprob: -0.8 }));
    assert.equal(suppressRepeatedCaptions(weak).length, 2);
});
