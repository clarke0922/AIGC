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

import { volcPlans, volcPlanConfigs } from '../src/utils/volcModelSelection.js'
test('plan presets save the selected endpoint for every supported service', () => {
  const configs = ['text', 'image', 'storyboard_image', 'video'].map(service_type => ({service_type, provider: 'volcengine'}))
  for (const plan of Object.keys(volcPlans)) {
    const selected = volcPlanConfigs(configs, plan)
    assert.equal(selected.length, plan === 'coding' ? 1 : 4)
    for (const config of selected) {
      assert.equal(config.base_url, volcPlans[plan].baseUrl)
      assert.equal(config.provider, 'volcengine')
    }
  }
  assert.deepEqual(modelCandidates(['ark-code-latest', 'minimax-m3', 'doubao-seedream-4.5'], 'text'), ['ark-code-latest', 'minimax-m3'])
})

import { readFileSync } from 'node:fs'
test('one-click Agent Plan save preserves manual IDs and skips unfilled media services', async () => {
  const component = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
  const body = component.split('async function submitOneKeyVolc() {')[1].split('\nfunction openOneKeyAgnes()')[0].trim().replace(/\}$/, '')
  const calls = []
  const saving = {value: false}, visible = {value: true}
  const submit = new (Object.getPrototypeOf(async function(){}).constructor)(
    'oneKeyVolcKey', 'volcSelected', 'oneKeyVolcSaving', 'activeVolcConfigs', 'aiAPI', 'ElMessage', 'oneKeyVolcVisible', 'loadList', body)
  await submit({value:' test-key '}, {value:{text:' deepseek-v4-flash ', image:'doubao-seedream-4.5'}}, saving,
    {value:volcPlanConfigs(['text','image','storyboard_image','video'].map(service_type => ({service_type,provider:'volcengine'})), 'agent')},
    {create:async config => calls.push(config)}, {success(){}}, visible, async () => {})
  assert.equal(calls.length, 2)
  assert.equal(calls[0].default_model, 'deepseek-v4-flash')
  for (const config of calls) {
    assert.equal(config.base_url, 'https://ark.cn-beijing.volces.com/api/plan/v3')
    assert.equal(config.api_key, 'test-key')
  }
  assert.equal(visible.value, false)
  assert.equal(saving.value, false)
})
