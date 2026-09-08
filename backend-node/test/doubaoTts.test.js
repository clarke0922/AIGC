const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const client = require('../src/services/doubaoTtsClient');
const configs = require('../src/services/aiConfigService');
const tts = require('../src/services/ttsService');
const log = {info(){},warn(){},error(){}};
async function mockSpeech(t, handler) {
  const server = http.createServer(async (req,res) => {
    let raw='';for await(const chunk of req) raw+=chunk;
    handler(req,JSON.parse(raw),res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {provider:'doubao_tts',service_type:'tts',base_url:`http://127.0.0.1:${server.address().port}`,api_key:'test-speech-key',model:['seed-tts-2.0'],settings:JSON.stringify({voice_id:'zh_female_vv_uranus_bigtts'})};
}
test('Doubao TTS configuration round-trip, real request headers/body, chunk decoding and local audio persistence',async t=>{
  const bytes=Buffer.from('ID3-test-audio');
  let calls=0;
  const config=await mockSpeech(t,(req,body,res)=>{
    calls++;
    assert.equal(req.url,'/api/v3/tts/unidirectional/sse');
    assert.equal(req.headers['x-api-key'],'test-speech-key');
    assert.equal(req.headers['x-api-resource-id'],'seed-tts-2.0');
    assert.ok(req.headers['x-api-request-id']);
    assert.equal(req.headers.authorization,undefined);
    assert.equal(body.req_params.speaker,'zh_female_vv_uranus_bigtts');
    assert.equal(body.req_params.audio_params.format,'mp3');
    assert.equal(body.req_params.audio_params.speech_rate,calls===1?25:0);
    res.writeHead(200,{'Content-Type':'text/event-stream',Connection:'close'});
    res.write('event: message\ndata: '+JSON.stringify({code:0,data:bytes.subarray(0,4).toString('base64')})+'\n\n');
    res.end('data: '+JSON.stringify({code:20000000,data:bytes.subarray(4).toString('base64')}));
  });
  const db=new Database(':memory:');
  t.after(()=>db.close());
  require('../src/db/migrate').runMigrationsAndEnsure(db);
  const row=configs.createConfig(db,log,{...config,name:'豆包语音',is_default:true});
  const saved=configs.getConfig(db,row.id);
  assert.equal(saved.voice_id,'zh_female_vv_uranus_bigtts');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doubao-tts-test-'));
  let file;
  t.after(()=>{if(file)fs.unlinkSync(file);if(fs.existsSync(path.join(dir,'audio')))fs.rmdirSync(path.join(dir,'audio'));fs.rmdirSync(dir);});
  const result=await tts.synthesize(db,log,{text:'你好',storyboard_id:1,storage_base:dir,speed:1.25});
  file=path.join(dir,result.local_path);
  assert.deepEqual(fs.readFileSync(file),bytes);
  await configs.testConnection(saved);
  assert.equal(calls,2);
});
test('Doubao TTS rejects HTTP errors, provider errors, invalid streams and empty audio instead of false test success',async t=>{
  let status=401, payload='{}';
  const config=await mockSpeech(t,(_req,_body,res)=>{res.writeHead(status,{Connection:'close'});res.end(payload);});
  await assert.rejects(configs.testConnection(config),/HTTP 401/);
  status=200;payload='data: {"code":45000000,"message":"voice mismatch"}\n';
  await assert.rejects(configs.testConnection(config),/45000000.*voice mismatch/);
  payload='data: {"code":20000000}\n';
  await assert.rejects(configs.testConnection(config),/未返回音频/);
  payload='data: invalid\n';
  await assert.rejects(configs.testConnection(config),/无效音频响应/);
  payload='data: {"code":0,"data":"!!!"}\n';
  await assert.rejects(configs.testConnection(config),/无效音频编码/);
  await assert.rejects(client.synthesizeAudio({...config,api_key:''},{text:'测试'}),/API Key/);
  await assert.rejects(client.synthesizeAudio(config,{text:'测试',speed:3}),/语速范围/);
});
