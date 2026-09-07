import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref, reactive, computed } from 'vue'

const source = readFileSync(new URL('../src/composables/filmCreate/useCharacters.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export function useCharacters', 'function useCharacters')
const create = new Function('ref', 'reactive', 'computed', 'characterAPI', 'dramaAPI', 'ElMessage', 'useGenerationTaskStore', source + '\nreturn useCharacters')
function fixture(generatePrompt) {
  const errors = [], calls = [], store = { dramaId: 1, drama: { characters: [] } }
  const api = { generatePrompt: (...args) => { calls.push(args); return generatePrompt(...args) } }
  const drama = { async saveCharacters(_id, body) { store.drama.characters = body.characters.map((c, i) => ({...c, id: i + 1})) } }
  const useCharacters = create(ref, reactive, computed, api, drama, {success() {}, error: message => errors.push(message)}, () => ({}))
  return { ui: useCharacters({store, dramaId: ref(1), currentEpisodeId: ref(1), loadDrama: async () => {}}), store, calls, errors }
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return {promise, resolve, reject}
}

test('adding then editing a character stays idle until generation is requested', async (t) => {
  let polls = 0
  t.mock.method(globalThis, 'setInterval', () => { polls++; return 1 })
  const pending = deferred(), {ui, store, calls} = fixture(() => pending.promise)
  ui.openAddCharacter()
  Object.assign(ui.editCharacterForm.value, {name:'新角色', appearance:'黑色短发'})
  await ui.submitEditCharacter()
  ui.editCharacter(store.drama.characters[0])
  assert.equal(ui.editCharacterPromptGenerating.value, false)
  assert.equal(polls, 0)
  assert.equal(calls.length, 0)
  ui.keepCharRefPriority.value = true
  const generating = ui.doGenerateCharacterPrompt()
  assert.equal(ui.editCharacterPromptGenerating.value, true)
  await ui.doGenerateCharacterPrompt()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][3], true)
  pending.resolve({polished_prompt:'新的四视图提示词'})
  await generating
  assert.equal(ui.editCharacterForm.value.polished_prompt, '新的四视图提示词')
  assert.equal(ui.editCharacterPromptGenerating.value, false)
})

test('failed and empty generation responses end loading and allow retry', async () => {
  let attempt = 0
  const {ui, errors} = fixture(async () => {
    if (++attempt === 1) throw new Error('连接超时')
    return attempt === 2 ? {} : {polished_prompt:'重试成功'}
  })
  ui.editCharacter({id:1, name:'角色', polished_prompt:'原提示词'})
  await ui.doGenerateCharacterPrompt()
  assert.equal(ui.editCharacterPromptGenerating.value, false)
  assert.equal(ui.editCharacterForm.value.polished_prompt, '原提示词')
  await ui.doGenerateCharacterPrompt()
  assert.equal(ui.editCharacterPromptGenerating.value, false)
  assert.deepEqual(errors, ['连接超时', '未返回新的提示词，请重试'])
  await ui.doGenerateCharacterPrompt()
  assert.equal(ui.editCharacterForm.value.polished_prompt, '重试成功')
})

test('closing and reopening isolates old responses from the new generation', async () => {
  const old = deferred(), current = deferred()
  let attempt = 0
  const {ui} = fixture(() => ++attempt === 1 ? old.promise : current.promise)
  const char = {id:1, name:'角色', polished_prompt:'原提示词'}
  ui.editCharacter(char)
  const first = ui.doGenerateCharacterPrompt()
  ui.onCloseCharDialog()
  ui.openAddCharacter()
  assert.equal(ui.editCharacterPromptGenerating.value, false)
  ui.editCharacter(char)
  const second = ui.doGenerateCharacterPrompt()
  old.resolve({polished_prompt:'旧请求结果'})
  await first
  assert.equal(ui.editCharacterPromptGenerating.value, true)
  assert.equal(ui.editCharacterForm.value.polished_prompt, '原提示词')
  current.resolve({polished_prompt:'当前请求结果'})
  await second
  assert.equal(ui.editCharacterPromptGenerating.value, false)
  assert.equal(ui.editCharacterForm.value.polished_prompt, '当前请求结果')
})
