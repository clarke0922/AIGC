const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoryboardSequence } = require('../src/services/episodeStoryboardService');

test('storyboard persistence numbers AI output continuously in narrative array order', () => {
  const source = [
    { shot_number: 2, title: '开场' },
    { shot_number: 1, title: '发展' },
    { shot_number: 4, title: '结尾' },
  ];

  const result = normalizeStoryboardSequence(source);

  assert.deepEqual(result.map((shot) => shot.shot_number), [1, 2, 3]);
  assert.deepEqual(result.map((shot) => shot.title), ['开场', '发展', '结尾']);
  assert.deepEqual(source.map((shot) => shot.shot_number), [2, 1, 4]);
});

test('continuation chunks continue after the already parsed sequence', () => {
  assert.deepEqual(
    normalizeStoryboardSequence([{ shot_number: 9 }, { shot_number: 3 }], 3).map((shot) => shot.shot_number),
    [4, 5]
  );
});
