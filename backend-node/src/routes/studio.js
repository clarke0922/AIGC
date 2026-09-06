const express = require('express');
const multer = require('multer');
const S = require('../services/studioStore');
const service = require('../services/studioService');
const configs = require('../services/aiConfigService');
const { createDrama } = require('../services/dramaService');
function routes(db,cfg,log) {
  const r=express.Router();
  const handle = fn => (req,res,next) => Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(e.status || 500).json({error:e.message}));
  r.get('/projects',handle((req,res)=>res.json(db.prepare('SELECT d.id,d.title,s.revision,s.budget_micros,s.created_at FROM studio_projects s JOIN dramas d ON s.drama_id=d.id WHERE d.deleted_at IS NULL ORDER BY s.created_at DESC').all())));
  r.post('/projects',handle((req,res)=>{
    const doc=req.body.example ? require('../../examples/rain-letter.json') : S.emptyDocument(String(req.body.title || '我的第一部短片').slice(0,100));
    S.validate(doc);
    const id=db.transaction(()=>{
      const drama=createDrama(db,log,{title:doc.title,style:'realistic',metadata:{aspect_ratio:'16:9',studio:true}});
      db.prepare('INSERT INTO studio_projects (drama_id,document,created_at) VALUES (?,?,?)').run(drama.id,JSON.stringify(doc),S.now());
      S.sync(db,drama.id,doc); return drama.id;
    })();
    res.status(201).json(S.project(db,id));
  }));
  r.get('/models',handle((req,res)=>res.json(configs.listConfigs(db).map(c=>({id:c.id,name:c.name,service_type:c.service_type,model:c.model,base_url:c.base_url,api_protocol:c.api_protocol,configured:!!c.api_key})))));
  r.post('/models',handle((req,res)=>{
    const b=req.body;
    if(!['text','asr','image','video'].includes(b.kind)) S.fail('模型类型无效');
    const defaults={text:['https://api.deepseek.com','/chat/completions','openai','deepseek'],asr:['https://dashscope.aliyuncs.com/compatible-mode/v1','/chat/completions','openai','dashscope'],image:['https://ark.cn-beijing.volces.com/api/v3','/images/generations','volcengine','volcengine'],video:['https://ark.cn-beijing.volces.com/api/v3','/contents/generations/tasks','volcengine','volcengine']};
    const [url,endpoint,protocol,provider]=defaults[b.kind];
    const base=b.base_url || url, u=new URL(base);
    if(u.protocol!=='https:' && !(u.protocol==='http:' && ['127.0.0.1','localhost'].includes(u.hostname))) S.fail('请填写HTTPS接口地址');
    if(!b.model || !b.api_key || b.api_key.length>2000) S.fail('模型标识和密钥必填');
    const model=configs.createConfig(db,log,{service_type:b.kind,provider,name:'简易工作台 '+b.kind,base_url:base,endpoint,query_endpoint:b.kind==='video' ? '/contents/generations/tasks/{task_id}' : '',api_protocol:protocol,api_key:b.api_key,model:[b.model],is_active:true,is_default:false});
    res.status(201).json({id:model.id});
  }));
  r.get('/projects/:id',handle((req,res)=>res.json({...S.project(db,req.params.id),ledger:S.ledger(db,req.params.id)})));
  r.put('/projects/:id/settings',handle((req,res)=>{
    const p=S.project(db,req.params.id), settings=req.body.settings;
    if(!settings || typeof settings!=='object' || Array.isArray(settings)) S.fail('设置无效');
    // Only model references and prices are persisted here; API keys remain in upstream configuration.
    const clean={};
    for(const kind of ['text','asr','image','video']) if(settings[kind]) {
      clean[kind]={};
      for(const k of ['config_id','model','input_per_million','output_per_million','per_image','per_second','resolution']) if(settings[kind][k]!=null) clean[kind][k]=settings[kind][k];
      for(const k of ['input_per_million','output_per_million','per_image','per_second']) if(clean[kind][k]!=null) S.money(clean[kind][k]);
      if(clean[kind].resolution && !['480p','720p','1080p'].includes(clean[kind].resolution)) S.fail('分辨率无效');
    }
    const budget=req.body.budget==null ? p.budget_micros : S.money(req.body.budget);
    if(budget>50000000) S.fail('首版预算上限为50元，请缩短作品，不自动提高预算');
    if(budget<S.ledger(db,p.drama_id).committed_micros) S.fail('预算不能低于已支出和预留费用');
    db.prepare('UPDATE studio_projects SET settings=?,budget_micros=?,pilot_task=? WHERE drama_id=?').run(JSON.stringify(clean),budget,S.hash(clean.video)!==S.hash(p.settings.video) ? null : p.pilot_task,p.drama_id);
    res.json(S.project(db,p.drama_id));
  }));
  r.post('/projects/:id/preview',handle((req,res)=>{
    const p=S.project(db,req.params.id), b=req.body;
    if(p.revision!==b.revision) S.fail('请刷新后编辑',409);
    const doc=S.patchTarget(p.document,b.target,b.changes);
    res.json({before:S.target(p.document,b.target),after:S.target(doc,b.target),affected:S.impact(p.document,doc),revision:p.revision});
  }));
  r.post('/projects/:id/apply',handle((req,res)=>{
    const p=S.project(db,req.params.id),b=req.body;
    res.json(S.save(db,p.drama_id,b.revision,S.patchTarget(p.document,b.target,b.changes),'手动修改 '+b.target));
  }));
  r.post('/projects/:id/review-video-prompt',handle((req,res)=>{
    const p=S.project(db,req.params.id),shot=p.document.shots.find(s=>s.id===req.body.shot_id);
    if(!shot) S.fail('镜头不存在',404);
    shot.video_prompt_needs_review=false;
    res.json(S.save(db,p.drama_id,req.body.revision,p.document,'确认视频提示词 '+shot.id));
  }));
  r.post('/projects/:id/approve-preview',handle((req,res)=>{
    const p=S.project(db,req.params.id),d=p.document;
    if(!d.script || !d.shots.length || [...d.characters,...d.scenes,...d.shots].some(x=>!x.image)) S.fail('请先完成剧本与全部角色、场景、分镜图');
    d.preview_approved=true;
    res.json(S.save(db,p.drama_id,req.body.revision,d,'确认剧本和参考图预览'));
  }));
  r.post('/projects/:id/acknowledge',handle((req,res)=>{
    const p=S.project(db,req.params.id),keys=req.body.shots;
    if(!Array.isArray(keys) || !keys.length) S.fail('请选择已检查的镜头');
    for(const key of keys) { const s=p.document.shots.find(x=>x.id===key); if(!s) S.fail('镜头不存在'); s.stale=false; }
    res.json(S.save(db,p.drama_id,req.body.revision,p.document,'人工确认选中镜头继续使用'));
  }));
  r.post('/projects/:id/reorder',handle((req,res)=>{
    const p=S.project(db,req.params.id),ids=req.body.shots;
    if(!Array.isArray(ids) || ids.length!==p.document.shots.length || new Set(ids).size!==ids.length || ids.some(id=>!p.document.shots.some(s=>s.id===id))) S.fail('镜头顺序须完整且不重复');
    p.document.shots=ids.map(id=>p.document.shots.find(s=>s.id===id));
    res.json(S.save(db,p.drama_id,req.body.revision,p.document,'调整剪辑顺序'));
  }));
  r.get('/projects/:id/versions',handle((req,res)=>{ S.project(db,req.params.id); res.json(db.prepare('SELECT revision,reason,created_at FROM studio_versions WHERE drama_id=? ORDER BY revision DESC').all(Number(req.params.id))); }));
  r.post('/projects/:id/restore',handle((req,res)=>{
    const row=db.prepare('SELECT document FROM studio_versions WHERE drama_id=? AND revision=?').get(Number(req.params.id),req.body.version);
    if(!row) S.fail('版本不存在',404);
    res.json(S.save(db,req.params.id,req.body.revision,JSON.parse(row.document),'恢复版本 '+req.body.version));
  }));
  r.post('/projects/:id/quote',handle((req,res)=>{const args=service.prepare(db,cfg,req.params.id,req.body); res.json({estimated_micros:args.amount,remaining_micros:S.ledger(db,req.params.id).remaining_micros});}));
  r.post('/projects/:id/tasks',handle((req,res)=>res.status(202).json(service.submit(db,cfg,log,req.params.id,req.body))));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
  r.post('/projects/:id/upload-image',upload.single('image'),handle(async(req,res)=>{
    const p=S.project(db,req.params.id), target=req.body.target;
    if(!/^(characters|scenes|shots):/.test(target || '')) S.fail('请选择要替换图片的对象');
    if(!req.file) S.fail('请选择参考图片');
    if(Number(req.body.revision)!==p.revision) S.fail('内容已变化，请刷新后上传',409);
    const sharp=require('sharp'),fs=require('fs'),path=require('path');
    const buffer=await sharp(req.file.buffer,{limitInputPixels:40000000}).rotate().png().toBuffer();
    const file=`studio/project-${p.drama_id}/uploads/${require('crypto').randomUUID()}.png`;
    const absolute=path.join(service.storage(cfg),file);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,buffer);
    S.target(p.document,target).image=file;
    res.json(S.save(db,p.drama_id,Number(req.body.revision),p.document,'上传参考图 '+target));
  }));
  r.post('/projects/:id/transcribe',upload.single('audio'),handle(async(req,res)=>res.status(202).json(await service.transcribe(db,cfg,log,req.params.id,req.body,req.file))));
  r.post('/projects/:id/tasks/:task/apply',handle((req,res)=>res.json(service.apply(db,req.params.id,req.params.task,req.body.revision))));
  r.post('/projects/:id/tasks/:task/resume',handle((req,res)=>{service.resume(db,cfg,log,req.params.id,req.params.task);res.json({ok:true});}));
  r.post('/projects/:id/tasks/:task/reconcile',handle((req,res)=>{
    const t=service.task(db,req.params.task,req.params.id);
    if(['reserved','running','polling'].includes(t.state)) S.fail('任务仍在执行，请等待或继续查询');
    const note=String(req.body.note || '').trim();
    if(note.length<4) S.fail('请填写账单依据或供应商确认信息');
    S.updateTask(db,t.id,{actual_micros:S.money(req.body.actual),reconciliation_note:note,state:t.state==='unknown' ? 'reconciled' : t.state});
    res.json(S.ledger(db,req.params.id));
  }));
  r.post('/projects/:id/tasks/:task/approve-pilot',handle((req,res)=>{
    const t=service.task(db,req.params.task,req.params.id);
    if(t.kind!=='video' || !t.input.pilot || t.state!=='completed' || !t.result?.info?.audio) S.fail('需要已完成且有声音的5秒试镜');
    if(!['identity','dialogue','lips','motion'].every(k=>req.body.checks?.[k]===true)) S.fail('请逐项检查角色、对白、口型和动作');
    const p=S.project(db,req.params.id),{snapshot}=service.settingsFor(db,p,'video');
    if(S.hash(snapshot)!==S.hash(t.config_snapshot)) S.fail('试镜模型设置已变化，请重新试镜');
    if(t.actual_micros==null || !t.reconciliation_note) S.fail('请先用供应商账单核对试镜费用');
    db.prepare('UPDATE studio_projects SET pilot_task=? WHERE drama_id=?').run(t.id,Number(req.params.id));
    res.json({ok:true});
  }));
  r.get('/projects/:id/export-project',handle((req,res)=>{
    const p=S.project(db,req.params.id),ledger=S.ledger(db,req.params.id);
    const Zip=require('adm-zip'),zip=new Zip();
    zip.addFile('project.json',Buffer.from(JSON.stringify({document:p.document,revision:p.revision},null,2)));
    zip.addFile('costs.json',Buffer.from(JSON.stringify(ledger,null,2)));
    const files=new Set([...p.document.characters,...p.document.scenes,...p.document.shots].flatMap(x=>[x.image,x.video]).filter(Boolean));
    for(const t of ledger.tasks) if(t.result?.path) files.add(t.result.path);
    for(const file of files) zip.addLocalFile(require('../services/studioRender').local(service.storage(cfg),file),require('path').dirname(file));
    res.attachment('studio-project.zip').send(zip.toBuffer());
  }));
  return r;
}
// Studio writes must use revision checks and cost gates. Legacy projects keep their existing API.
function guardLegacy(db) {
  return (req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method) || req.path.startsWith('/studio')) return next();
    // Whole-project deletion only sets dramas.deleted_at; history and costs remain intact.
    if(req.method==='DELETE' && /^\/dramas\/\d+\/?$/.test(req.path)) return next();
    let id=Number(req.body?.drama_id);
    const ids=new Set(id ? [id] : []);
    const add=(table,value)=>{
      if(!Number(value)) return;
      const row=table==='storyboards' ? db.prepare('SELECT e.drama_id FROM storyboards s JOIN episodes e ON s.episode_id=e.id WHERE s.id=?').get(Number(value)) : db.prepare(`SELECT drama_id FROM ${table} WHERE id=?`).get(Number(value));
      if(row) ids.add(row.drama_id);
    };
    for(const [field,table] of [['character_id','characters'],['scene_id','scenes'],['storyboard_id','storyboards'],['episode_id','episodes'],['prop_id','props']]) {
      add(table,req.body?.[field]);
      for(const value of Array.isArray(req.body?.[field+'s']) ? req.body[field+'s'] : []) add(table,value);
    }
    const nested=req.path.match(/^\/(?:images|videos)\/(episode|scene|image)\/(\d+)/);
    if(nested) add({episode:'episodes',scene:'scenes',image:'image_generations'}[nested[1]],nested[2]);
    const m=req.path.match(/^\/(dramas|characters|scenes|storyboards|episodes|props)\/(\d+)/);
    if(m) {
      if(m[1]==='dramas') id=Number(m[2]);
      else if(m[1]==='storyboards') id=db.prepare('SELECT e.drama_id FROM storyboards s JOIN episodes e ON s.episode_id=e.id WHERE s.id=?').get(Number(m[2]))?.drama_id;
      else id=db.prepare(`SELECT drama_id FROM ${m[1]} WHERE id=?`).get(Number(m[2]))?.drama_id;
    }
    if(!id && req.body?.episode_id) id=db.prepare('SELECT drama_id FROM episodes WHERE id=?').get(Number(req.body.episode_id))?.drama_id;
    if(!id && req.body?.storyboard_id) id=db.prepare('SELECT e.drama_id FROM storyboards s JOIN episodes e ON s.episode_id=e.id WHERE s.id=?').get(Number(req.body.storyboard_id))?.drama_id;
    if(id) ids.add(id);
    if([...ids].some(value=>db.prepare('SELECT 1 FROM studio_projects WHERE drama_id=?').get(value))) return res.status(409).json({success:false,error:{message:'该项目启用了预算与版本保护，请在简易工作台修改和生成'}});
    next();
  };
}
module.exports={routes,guardLegacy};
