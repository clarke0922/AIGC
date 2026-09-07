const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAgnesVideoImagePayload, formatVideoPostBodyForLog } = require('../src/services/videoClient');

describe('formatVideoPostBodyForLog', () => {
  it('keeps full http URLs and labels extra_body images with index', () => {
    const formatted = formatVideoPostBodyForLog({
      model: 'agnes-video-v2.0',
      prompt: 'test prompt',
      extra_body: {
        image: ['https://cdn/a.jpg', 'https://cdn/b.png'],
      },
    });
    assert.deepEqual(formatted.extra_body.image, [
      '[0] https://cdn/a.jpg',
      '[1] https://cdn/b.png',
    ]);
    assert.equal(formatted.prompt, 'test prompt');
  });

  it('summarizes base64 image fields', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    const formatted = formatVideoPostBodyForLog({ image: dataUrl });
    assert.match(formatted.image, /^\(base64, \d+ chars\)$/);
  });
});

describe('buildAgnesVideoImagePayload', () => {
  it('uses extra_body.image array for omni multi-reference without keyframes mode', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.png', 'https://cdn/c.png'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/a.jpg',
      lastResolved: 'https://cdn/z.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.deepEqual(out.extra_body, { image: refs });
    assert.equal(out.image, undefined);
    assert.equal(out.extra_body.mode, undefined);
  });

  it('uses single top-level image string for one omni reference', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: ['https://cdn/scene.jpg'],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'omni_reference_single');
    assert.equal(out.image, 'https://cdn/scene.jpg');
  });

  it('uses extra_body keyframes only for classic first/last (not omni)', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: 'https://cdn/first.jpg',
      lastResolved: 'https://cdn/last.jpg',
    });
    assert.equal(out.strategy, 'classic_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/first.jpg', 'https://cdn/last.jpg'],
    });
    assert.equal(out.image, undefined);
  });

  it('does not use keyframes mode when omni refs exist', () => {
    const refs = ['https://cdn/s.jpg', 'https://cdn/c.jpg'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/s.jpg',
      lastResolved: 'https://cdn/l.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.equal(out.extra_body.mode, undefined);
  });
});

describe('Agnes version-specific video requests', () => {
  const { callVideoApi, buildAgnesPollUrl } = require('../src/services/videoClient');
  const log = { info() {}, warn() {}, error() {} };
  const invoke = (model, options = {}) => callVideoApi(null, log, {
    config_override: { provider: 'agnes', api_protocol: 'agnes', base_url: 'https://apihub.agnes-ai.com/v1', model: [model] },
    model, prompt: 'A quiet street', duration: 5, aspect_ratio: '9:16', ...options,
  });
  it('sends 2.5 Flash fields for text, keyframes and references and retains V2.0 fields', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (body.model === 'agnes-video-2.5-flash' && 'num_frames' in body) {
        return new Response(JSON.stringify({ detail: 'num_frames is a forbidden field' }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'task-1', video_id: 'video-1', status: 'queued' }));
    });
    const model = 'agnes-video-2.5-flash';
    assert.equal((await invoke(model, { resolution: '1080p' })).task_id, 'video-1');
    assert.deepEqual(Object.keys(requests[0]).sort(), ['aspect_ratio','mode','model','prompt','seconds','size']);
    assert.equal(requests[0].mode, 'text');
    assert.equal(requests[0].seconds, '5');
    assert.equal(requests[0].size, '720P');
    await invoke(model, { first_frame_url: 'https://cdn.example/first.png', last_frame_url: 'https://cdn.example/last.png', duration: 20 });
    assert.equal(requests[1].mode, 'keyframe');
    assert.equal(requests[1].first_frame, 'https://cdn.example/first.png');
    assert.equal(requests[1].last_frame, 'https://cdn.example/last.png');
    assert.equal(requests[1].seconds, '12');
    const refs = ['https://cdn.example/a.png', 'https://cdn.example/b.png'];
    await invoke(model, { reference_urls: refs, first_frame_url: refs[0], duration: 1 });
    assert.equal(requests[2].mode, 'reference');
    assert.deepEqual(requests[2].images, refs);
    assert.equal(requests[2].seconds, '4');
    for (const key of ['image','extra_body','first_frame','last_frame','width','height','num_frames','frame_rate']) assert.equal(requests[2][key], undefined);
    const before = requests.length;
    const result = await invoke(model, { reference_urls: Array.from({length:6}, (_,i)=>`https://cdn.example/${i}.png`) });
    assert.match(result.error, /最多支持 5 张/);
    assert.equal(requests.length, before);
    await invoke('agnes-video-2.5', {resolution:'1080p'});
    assert.equal(requests.at(-1).size, '1080P');
    assert.equal((await invoke('agnes-video-v2.0')).task_id, 'task-1');
    assert.equal(requests.at(-1).num_frames, 121);
    assert.equal(requests.at(-1).frame_rate, 24);
    assert.equal(requests.at(-1).mode, undefined);
  });
  it('queries 2.5 video IDs with model_name and preserves provider detail errors', async (t) => {
    const url = buildAgnesPollUrl({ base_url:'https://apihub.agnes-ai.com/v1', model:['agnes-video-2.5-flash'], query_endpoint:'/videos/{task_id}' }, 'video/a');
    assert.equal(url, 'https://apihub.agnes-ai.com/agnesapi?video_id=video%2Fa&model_name=agnes-video-2.5-flash');
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({detail:'invalid aspect ratio'}), {status:400}));
    assert.match((await invoke('agnes-video-2.5-flash')).error, /400 - invalid aspect ratio/);
  });
});
