import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/composables/filmCreate/useProps.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
const harness = `
  const ref = value => ({ value }), reactive = value => value, computed = fn => ({ get value() { return fn() } });
  export const calls = [], errors = [];
  export let failUpload = false;
  export const setFailUpload = value => { failUpload = value };
  const ElMessage = { success() {}, error(message) { errors.push(message) } };
  const useGenerationTaskStore = () => ({});
  const uploadAPI = { async uploadImage(file) {
    calls.push(['upload', await file.text()]);
    if (failUpload) throw new Error('upload failed');
    return { local_path: 'uploads/original.png' };
  } };
  const propAPI = {
    async create(body) { calls.push(['create', body]) },
    async putRefImage(id, path) { calls.push(['reference', id, path]) },
  };
`
const module = await import('data:text/javascript;base64,' + Buffer.from(harness + source).toString('base64'))

test('adding a prop uploads original bytes before creating it and ignores a stale prompt', async () => {
  const props = module.useProps({ store: { dramaId: 1 }, dramaId: { value: 1 }, currentEpisodeId: { value: 2 }, loadDrama: async () => {} })
  props.addPropForm.value = { name: '电池', prompt: 'ignore this' }
  props.addPropAddRefImage.value = { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', filename: 'ref.png' }
  await props.submitAddProp()
  assert.equal(module.calls[0][0], 'upload')
  assert.equal(module.calls[0][1], 'original')
  assert.equal(module.calls[1][0], 'create')
  assert.equal(module.calls[1][1].ref_image, 'uploads/original.png')
  assert.equal(module.calls[1][1].prompt, undefined)

  module.calls.length = 0
  module.setFailUpload(true)
  props.showAddProp.value = true
  await props.submitAddProp()
  assert.equal(module.calls.length, 1)
  assert.equal(props.showAddProp.value, true)
  assert.equal(module.errors.at(-1), 'upload failed')
  module.setFailUpload(false)
});
