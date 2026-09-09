const { test } = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../src/services/promptI18n');
const ai = require('../src/services/aiClient');
const images = require('../src/services/imageClient');
const characters = require('../src/services/characterLibraryService');

test('role polish and image prompts share front/back anatomy constraints in both languages', () => {
  const contract = prompts.getRoleAnatomyContract();
  assert.match(contract, /no visible face/);
  assert.match(contract, /never stretch or squash/);
  assert.match(contract, /two arms and two legs/);
  for (const language of ['zh', 'en']) {
    assert.ok(prompts.getRolePolishPrompt({ app: { language }, style: {} }).includes(contract));
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
  }
  assert.match(requests[1].prompt, /MANDATORY ART STYLE \(all panels\): ink drawing/);
  assert.doesNotMatch(requests[1].prompt, /all 4 panels|四格统一/);
  assert.match(requests[2].prompt, /蓝色长袍/);
});
