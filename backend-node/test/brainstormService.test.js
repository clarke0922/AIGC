const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const brainstorm = require('../src/services/brainstormService');
const imageClient = require('../src/services/imageClient');
const uploadService = require('../src/services/uploadService');
const aiConfigService = require('../src/services/aiConfigService');

test('builds KSRMJ one paragraph prompt with cinematic constraints', () => {
  const prompt = brainstorm.buildBrainstormPrompt('雨夜码头的等待', '21:9');
  assert.match(prompt, /真实电影摄影质感/);
  assert.match(prompt, /雨夜码头的等待/);
  assert.match(prompt, /刚刚/);
  assert.match(prompt, /不要CG感/);
  assert.match(prompt, /不要镜头运动/);
  assert.doesNotMatch(prompt, /\n/);
});

test('maps 2K and 4K options to exact long-edge pixels', () => {
  assert.deepEqual(brainstorm.getResolutionDimensions('21:9', '2k'), { width: 2048, height: 878, ratio: '1024:439' });
  assert.deepEqual(brainstorm.getResolutionDimensions('21:9', '4k'), { width: 3840, height: 1646, ratio: '1920:823' });
  assert.deepEqual(brainstorm.getResolutionDimensions('9:16', '4k'), { width: 2160, height: 3840, ratio: '9:16' });
});

test('generates two candidates by default with the default text-to-image model and upscales', async (t) => {
  const sharp = require('sharp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-'));
  const sourceBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: '#202a44' },
  }).jpeg().toBuffer();
  const sourceDir = path.join(root, 'brainstorms');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'source.jpg'), sourceBuffer);

  const imageRequests = [];
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, request) => {
    imageRequests.push(request);
    return { image_url: 'https://example.com/brainstorm.jpg' };
  });
  t.mock.method(uploadService, 'downloadImageToLocal', async () => 'brainstorms/source.jpg');
  t.mock.method(aiConfigService, 'listConfigs', () => [{
    id: 7, is_active: true, is_default: true, provider: 'openai', name: '默认文生图', model: ['seedream'],
  }]);
  t.mock.method(aiConfigService, 'getConfig', () => ({ id: 7, is_active: true, provider: 'openai', name: '默认文生图', model: ['seedream'] }));

  const result = await brainstorm.generateBrainstormImages(
    {},
    { info() {}, warn() {}, error() {} },
    { storage: { local_path: root } },
    { prompt: '雾中古城', aspect_ratio: '16:9', resolution: '2k' }
  );

  assert.equal(result.images.length, 2);
  for (const image of result.images) {
    const metadata = await sharp(path.join(root, image.local_path)).metadata();
    assert.equal(metadata.width, 2048);
    assert.equal(metadata.height, 1152);
    assert.match(image.image_url, /^\/static\/brainstorms\//);
    assert.equal(image.model, 'seedream');
  }
  assert.equal(imageRequests.length, 2);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 1152);
});

test('multiple selected text-to-image models each generate one candidate concurrently', async (t) => {
  const sharp = require('sharp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-multi-'));
  fs.mkdirSync(path.join(root, 'brainstorms'), { recursive: true });
  const sourceBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: '#202a44' },
  }).jpeg().toBuffer();
  fs.writeFileSync(path.join(root, 'brainstorms', 'source.jpg'), sourceBuffer);
  const requestedModels = [];
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, request) => {
    requestedModels.push(request.model);
    return { image_url: `https://example.com/${request.model}.jpg` };
  });
  t.mock.method(uploadService, 'downloadImageToLocal', async () => 'brainstorms/source.jpg');
  t.mock.method(aiConfigService, 'listConfigs', () => [
    { id: 1, is_active: true, is_default: true, provider: 'openai', name: '模型A', model: ['model-a'] },
    { id: 2, is_active: true, is_default: false, provider: 'openai', name: '模型B', model: ['model-b'] },
  ]);
  t.mock.method(aiConfigService, 'getConfig', () => null);

  const result = await brainstorm.generateBrainstormImages(
    {},
    { info() {}, warn() {}, error() {} },
    { storage: { local_path: root } },
    { prompt: '雾中古城', aspect_ratio: '16:9', resolution: '2k', models: ['1:model-a', '2:model-b'] }
  );
  assert.deepEqual(requestedModels.sort(), ['model-a', 'model-b']);
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images.map((i) => i.model).sort(), ['model-a', 'model-b']);
});
