const test = require('node:test');
const assert = require('node:assert');
const videoClient = require('../src/services/videoClient');

test('resolveVideoProtocol 自动推断：Seedance 2.x 家族 + volces 升级为 volcengine_omni', () => {
  const cfg = { provider: 'volces', api_protocol: '', default_model: 'doubao-seedance-2-0-260128' };
  assert.strictEqual(videoClient.resolveVideoProtocol(cfg), 'volcengine_omni');
});

test('resolveVideoProtocol 自动推断：Seedance 1.5 不升级，保持经典 volcengine', () => {
  const cfg = { provider: 'volces', api_protocol: '', default_model: 'doubao-seedance-1-5-pro-251215' };
  assert.strictEqual(videoClient.resolveVideoProtocol(cfg), 'volcengine');
});

test('resolveVideoProtocol 显式协议优先：即便 SD2 家族也不覆盖显式 openai', () => {
  const cfg = { provider: 'volces', api_protocol: 'openai', default_model: 'doubao-seedance-2-0-260128' };
  assert.strictEqual(videoClient.resolveVideoProtocol(cfg), 'openai');
});

test('resolveVideoProtocol 显式 volcengine_omni 保持不变', () => {
  const cfg = { provider: 'volces', api_protocol: 'volcengine_omni', default_model: 'doubao-seedance-2-5-260628' };
  assert.strictEqual(videoClient.resolveVideoProtocol(cfg), 'volcengine_omni');
});