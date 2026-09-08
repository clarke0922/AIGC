const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listModels } = require('../src/services/volcModelCatalog');
for (const plan of ['agent', 'coding']) {
  test(`${plan} reference catalog never calls the unsupported models endpoint or requires a key`, async () => {
    let calls = 0;
    const models = await listModels('', async () => { calls++; return { ok: false, status: 404 }; }, plan);
    assert.equal(calls, 0);
    assert.ok(models.includes('deepseek-v4-flash'));
    assert.equal(models.some(id => /seedream|seedance/.test(id)), plan === 'agent');
    models.length = 0;
    assert.ok((await listModels('', undefined, plan)).length > 0);
  });
}
test('invalid plans never forward credentials', async () => {
  await assert.rejects(listModels('key', async () => assert.fail('credentials forwarded'), 'https://evil.example'), /套餐类型/);
});
test('route labels plan suggestions as reference data, not account discovery', async () => {
  const handler = require('../src/routes/aiConfig')({}, {}, {}).discoverVolcModels;
  let body;
  const res = { json(value) { body = value; return this; }, status() { return this; } };
  await handler({body: {plan: 'agent'}}, res);
  assert.equal(body.data.source, 'reference');
  assert.ok(body.data.models.includes('deepseek-v4-flash'));
});
