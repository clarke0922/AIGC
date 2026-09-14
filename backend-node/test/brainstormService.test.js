const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const brainstorm = require('../src/services/brainstormService');
const imageClient = require('../src/services/imageClient');
const uploadService = require('../src/services/uploadService');

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

test('generates with text-to-image model config and upscales to requested size', async (t) => {
  const sharp = require('sharp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-'));
  const sourceBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: '#202a44' },
  }).jpeg().toBuffer();
  const sourceDir = path.join(root, 'brainstorms');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'source.jpg'), sourceBuffer);

  let imageRequest = null;
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, request) => {
    imageRequest = request;
    return { image_url: 'https://example.com/brainstorm.jpg' };
  });
  t.mock.method(uploadService, 'downloadImageToLocal', async () => 'brainstorms/source.jpg');

  const result = await brainstorm.generateBrainstormImage(
    {},
    { info() {}, warn() {}, error() {} },
    { storage: { local_path: root } },
    { prompt: '雾中古城', aspect_ratio: '16:9', resolution: '2k' }
  );

  const metadata = await sharp(path.join(root, result.local_path)).metadata();
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.height, 1152);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 1152);
  assert.match(result.image_url, /^\/static\/brainstorms\//);
  assert.equal(imageRequest.imageServiceType, 'image');
});
