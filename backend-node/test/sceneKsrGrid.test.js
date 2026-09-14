const { test } = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../src/services/promptI18n');
const ai = require('../src/services/aiClient');
const images = require('../src/services/imageClient');
const scenes = require('../src/services/sceneService');

test('scene polish and image prompts use the KSR 3x3 grid contract', () => {
  const contract = prompts.getSceneGridContract();
  assert.match(contract, /exact 3×3 grid/);
  assert.match(contract, /PANEL 01 WIDE ESTABLISHING/);
  assert.match(contract, /PANEL 09 REVERSE ANGLE/);
  assert.match(contract, /PHOTO TONE/);
  assert.match(contract, /MATERIAL TRUTH/);
  for (const language of ['zh', 'en']) {
    const polished = prompts.getScenePolishPrompt({ app: { language }, style: {} });
    assert.ok(polished.includes(contract));
    assert.ok(polished.includes('COLOR / MATERIAL TRUTH'));
    assert.ok(polished.includes('SPACE / MATERIAL / LIGHT / FORMAT'));
  }
  assert.ok(prompts.getSceneGenerateImagePrompt().includes(contract));
});

test('grid scene generation submits square nine-panel prompt while single scene stays landscape', async (t) => {
  const requests = [];
  t.mock.method(ai, 'generateText', async () => '废弃茶楼，木楼梯，潮湿青砖');
  t.mock.method(images, 'createAndGenerateImage', (_db, _log, request) => {
    requests.push(request);
    return { id: requests.length };
  });

  const gridRow = { id: 11, drama_id: 1, location: '废弃茶楼', time: '雨夜', prompt: '木楼梯和潮湿青砖', polished_prompt: '' };
  const singleRow = { id: 12, drama_id: 1, location: '办公室', time: '白天', prompt: '玻璃幕墙', polished_prompt_single: '' };
  let current = gridRow;
  const db = { prepare: (sql) => ({
    get: () => sql.includes('FROM scenes') ? current : { id: 1, style: null, metadata: '{}' },
    run() {},
  }) };
  const log = { info() {}, error() {} };
  const cfg = { app: { language: 'zh' }, style: {} };

  await scenes.generateSceneFourViewImage(db, log, cfg, 11);
  current = singleRow;
  await scenes.generateSceneSingleImage(db, log, cfg, 12);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].scene_id, 11);
  assert.equal(requests[0].size, '1024x1024');
  assert.match(requests[0].prompt, /exact 3×3 grid/);
  assert.equal(requests[1].scene_id, 12);
  assert.equal(requests[1].size, '1792x1024');
  assert.doesNotMatch(requests[1].prompt, /exact 3×3 grid/);
});
