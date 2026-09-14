const { test } = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../src/services/promptI18n');
const ai = require('../src/services/aiClient');
const images = require('../src/services/imageClient');
const characters = require('../src/services/characterLibraryService');

test('role polish and image prompts use the KSR 2x2 character sheet contract in both languages', () => {
  const contract = prompts.getRoleAnatomyContract();
  assert.match(contract, /exact 2×2 grid/);
  assert.match(contract, /FACE FRONT/);
  assert.match(contract, /FACE SIDE/);
  assert.ok(contract.includes('BODY FRONT (NO FACE)'));
  assert.match(contract, /#606570/);
  assert.match(contract, /45-degree side-rim/);
  for (const language of ['zh', 'en']) {
    const polished = prompts.getRolePolishPrompt({ app: { language }, style: {} });
    assert.ok(polished.includes(contract));
    assert.match(polished, /FACE FRONT/);
    assert.ok(polished.includes('BODY FRONT (NO FACE)'));
    assert.match(polished, /PHOTO TONE \/ MATERIAL TRUTH/);
  }
  assert.ok(prompts.getRoleGenerateImagePrompt().includes(contract));
});

test('saved, fresh and fallback character prompts submit anatomy constraints without overwriting saved edits', async (t) => {
  const requests = [];
  let textCalls = 0;
  let failText = false;
  t.mock.method(ai, 'generateText', async () => {
    textCalls++;
    if (failText) throw new Error('text unavailable');
    return '角色：成年男性，蓝色长袍';
  });
  t.mock.method(images, 'createAndGenerateImage', (_db, _log, request) => {
    requests.push(request);
    return { id: requests.length };
  });
  const row = { id: 2, drama_id: 1, name: '测试角色', appearance: '成年男性，蓝色长袍', polished_prompt: 'USER EDIT: blue robe, FRONT VIEW, BACK VIEW' };
  const writes = [];
  const db = { prepare: (sql) => ({
    get: () => sql.includes('FROM characters') ? row : { id: 1, metadata: '{}' },
    run: (...args) => writes.push(args),
  }) };
  const log = { info() {}, error() {} };
  const cfg = { app: { language: 'zh' }, style: { default_style_en: 'ink drawing' } };
  const saved = row.polished_prompt;
  assert.equal((await characters.generateCharacterFourViewImage(db, log, cfg, 2)).ok, true);
  assert.equal(textCalls, 0);
  assert.equal(writes.length, 0);
  assert.ok(requests[0].prompt.startsWith(saved));
  assert.equal(row.polished_prompt, saved);

  row.polished_prompt = '';
  await characters.generateCharacterFourViewImage(db, log, cfg, 2);
  failText = true;
  await characters.generateCharacterFourViewImage(db, log, cfg, 2);
  assert.equal(textCalls, 2);
  for (const request of requests) {
    assert.equal(request.prompt.split(prompts.getRoleAnatomyContract()).length, 2);
    assert.equal(request.character_id, 2);
    assert.equal(request.size, '1024x1024');
  }
  assert.match(requests[1].prompt, /MANDATORY ART STYLE \(all panels\): ink drawing/);
  assert.match(requests[0].prompt, /exact 2×2 grid/);
  assert.match(requests[2].prompt, /蓝色长袍/);
});
