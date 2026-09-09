import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('quick start stacks its three actions inside the card without button margins', () => {
  const list = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
  const group = list.match(/\.action-card-buttons\s*\{([^}]+)\}/)[1]
  const button = list.match(/\.action-btn\s*\{([^}]+)\}/)[1]
  assert.match(group, /flex-direction:\s*column/)
  assert.match(button, /width:\s*100%/)
  assert.match(button, /min-width:\s*0/)
  assert.match(button, /margin-left:\s*0/)
})

test('direct storyboard creation preserves draft on failure and navigates only after saving', async () => {
  const body = source.split('async function onCreateFromStoryboards() {')[1].split('\n}\n')[0]
  const busy = { value: false }, draft = { value: '镜头一\n\n镜头二' }
  let fail = true, payload, destination
  const create = new Function('creatingFromStoryboards', 'store', 'dramaAPI', 'scriptTitle', 'directStoryboardText', 'generationStyle', 'projectStylePromptMetadata', 'scriptLanguage', 'projectAspectRatio', 'router', 'ElMessage', 'return async function(){' + body + '}')(
    busy, { dramaId: null }, { create: async value => { payload = value; if (fail) throw Error('offline'); return { id: 42 } } },
    { value: '我的分镜' }, draft, { value: 'custom' }, () => ({ style_prompt_zh: '水墨' }), { value: 'zh' }, { value: '9:16' },
    { replace: async value => { destination = value } }, { success() {}, error() {} },
  )
  await create()
  assert.equal(draft.value, '镜头一\n\n镜头二')
  assert.equal(destination, undefined)
  assert.equal(busy.value, false)
  fail = false
  await create()
  assert.equal(payload.initial_storyboards, '镜头一\n\n镜头二')
  assert.equal(payload.metadata.style_prompt_zh, '水墨')
  assert.equal(payload.metadata.aspect_ratio, '9:16')
  assert.deepEqual(destination, { path: '/film/42', query: { entry: 'storyboards' } })
  assert.equal(draft.value, '')
  assert.equal(busy.value, false)
})
