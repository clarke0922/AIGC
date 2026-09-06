const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listModels } = require('../src/services/volcModelCatalog');
test('Ark model discovery preserves exact IDs and keeps credentials on the fixed origin', async () => {
  const ids = await listModels(' test-key ', async (url, options) => {
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/models');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ data: [{ id: 'DeepSeek-ID' }, { id: 'DeepSeek-ID' }, { id: 'ep-custom' }, {}] }) };
  });
  assert.deepEqual(ids, ['DeepSeek-ID', 'ep-custom']);
});
test('discovery rejects missing keys, denied requests and unsupported catalogs without guessing IDs', async () => {
  await assert.rejects(listModels(''), /Key/);
  await assert.rejects(listModels('key', async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(listModels('key', async () => ({ ok: true, json: async () => ({ data: [] }) })), /空模型列表/);
  await assert.rejects(listModels('key', async () => ({ ok: true, json: async () => ({}) })), /未返回/);
});
