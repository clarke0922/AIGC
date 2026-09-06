const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const props = require('../src/services/propService');
const images = require('../src/services/propImageGenerationService');
const ai = require('../src/services/aiClient');
const imageClient = require('../src/services/imageClient');

test('reference props persist the original image and bypass text and image AI', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE props (
    id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, name TEXT,
    type TEXT, description TEXT, prompt TEXT, negative_prompt TEXT,
    image_url TEXT, local_path TEXT, ref_image TEXT, extra_images TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT
  )`);
  const log = { info() {}, error() {} };
  t.mock.method(ai, 'generateText', () => { throw new Error('must not call text AI'); });
  t.mock.method(imageClient, 'callImageApi', () => { throw new Error('must not call image AI'); });
  const created = props.create(db, log, {
    drama_id: 1, name: '电池', ref_image: 'uploads/battery.png',
    prompt: 'a completely different object', image_url: 'https://example.com/old.png',
  });
  assert.equal(created.ref_image, 'uploads/battery.png');
  assert.equal(created.local_path, created.ref_image);
  assert.equal(created.image_url, '');
  assert.equal(images.generatePropImage(db, log, created.id), null);
  assert.deepEqual(await props.generatePropPromptOnly(db, log, {}, created.id), {
    ok: true, prompt: '', uses_reference_image: true,
  });
  const changed = props.update(db, log, created.id, {
    ref_image: 'https://example.com/reference.png', local_path: 'old.png',
  });
  assert.equal(changed.image_url, changed.ref_image);
  assert.equal(changed.local_path, null);
  const protectedProp = props.update(db, log, created.id, { image_url: 'https://example.com/generated.png' });
  assert.equal(protectedProp.image_url, changed.ref_image);
  assert.equal(ai.generateText.mock.callCount(), 0);
  assert.equal(imageClient.callImageApi.mock.callCount(), 0);
  props.update(db, log, created.id, { ref_image: null, prompt: '' });
  assert.throws(() => images.generatePropImage(db, log, created.id), /道具没有图片提示词/);
});
