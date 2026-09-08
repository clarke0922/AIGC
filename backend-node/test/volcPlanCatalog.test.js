const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listModels } = require('../src/services/volcModelCatalog');
for (const [plan, path] of [['agent', 'plan'], ['coding', 'coding']]) {
  test(`${plan} discovery uses its own endpoint and preserves plan aliases`, async () => {
    assert.deepEqual(await listModels('key', async (url, options) => {
      assert.equal(url, `https://ark.cn-beijing.volces.com/api/${path}/v3/models`);
      assert.equal(options.headers.Authorization, 'Bearer key');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
    }, plan), ['deepseek-v4-flash']);
  });
}
test('invalid plans never forward credentials; denied plans never retry ordinary billing', async () => {
  let calls = 0;
  const denied = async () => { calls++; return { ok: false, status: 401 }; };
  await assert.rejects(listModels('key', denied, 'https://evil.example'), /套餐类型/);
  assert.equal(calls, 0);
  await assert.rejects(listModels('key', denied, 'agent'), /401.*套餐.*API Key/);
  assert.equal(calls, 1);
});
