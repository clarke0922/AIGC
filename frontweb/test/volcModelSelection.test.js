import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelCandidates, singleModel } from '../src/utils/volcModelSelection.js'
test('single candidates are selected without rewriting supplier IDs; multiple candidates require choice', () => {
  const ids = ['deepseek-v4-flash-260425', 'doubao-seedream-4-5-251128', 'Doubao-Seedance-1.5-pro', 'ep-custom']
  assert.equal(singleModel(ids, 'text'), ids[0])
  assert.equal(singleModel(ids, 'image'), ids[1])
  assert.equal(singleModel(ids, 'storyboard_image'), ids[1])
  assert.equal(singleModel(ids, 'video'), ids[2])
  assert.equal(singleModel([...ids, 'deepseek-v4-pro-260425'], 'text'), '')
  assert.equal(singleModel([], 'text'), '')
  assert.deepEqual(modelCandidates(['ep-custom', 'doubao-embedding-vision'], 'text'), [])
})
