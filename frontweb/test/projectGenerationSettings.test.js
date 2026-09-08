import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('project settings save persists before applying and preserves draft on failure', async () => {
  const body = source.split('async function saveProjectSettingsDialog() {')[1].split('\n/**')[0].trim().replace(/}$/, '')
  const store = { dramaId: 1, drama: { metadata: { aspect_ratio: '16:9' } } }
  const draft = { value: { style: 'custom', customPrompt: '水墨', language: 'en' } }
  const saving = { value: false }, visible = { value: true }, style = { value: '' }, custom = { value: '' }, language = { value: 'zh' }
  let fail = true, payload, successes = 0, errors = 0
  const save = new Function('projectSettingsSaving', 'projectSettingsDraft', 'stylePromptMetadataForSave', 'store', 'dramaAPI', 'generationStyle', 'customStylePrompt', 'scriptLanguage', 'showProjectSettings', 'ElMessage', 'return async function(){' + body + '}')(
    saving, draft, (_style, text) => ({ style_prompt_zh: text, style_prompt_en: text }), store,
    { saveOutline: async (_id, value) => { if (fail) throw new Error('offline'); payload = value } },
    style, custom, language, visible, { success: () => successes++, error: () => errors++ })
  await save()
  assert.equal(language.value, 'zh')
  assert.equal(visible.value, true)
  assert.equal(saving.value, false)
  assert.equal(errors, 1)
  fail = false
  await save()
  assert.equal(payload.metadata.generation_language, 'en')
  assert.equal(payload.metadata.style_prompt_zh, '水墨')
  assert.equal(store.drama.metadata.aspect_ratio, '16:9')
  assert.equal(language.value, 'en')
  assert.equal(style.value, 'custom')
  assert.equal(visible.value, false)
  assert.equal(successes, 1)
})
