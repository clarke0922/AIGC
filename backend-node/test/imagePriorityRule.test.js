const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withRefPriorityRule } = require('../src/services/aiClient');

test('withRefPriorityRule appends priority rule when flag set', () => {
  const out = withRefPriorityRule('角色描述', true);
  assert.ok(out.startsWith('角色描述'));
  assert.ok(out.includes('参考照片人物身份优先于文字描述'));
  assert.ok(out.includes('以照片为准'));
});

test('withRefPriorityRule leaves prompt unchanged when flag off', () => {
  const out = withRefPriorityRule('角色描述', false);
  assert.equal(out, '角色描述');
});

test('withRefPriorityRule handles empty prompt', () => {
  assert.equal(withRefPriorityRule('', true), '');
  assert.equal(withRefPriorityRule(null, true), null);
});