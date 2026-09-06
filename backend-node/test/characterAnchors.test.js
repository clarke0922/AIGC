const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCharacterIdentityAnchorsText } = require('../src/services/characterLibraryService');

test('builds anchor text from identity_anchors JSON', () => {
  const row = {
    name: 'TestChar',
    appearance: '黑发',
    identity_anchors: JSON.stringify({
      face_shape: 'oval face',
      facial_features: 'almond eyes #3D2B1F',
      unique_marks: 'none',
      hair_style: 'wavy black hair',
    }),
  };
  const text = buildCharacterIdentityAnchorsText(row);
  assert.ok(text.includes('Character: TestChar'));
  assert.ok(text.includes('Face: oval face'));
  assert.ok(text.includes('Hair: wavy black hair'));
});

test('returns empty when no anchors', () => {
  assert.equal(buildCharacterIdentityAnchorsText({ name: 'A' }), '');
  assert.equal(buildCharacterIdentityAnchorsText({ name: 'A', identity_anchors: null }), '');
  assert.equal(buildCharacterIdentityAnchorsText(null), '');
});

test('falls back gracefully on invalid anchor JSON', () => {
  assert.equal(buildCharacterIdentityAnchorsText({ name: 'A', identity_anchors: 'not-json' }), '');
});