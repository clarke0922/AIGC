const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ai = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');

test('looksLikeVisionModel recognizes multimodal models and rejects non-vision ones', () => {
  for (const model of ['gpt-4o', 'gpt-4o-mini', 'gemini-2.5-pro', 'gemini-3-flash', 'claude-3-5-sonnet', 'qwen-vl-max', 'qwen2.5-vl-72b', 'doubao-1-5-vision-pro', 'glm-4v']) {
    assert.equal(ai.looksLikeVisionModel(model), true, model);
  }
  for (const model of ['deepseek-v4-flash-260425', 'deepseek-v3.2', 'doubao-seedream-4-5', 'doubao-seedance-2-5', 'gemini-2.5-flash-image', 'text-embedding-vision', 'speech-02-hd', 'gpt-3.5-turbo', 'agnes-image-2.1-flash']) {
    assert.equal(ai.looksLikeVisionModel(model), false, model);
  }
});

test('isImageUnavailableResponse detects a model that cannot see the image', () => {
  const blocked = [
    '抱歉，我无法查看此图片中的实际内容，因为未成功读取到图像数据。',
    '我无法访问或查看图片，只能根据你的文字描述作答。',
    '作为AI，我不能看到你上传的照片。',
    '未成功读取到图像数据。',
    "I'm unable to view the image you shared.",
    'I cannot access the picture in this conversation.',
  ];
  for (const text of blocked) assert.equal(ai.isImageUnavailableResponse(text), true, text);
  assert.equal(ai.isImageUnavailableResponse('这是一张废弃工厂的场景图，光线昏暗，有锈蚀的金属管道。'), false);
});

async function withVisionServer(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: respond(body) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    requests,
    config: {
      id: 99,
      name: 'test-vision',
      provider: 'openai',
      api_protocol: 'openai',
      base_url: `http://127.0.0.1:${server.address().port}/v1`,
      endpoint: '/chat/completions',
      api_key: '',
      model: ['gpt-4o'],
      default_model: 'gpt-4o',
      is_active: true,
      is_default: true,
    },
  };
}

test('generateTextWithVision sends image_url plus a no-guessing vision contract', async (t) => {
  const harness = await withVisionServer(t, () => '废弃工厂，昏暗光线，锈蚀金属管道。');
  t.mock.method(aiConfigService, 'listConfigs', () => [harness.config]);
  const out = await ai.generateTextWithVision(
    {}, { info() {}, warn() {}, error() {} }, 'text',
    '请提取场景', '你是场景美术师',
    { imageUrl: 'data:image/jpeg;base64,AAAA' },
    { max_tokens: 800 }
  );
  assert.equal(out, '废弃工厂，昏暗光线，锈蚀金属管道。');
  const body = harness.requests[0];
  assert.equal(body.model, 'gpt-4o');
  const userContent = body.messages.at(-1).content;
  assert.equal(userContent[0].type, 'text');
  assert.equal(userContent[1].type, 'image_url');
  assert.equal(userContent[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  const systemText = body.messages[0].content;
  assert.match(systemText, /禁止根据实体名称|无法看到|无法查看图片/);
});

test('generateTextWithVision throws when the model reports it cannot read the image', async (t) => {
  const harness = await withVisionServer(t, () => '抱歉，我无法查看此图片中的实际内容，因为未成功读取到图像数据。');
  t.mock.method(aiConfigService, 'listConfigs', () => [harness.config]);
  await assert.rejects(
    () => ai.generateTextWithVision(
      {}, { info() {}, warn() {}, error() {} }, 'text',
      '请提取道具', '你是道具描述师',
      { imageUrl: 'data:image/png;base64,AAAA' }
    ),
    /未能读取图片|不支持图片输入/
  );
});

test('generateTextWithVision refuses a configured non-vision model without calling it', async (t) => {
  const harness = await withVisionServer(t, () => '不应被调用');
  t.mock.method(aiConfigService, 'listConfigs', () => [{ id: 1, is_active: true, is_default: true, default_model: 'deepseek-v4-flash-260425', model: ['deepseek-v4-flash-260425'] }]);
  await assert.rejects(
    () => ai.generateTextWithVision(
      {}, { info() {}, warn() {}, error() {} }, 'text',
      'p', 's', { imageUrl: 'data:image/png;base64,AAAA' }
    ),
    /不支持图片输入/
  );
  assert.equal(harness.requests.length, 0);
});


