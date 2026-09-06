const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enforceNoOnScreenText } = require('../src/services/videoClient');

test('appends no-onscreen-text constraint to plain prompts', () => {
  const out = enforceNoOnScreenText('旁白：夜色渐深。');
  assert.ok(out.includes('禁止出现任何对白字幕、旁白字幕'));
  assert.ok(out.endsWith('不得以文字形式显示在画面上。'));
});

test('keeps prompts that already forbid subtitles unchanged', () => {
  const already = '真实人声与环境声，不生成字幕。';
  assert.equal(enforceNoOnScreenText(already), already);
});

test('returns empty for empty input', () => {
  assert.equal(enforceNoOnScreenText(''), '');
  assert.equal(enforceNoOnScreenText(null), '');
});