const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withRefPriorityRule } = require('../src/services/aiClient');
const rule = '参考照片人物身份优先于文字描述，如描述与照片冲突，以照片为准。如文字描述与参考照片人物特征冲突，以参考照片为准。';

test('withRefPriorityRule appends priority rule when flag set', () => {
  const out = withRefPriorityRule('角色描述', true);
  assert.ok(out.startsWith('角色描述'));
  assert.equal(out, '角色描述\n\n' + rule);
});

test('withRefPriorityRule does not duplicate a rule retained by AI', () => {
  const prompt = '角色描述\n\n' + rule;
  assert.equal(withRefPriorityRule(prompt, true), prompt);
});

test('saved reference extraction and regenerated prompts preserve the rule', async (t) => {
  const ai = require('../src/services/aiClient');
  const service = require('../src/services/characterLibraryService');
  const saved = [];
  const db = { prepare: (sql) => ({
    get: () => sql.includes('FROM characters')
      ? { id: 1, drama_id: 1, name: '角色', appearance: '黑色短发', ref_image: 'ref.png' }
      : { id: 1, style: '', metadata: '{}' },
    run: (...args) => saved.push(args[0]),
  }) };
  const log = { info() {}, warn() {}, error() {} };
  t.mock.method(ai, 'resolveEntityImageSource', () => ({ imageUrl: 'https://example.com/ref.png' }));
  let expectedFlag;
  const generate = async (_db, _log, _type, prompt) => {
    assert.equal(prompt.includes(rule), expectedFlag);
    return '黑色短发';
  };
  t.mock.method(ai, 'generateTextWithVision', generate);
  t.mock.method(ai, 'generateText', generate);
  for (const enabled of [true, false]) {
    expectedFlag = enabled;
    const extraction = await service.extractAppearanceFromImage(db, log, {}, 1, enabled);
    assert.equal(extraction.ok, true);
    assert.equal(extraction.appearance.includes(rule), enabled);
    assert.equal(saved.at(-1), extraction.appearance);
    const generated = await service.generateCharacterPromptOnly(db, log, { style: {} }, 1, undefined, undefined, enabled);
    assert.equal(generated.ok, true);
    assert.equal(generated.polished_prompt.includes(rule), enabled);
    assert.equal(saved.at(-1), generated.polished_prompt);
  }
});

test('withRefPriorityRule leaves prompt unchanged when flag off', () => {
  const out = withRefPriorityRule('角色描述', false);
  assert.equal(out, '角色描述');
});

test('withRefPriorityRule handles empty prompt', () => {
  assert.equal(withRefPriorityRule('', true), '');
  assert.equal(withRefPriorityRule(null, true), null);
});
