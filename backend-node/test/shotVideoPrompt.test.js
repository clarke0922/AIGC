const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeShotVideoPrompt } = require('../src/services/shotVideoPrompt');
const { composeStoryboardVideoPrompt } = require('../src/services/episodeStoryboardService');
const { buildFallbackUniversalMultiBeatText } = require('../src/services/universalOmniMultiBeatFormat');
const { getUniversalOmniMultiBeatFormatSpec } = require('../src/services/promptI18n');
test('omni prompt rebuild follows the current segment instead of stale actions', () => {
  const result = composeStoryboardVideoPrompt({ creation_mode:'universal',universal_segment_text:'父亲沉默地看着女儿。',action:'父亲大喊并离开',video_prompt:'父亲离开房间' }, '', '16:9');
  assert.equal(result, '父亲沉默地看着女儿。');
});
test('classic composition uses description instead of conflicting legacy action and result', () => {
  const result = composeStoryboardVideoPrompt({ description:'父亲留在原地', action:'父亲离开',result:'父亲出门',duration:5 }, '', '16:9');
  assert.ok(result.includes('父亲留在原地'));
  assert.ok(!result.includes('父亲离开'));
  assert.ok(!result.includes('父亲出门'));
});
test('studio prompt keeps plot first and makes the optional prompt subordinate', () => {
  const result = composeShotVideoPrompt({ description:'父亲沉默',camera:'固定镜头',dialogue:'',video_prompt:'暖色侧光' });
  assert.ok(result.indexOf('片段描述：父亲沉默') < result.indexOf('拍摄补充'));
  assert.ok(result.includes('无对白，不添加说话声'));
  assert.ok(result.includes('必须忽略'));
});
test('universal spec forbids on-screen subtitles (zh and en)', () => {
  const zh = getUniversalOmniMultiBeatFormatSpec({ app: { language: 'zh' } });
  const en = getUniversalOmniMultiBeatFormatSpec({ app: { language: 'en' } });
  assert.ok(zh.includes('画面不得出现字幕文字'));
  assert.ok(en.includes('must NOT appear on screen'));
});
test('fallback universal text injects no-subtitle rule', () => {
  const text = buildFallbackUniversalMultiBeatText({ location: '家', duration: 5 }, { durationSec: 5, action: '走动' }, '');
  assert.ok(text.includes('禁止生成/烧录对白或旁白字幕'));
});
