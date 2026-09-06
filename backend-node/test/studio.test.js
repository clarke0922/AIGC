const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const S = require('../src/services/studioStore');
const service = require('../src/services/studioService');
const example = require('../examples/rain-letter.json');
const log = { info(){}, warn(){}, error(){} };
function fixture() {
  const db = new Database(':memory:');
  const saved = console.log; console.log = () => {};
  try { require('../src/db/migrate').runMigrationsAndEnsure(db); } finally { console.log = saved; }
  const drama = require('../src/services/dramaService').createDrama(db, log, {title:'test',metadata:{studio:true,aspect_ratio:'16:9'}});
  db.prepare('INSERT INTO studio_projects (drama_id,document,created_at) VALUES (?,?,?)').run(drama.id, JSON.stringify(example), S.now());
  S.sync(db,drama.id,example);
  return {db,id:drama.id};
}
test('budget reservation is atomic, bounded and replay-safe', () => {
  const {db,id}=fixture();
  const a=S.reserve(db,id,'request-0001','video','shots:shot1',{duration:5},{model:'fixed'},30000000);
  assert.equal(S.reserve(db,id,'request-0001','video','shots:shot1',{duration:5},{model:'fixed'},30000000).id,a.id);
  assert.throws(()=>S.reserve(db,id,'request-0001','video','shots:shot1',{duration:6},{model:'fixed'},30000000),/请求标识/);
  assert.throws(()=>S.reserve(db,id,'request-0002','video','shots:shot2',{}, {},20000001),/预算不足/);
  assert.throws(()=>S.reserve(db,id,'request-0003','video','shots:shot1',{}, {},1),/未结束/);
  S.updateTask(db,a.id,{state:'unknown'});
  assert.equal(S.ledger(db,id).committed_micros,30000000);
  S.updateTask(db,a.id,{state:'reconciled',actual_micros:5000000,reconciliation_note:'供应商账单'});
  assert.equal(S.ledger(db,id).remaining_micros,45000000);
  assert.throws(()=>S.money(NaN)); assert.throws(()=>S.money('0')); db.close();
});
test('single shot edits preserve siblings and detect stale revisions',()=>{
  const {db,id}=fixture(),p=S.project(db,id);
  const doc=S.patchTarget(p.document,'shots:shot3',{camera:'缓慢推近'});
  assert.deepEqual(S.impact(p.document,doc),['shot3']);
  const next=S.save(db,id,0,doc,'test');
  assert.equal(next.document.shots[2].camera,'缓慢推近');
  assert.equal(next.document.shots[2].stale,true);
  assert.deepEqual(next.document.shots[0],p.document.shots[0]);
  assert.throws(()=>S.save(db,id,0,doc,'test'),/内容已变化/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_versions').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboards').get().n,6);
  assert.throws(()=>S.patchTarget(doc,'shots:shot3',{video:'other.mp4'}),/不能/); db.close();
});
test('description edits require prompt review before video submission and preserve siblings',()=>{
  const {db,id}=fixture(),p=S.project(db,id);
  const next=S.save(db,id,0,S.patchTarget(p.document,'shots:shot3',{description:'父亲始终留在原地'}),'edit');
  assert.equal(next.document.shots[2].video_prompt_needs_review,true);
  assert.equal(next.document.shots[0].video_prompt_needs_review,undefined);
  assert.throws(()=>service.prepare(db,{},id,{kind:'video',target:'shots:shot3',revision:1}),/确认.*视频提示词/);
  const reviewed=S.save(db,id,1,S.patchTarget(next.document,'shots:shot3',{video_prompt:'克制表演，暖色侧光'}),'align');
  assert.equal(reviewed.document.shots[2].video_prompt_needs_review,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_tasks').get().n,0);
  db.close();
});

test('character changes flag only shots referencing that character; voice is included',()=>{
  const {db,id}=fixture(),p=S.project(db,id);
  const doc=S.patchTarget(p.document,'characters:c2',{voice:'更低、更克制'});
  assert.deepEqual(S.impact(p.document,doc),['shot2','shot4','shot6']);
  const next=S.save(db,id,0,doc,'voice');
  assert.equal(next.document.shots[0].stale,undefined);
  assert.equal(next.document.shots[1].stale,true);db.close();
});
test('restoring a document never rewinds the cost ledger',()=>{
  const {db,id}=fixture(),p=S.project(db,id);
  S.reserve(db,id,'test-ledger','text','story',{}, {},1000000);
  S.save(db,id,0,S.patchTarget(p.document,'story',{story:'new'}),'edit');
  const restored=S.save(db,id,1,p.document,'restore');
  assert.equal(restored.document.story,example.story);
  assert.equal(S.ledger(db,id).committed_micros,1000000);db.close();
});
test('unknown price and missing preview block calls before reservation',()=>{
  const {db,id}=fixture();
  assert.throws(()=>service.prepare(db,{},id,{kind:'image',target:'characters:c1',revision:0}),/配置/);
  const p=S.project(db,id);p.document.shots[0].image='local.png';
  S.save(db,id,0,p.document,'image');
  assert.throws(()=>service.prepare(db,{},id,{kind:'video',target:'shots:shot1',revision:1}),/确认/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_tasks').get().n,0);db.close();
});
test('restart conservatively preserves unknown reservations without resubmitting',()=>{
  const {db,id}=fixture();
  const t=S.reserve(db,id,'test-resume','video','shots:shot1',{}, {},1000000);
  S.updateTask(db,t.id,{state:'running'});
  service.recover(db,{},log);
  assert.equal(service.task(db,t.id,id).state,'unknown');
  assert.equal(S.ledger(db,id).committed_micros,1000000);
  assert.throws(()=>service.resume(db,{},log,id,t.id),/任务编号/);db.close();
});
test('model JSON must reference known assets and fit the short-film duration',()=>{
  const bad=S.json(example);bad.shots[0].characters=['missing'];assert.throws(()=>S.validate(bad),/不存在/);
  const long=S.json(example);long.shots[0].duration=10;assert.throws(()=>S.validate(long),/30秒/);
  const invalid=S.json(example);invalid.shots[0].trim_out=6;assert.throws(()=>S.validate(invalid),/出点/);
});
test('API integration: shared upstream data, revision guard, budget settings and legacy write protection',async()=>{
  const {db,id}=fixture(), express=require('express'), app=express();app.use(express.json());
  const studio=require('../src/routes/studio');app.use('/studio',studio.routes(db,{},log));app.use(studio.guardLegacy(db));app.post('/dramas/:id',(req,res)=>res.json({unexpected:true}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base='http://127.0.0.1:'+server.address().port;
  const call=(p,method='GET',body)=>fetch(base+p,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try {
    assert.equal((await call('/studio/projects/'+id)).status,200);
    assert.equal((await call('/dramas/'+id,'POST',{})).status,409);
    let res=await call('/studio/projects/'+id+'/settings','PUT',{settings:{},budget:51});assert.equal(res.status,400);
    res=await call('/studio/projects/'+id+'/preview','POST',{revision:0,target:'shots:shot3',changes:{camera:'轻推'}});assert.deepEqual((await res.json()).affected,['shot3']);
    res=await call('/studio/projects/'+id+'/apply','POST',{revision:0,target:'shots:shot3',changes:{camera:'轻推'}});assert.equal(res.status,200);
    assert.equal(db.prepare('SELECT movement FROM storyboards WHERE storyboard_number=3').get().movement,'轻推');
    res=await call('/studio/projects/'+id+'/apply','POST',{revision:0,target:'story',changes:{story:'stale'}});assert.equal(res.status,409);
  } finally { await new Promise(resolve=>server.close(resolve));db.close(); }
});

test('protected projects can be soft-deleted without losing history or costs',async()=>{
  const {db,id}=fixture(),express=require('express'),app=express(),studio=require('../src/routes/studio');
  const task=S.reserve(db,id,'delete-test','text','story',{}, {},1000000);
  S.save(db,id,0,S.patchTarget(S.project(db,id).document,'story',{story:'edited'}),'edit');
  app.use(express.json());app.use('/studio',studio.routes(db,{},log));app.use(studio.guardLegacy(db));
  app.delete('/dramas/:id',(req,res)=>res.sendStatus(require('../src/services/dramaService').deleteDrama(db,log,req.params.id)?200:404));
  app.delete('/dramas/:id/episodes',(req,res)=>res.sendStatus(200));
  app.delete('/characters/:id',(req,res)=>res.sendStatus(200));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await fetch(base+'/dramas/'+id+'/episodes',{method:'DELETE'})).status,409);
    const character=db.prepare('SELECT id FROM characters WHERE drama_id=?').get(id);
    assert.equal((await fetch(base+'/characters/'+character.id,{method:'DELETE'})).status,409);
    assert.equal((await fetch(base+'/dramas/'+id,{method:'DELETE'})).status,200);
    assert.deepEqual(await(await fetch(base+'/studio/projects')).json(),[]);
    assert.ok(db.prepare('SELECT deleted_at FROM dramas WHERE id=?').get(id).deleted_at);
    assert.equal(S.ledger(db,id).committed_micros,1000000);
    assert.equal(service.task(db,task.id,id).state,'reserved');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_versions WHERE drama_id=?').get(id).n,1);
    assert.equal((await fetch(base+'/dramas/'+id,{method:'DELETE'})).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
test('actual FFmpeg export retains all clips, sound and Chinese subtitles', {skip:!process.env.STUDIO_MEDIA_TEST}, async()=>{
  const root=path.resolve(__dirname,'../../artifacts/media-test');fs.mkdirSync(root,{recursive:true});
  const M=require('../src/services/studioRender'),F=require('../src/utils/ffmpegPath');
  await M.run(F.getFfmpegPath(),['-y','-f','lavfi','-i','color=c=0x263a36:s=1280x720:r=24:d=5','-f','lavfi','-i','sine=frequency=440:duration=5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(root,'test.mp4')]);
  const doc=S.json(example);for(const shot of doc.shots)shot.video='test.mp4';
  const result=await M.render(root,doc,'verified');
  assert.ok(Math.abs(result.duration-30)<0.5);
  assert.ok(fs.readFileSync(path.join(root,result.subtitles),'utf8').includes('这么晚'));
  const broken=S.json(doc);broken.shots[2].video='missing.mp4';await assert.rejects(()=>M.render(root,broken,'broken'),/不存在/);
  assert.throws(()=>M.local(root,'../outside.mp4'),/超出/);
});
test('local provider integration: text, ASR, image references, video task ID and usage', {skip:!process.env.STUDIO_MEDIA_TEST}, async()=>{
  const {db,id}=fixture(), express=require('express'), app=express(), requests=[];
  app.use(express.json({limit:'20mb'}));
  const root=path.resolve(__dirname,'../../artifacts/provider-test');fs.mkdirSync(root,{recursive:true});
  const png=await require('sharp')({create:{width:1280,height:720,channels:3,background:'#324339'}}).png().toBuffer();
  const clip=path.resolve(__dirname,'../../artifacts/media-test/test.mp4');
  let base;
  app.post('/chat/completions',(req,res)=>{requests.push(req.body);const asr=req.body.messages[0]?.content?.[0]?.type==='input_audio';res.json({id:'mock-chat-1',choices:[{message:{content:asr?'这是本机接口测试，不是真实语音识别。':JSON.stringify({camera:'缓慢推近'})}}],usage:{prompt_tokens:100,completion_tokens:50}})});
  app.post('/images/generations',(req,res)=>{requests.push(req.body);res.json({data:[{b64_json:png.toString('base64')}]})});
  app.post('/contents/generations/tasks',(req,res)=>{requests.push(req.body);res.json({id:'mock-video-task'})});
  app.get('/contents/generations/tasks/mock-video-task',(req,res)=>res.json({id:'mock-video-task',status:'succeeded',content:{video_url:base+'/clip.mp4'}}));
  app.get('/clip.mp4',(req,res)=>res.sendFile(clip));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});base='http://127.0.0.1:'+server.address().port;
  const cfg={storage:{local_path:root,base_url:base+'/static'}};
  try {
    const settings={};
    for(const kind of ['text','asr','image','video']) {
      const c=require('../src/services/aiConfigService').createConfig(db,log,{service_type:kind,provider:kind==='video' || kind==='image'?'volcengine':'openai',api_protocol:kind==='video'||kind==='image'?'volcengine':'openai',name:kind,base_url:base,endpoint:kind==='image'?'/images/generations':kind==='video'?'/contents/generations/tasks':'/chat/completions',query_endpoint:'/contents/generations/tasks/{task_id}',api_key:'mock-only-not-a-real-secret',model:[kind==='video'?'doubao-seedance-1-5-pro-251215':'mock-'+kind],is_active:true});
      settings[kind]={config_id:c.id,model:c.model[0],input_per_million:1,output_per_million:2,per_image:0.1,per_second:0.1,resolution:'720p'};
    }
    db.prepare('UPDATE studio_projects SET settings=? WHERE drama_id=?').run(JSON.stringify(settings),id);
    const params=service.prepare(db,cfg,id,{kind:'refine',target:'shots:shot3',instruction:'只改运镜',revision:0});
    const textTask=S.reserve(db,id,'mock-text-request',params.kind,params.target,params.input,params.snapshot,params.amount);
    await service.execute(db,cfg,log,textTask.id);
    assert.equal(service.task(db,textTask.id,id).state,'completed');
    assert.equal(service.task(db,textTask.id,id).actual_micros,200);
    service.apply(db,id,textTask.id,0);
    assert.equal(S.project(db,id).document.shots[2].camera,'缓慢推近');
    let p=S.project(db,id);
    for(const a of [...p.document.characters,...p.document.scenes]) a.image='ref.png';fs.writeFileSync(path.join(root,'ref.png'),png);
    p=S.save(db,id,p.revision,p.document,'refs');
    const ip=service.prepare(db,cfg,id,{kind:'image',target:'shots:shot1',revision:p.revision});
    const it=S.reserve(db,id,'mock-image-request',ip.kind,ip.target,ip.input,ip.snapshot,ip.amount);
    await service.execute(db,cfg,log,it.id);assert.equal(service.task(db,it.id,id).state,'completed');
    assert.ok(requests.find(r=>r.model==='mock-image').image.length>=2);
    service.apply(db,id,it.id,p.revision);p=S.project(db,id);p.document.preview_approved=true;S.save(db,id,p.revision,p.document,'preview');
    p=S.project(db,id);
    const vp=service.prepare(db,cfg,id,{kind:'video',target:'shots:shot1',pilot:true,revision:p.revision});
    const vt=S.reserve(db,id,'mock-video-request',vp.kind,vp.target,vp.input,vp.snapshot,vp.amount);
    await service.execute(db,cfg,log,vt.id);
    const video=service.task(db,vt.id,id);assert.equal(video.state,'completed',video.error);assert.equal(video.provider_task_id,'mock-video-task');assert.equal(video.result.info.audio,true);
    assert.equal(requests.find(r=>r.model==='doubao-seedance-1-5-pro-251215').generate_audio,true);
    assert.equal(requests.filter(r=>r.model==='doubao-seedance-1-5-pro-251215').length,1);
    assert.equal(S.ledger(db,id).tasks.length,3);
    const transcript=await service.transcribe(db,cfg,log,id,{revision:p.revision,request_key:'mock-audio-request'},{buffer:fs.readFileSync(clip)});
    await service.execute(db,cfg,log,transcript.id);
    assert.equal(service.task(db,transcript.id,id).state,'completed');
    assert.ok(service.task(db,transcript.id,id).result.transcript.includes('不是真实'));
    const duplicate=await service.transcribe(db,cfg,log,id,{revision:p.revision,request_key:'mock-audio-request'},{buffer:fs.readFileSync(clip)});
    assert.equal(duplicate.id,transcript.id);
  } finally { await new Promise(resolve=>server.close(resolve));db.close(); }
});
