const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCfgStyleWithDrama } = require('../src/utils/dramaStyleMerge');
const prompts = require('../src/services/promptI18n');

test('project language overrides global language without changing shared config', () => {
  const base = { app: { language: 'zh', port: 5679 }, style: {} };
  const cfg = mergeCfgStyleWithDrama(base, { style: 'custom', metadata: JSON.stringify({ generation_language: 'en', style_prompt_en: 'ink drawing' }) });
  assert.equal(cfg.app.language, 'en');
  assert.equal(cfg.app.port, 5679);
  assert.equal(base.app.language, 'zh');
  assert.equal(cfg.style.default_style_en, 'ink drawing');
  for (const language of [undefined, '', 'invalid']) {
    assert.equal(mergeCfgStyleWithDrama(base, { metadata: { generation_language: language } }).app.language, 'zh');
  }
  for (const fn of [prompts.getScenePolishPrompt, prompts.getScenePolishPromptSingle, prompts.getRolePolishPrompt]) {
    assert.match(fn(cfg), /OUTPUT LANGUAGE: Write all descriptions/);
    assert.match(fn(cfg), /ink drawing/);
    assert.doesNotMatch(fn(base), /OUTPUT LANGUAGE/);
  }
  assert.match(prompts.getUniversalOmniSegmentPrompt(cfg), /"片段描述" in English/);
  assert.match(prompts.getUniversalOmniPolishPrompt(cfg), /Language: English/);
  assert.match(prompts.getUniversalOmniSegmentPrompt(base), /"片段描述" in Chinese/);
  assert.match(prompts.getStoryboardUniversalOmniModeSuffix(cfg), /cinematic English prose/);
});

test('story generation uses saved project language and unsaved request language before generating', async () => {
  const ai = require('../src/services/aiClient');
  const { generateStory } = require('../src/services/storyGenerationService');
  const original = ai.generateText;
  const captured = [];
  ai.generateText = async (_db, _log, _type, user, system) => {
    captured.push(system);
    return '[{"episode":1,"title":"A story","content":"A student arrives."}]';
  };
  const db = { prepare: () => ({ get: () => ({ metadata: JSON.stringify({ generation_language: 'en' }) }) }) };
  try {
    await generateStory(db, null, { drama_id: 1, premise: '学生入学' });
    await generateStory(db, null, { drama_id: 1, premise: '学生入学', metadata: { generation_language: 'zh' } });
    assert.match(captured[0], /Write in clear, fluent English/);
    assert.doesNotMatch(captured[1], /Write in clear, fluent English/);
  } finally { ai.generateText = original; }
});
