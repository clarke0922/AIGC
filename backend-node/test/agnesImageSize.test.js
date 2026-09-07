const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fixAgnesImageSize, isAgnesImageConfig } = require('../src/services/imageClient');

describe('fixAgnesImageSize', () => {
  it('maps 9:16 project size to Agnes portrait preset', () => {
    assert.equal(fixAgnesImageSize('1440x2560'), '1024x1792');
  });

  it('maps 16:9 project size to Agnes landscape preset', () => {
    assert.equal(fixAgnesImageSize('2560x1440'), '1792x1024');
  });

  it('maps 1:1 project size to Agnes square preset', () => {
    assert.equal(fixAgnesImageSize('1920x1920'), '1024x1024');
  });
});

describe('isAgnesImageConfig', () => {
  it('detects agnes provider even when api_protocol is openai', () => {
    assert.equal(
      isAgnesImageConfig({ provider: 'agnes', base_url: 'https://apihub.agnes-ai.com/v1', api_protocol: 'openai' }, 'agnes-image-2.1-flash'),
      true
    );
  });
});

describe('Agnes image request compatibility', () => {
  it('omits quality for Agnes text/reference requests and preserves it for other providers', async (t) => {
    const { callImageApi } = require('../src/services/imageClient');
    const requests = [];
    const server = require('node:http').createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      res.setHeader('Content-Type', 'application/json');
      if (body.model.startsWith('agnes-image') && 'quality' in body) {
        res.statusCode = 400;
        res.end(JSON.stringify({error:{message:'quality is not supported by text image queue'}}));
        return;
      }
      res.end(JSON.stringify({data:[{url:'https://cdn.example.com/result.png'}]}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base_url = `http://127.0.0.1:${server.address().port}/v1`;
    const log = { info() {}, warn() {}, error() {} };
    for (const [provider, model, refs] of [
      ['agnes', 'agnes-image-2.5-flash', []],
      ['custom', 'agnes-image-2.1-flash', ['https://cdn.example.com/ref.png']],
      ['openai', 'dall-e-3', []],
    ]) {
      const result = await callImageApi(null, log, {
        config_override: {provider, model:[model], api_protocol:'openai', base_url, endpoint:'/images/generations'},
        model, prompt:'A quiet street', size:'1024x1024', quality:'hd', reference_image_urls:refs,
      });
      assert.deepEqual(result, {image_url:'https://cdn.example.com/result.png'});
    }
    assert.equal(Object.hasOwn(requests[0], 'quality'), false);
    assert.equal(Object.hasOwn(requests[1], 'quality'), false);
    assert.equal(requests[2].quality, 'hd');
    assert.equal(requests[0].size, '1024x1024');
    assert.equal(requests[0].prompt, 'A quiet street');
    assert.deepEqual(requests[1].extra_body.image, ['https://cdn.example.com/ref.png']);
  });
});
