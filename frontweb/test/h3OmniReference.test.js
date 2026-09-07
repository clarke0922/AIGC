import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/views/FilmCreate.vue',import.meta.url),'utf8')
function extract(name) {
  const start=source.indexOf('function '+name+'(')
  assert.ok(start>=0)
  return (source.slice(start-6,start)==='async ' ? 'async ' : '')+source.slice(start,source.indexOf('\n}',start)+2)
}
const capability=extract('videoModelNameFromAiConfig')+'\n'+extract('canUseUniversalOmniVideoApi')
const canUse=new Function(capability+'\nreturn canUseUniversalOmniVideoApi')()
test('H3 multi-reference detection matches explicit and inferred backend protocols',()=>{
  for(const config of [
    {api_protocol:'walkingwithai'},
    {api_protocol:'minimax_h3',endpoint:'/jobs'},
    {provider:'minimax_h3'},
    {api_protocol:'openai',model:['minimax-h3']},
    {model:['MiniMax-H3']},
    {api_protocol:'agnes'},
    {api_protocol:'kling_omni'},
    {api_protocol:'volcengine_omni'},
  ]) assert.equal(canUse(config),true,JSON.stringify(config))
  for(const config of [null,{api_protocol:'sora',model:['MiniMax-H3']},{model:['MiniMax-Hailuo-2.3']}]) assert.equal(canUse(config),false)
})
test('universal H3 submission preserves scene, character and prop references without downgrade',async()=>{
  for(const api_protocol of ['walkingwithai','minimax_h3']) {
    const calls=[],errors=[],genIds=new Set()
    const env={
      dramaId:{value:1},sbCanSubmitVideo:()=>true,isSbUniversalMode:()=>true,
      getActiveVideoAiConfig:async()=>({api_protocol,provider:'minimax_h3',model:['minimax-h3']}),
      confirmUniversalNonSeedance2Video:async()=>{throw new Error('unexpected downgrade')},
      collectSbSceneOnlyReferenceAbsoluteUrls:()=>{throw new Error('unexpected scene-only fallback')},
      getSbSelectedScene:()=>({image:'scene.png'}),getSbSelectedCharacters:()=>[{image:'character.png'}],getSbSelectedProps:()=>[{image:'prop.png'}],
      hasAssetImage:asset=>!!asset.image,assetImageUrl:asset=>asset.image,toAbsoluteImageUrl:url=>'https://cdn.example/'+url,
      getSbFirstFrameUrl:()=>'',generatingSbVideoIds:genIds,buildSbGenMeta:()=>({}),GEN_RESOURCE:{SB_VIDEO:'video'},
      genStore:{markRunning(){},markDone(){}},sbVideoErrors:{value:{}},sbSelectedVideoId:{value:{}},
      storyboardsAPI:{update:async()=>{}},sbVideoFirstLastUrls:()=>({}),buildSbVideoPromptForApi:()=>'<Picture 1> 场景，<Picture 2> 角色，<Picture 3> 道具',
      videosAPI:{create:async body=>{calls.push(body);return {}}},getSelectedStyle:()=>'',projectAspectRatio:{value:'16:9'},videoResolution:{value:'720p'},getSbVideoDurationForApi:()=>5,
      loadSingleStoryboardMedia:async()=>{},ElMessage:{success(){},error:msg=>errors.push(msg)},
    }
    const run=new Function(...Object.keys(env),capability+'\n'+extract('collectSbOmniReferenceAbsoluteUrls')+'\n'+extract('onGenerateSbVideo')+'\nreturn onGenerateSbVideo')(...Object.values(env))
    await run({id:7})
    assert.deepEqual(errors,[])
    assert.equal(calls.length,1)
    assert.deepEqual(calls[0].reference_image_urls,['https://cdn.example/scene.png','https://cdn.example/character.png','https://cdn.example/prop.png'])
    assert.equal(calls[0].image_url,undefined)
    assert.equal(calls[0].first_frame_url,undefined)
    assert.equal(genIds.size,0)
  }
})
