import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/components/AIConfigContent.vue',import.meta.url),'utf8')
test('Doubao preset selects speech endpoint/model/voice and removes stale MiniMax fields',()=>{
  const presets=source.split('const providerConfigs = ')[1].split('\n/**')[0].trim()
  const providerConfigs=new Function('return '+presets)()
  const baseBody=source.split('function getBaseUrlForProvider(')[1].split('\nfunction ')[0]
  const getBaseUrlForProvider=new Function('return function getBaseUrlForProvider('+baseBody)()
  const change=source.split('function onProviderChange(providerId) {')[1].split('\n/** 通义一键配置用 */')[0].trim().replace(/\}$/,'')
  const form={value:{service_type:'tts',group_id:'old',voice_id:'female-shaonv'}}
  const apply=new Function('providerId','form','CUSTOM_PROVIDER_SENTINEL','providerConfigs','getBaseUrlForProvider','providerProtocolMap','editingId','serviceTypeLabel',change)
  apply('doubao_tts',form,'__custom__',providerConfigs,getBaseUrlForProvider,{}, {value:null},()=> '语音合成')
  assert.equal(form.value.base_url,'https://openspeech.bytedance.com')
  assert.equal(form.value.default_model,'seed-tts-2.0')
  assert.equal(form.value.voice_id,'zh_female_vv_uranus_bigtts')
  assert.equal(form.value.group_id,'')
  assert.match(source,/语音控制台 API Key/)
})
