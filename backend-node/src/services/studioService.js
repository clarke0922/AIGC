const fs = require('fs');
const path = require('path');
const S = require('./studioStore');
const media = require('./studioRender');
const aiConfigs = require('./aiConfigService');
const { postJSONWithTimeout } = require('./aiClient');
const { applyDeepSeekChatOptions } = require('./deepseekConfig');
const { STORY_RULE, composeShotVideoPrompt } = require('./shotVideoPrompt');
const active = new Set();
const MAX_TOKENS = 4096;
const SYSTEM = `${STORY_RULE}\n你是专业真人短片编剧和分镜导演。输出中文 JSON 对象，不输出代码围栏。设计30秒16:9短片，最多2角色、2场景、6个5秒镜头。人物动机清楚，有冲突和结局；对白每镜不超过15个汉字，克制自然，避免大动作和多人同时说话。为人物写清服装和声音，为场景固定光线，为分镜写镜头景别与运镜。所有人物是虚构成年角色。格式严格为：{"title":"片名","story":"梗概","script":"包含地点、人物、动作、对白的分场剧本","characters":[{"id":"c1","name":"姓名","appearance":"外观服装","voice":"声音","motivation":"动机"}],"scenes":[{"id":"s1","name":"场景","description":"环境光线"}],"shots":[{"id":"shot1","scene":"s1","characters":["c1"],"duration":5,"description":"画面动作","dialogue":"角色：对白","camera":"景别运镜","image_prompt":"写实电影摄影静帧","video_prompt":"真实表演动作与摄影，严格中文对白"}]}`;
function storage(cfg) { return path.resolve(cfg.storage?.local_path || './data/storage'); }
function settingsFor(db, p, kind) {
  const st = p.settings[kind];
  if (!st?.config_id || !st.model) S.fail(`请先配置${kind}模型和价格`);
  const config = aiConfigs.getConfig(db, Number(st.config_id));
  if (!config?.is_active) S.fail(`请在模型设置中启用${kind}配置`);
  if (!config.model.includes(st.model)) S.fail('指定模型不在该配置中');
  if (config.service_type !== kind && !(kind === 'image' && config.service_type === 'storyboard_image')) S.fail('模型类型不匹配');
  const url = new URL(config.base_url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) S.fail('模型接口须为HTTPS，或本机HTTP服务');
  if (kind === 'video' && !['volcengine','volcengine_omni'].includes(config.api_protocol)) S.fail('首版对白验收仅开放火山视频协议，请选择相应配置');
  if (kind === 'image' && config.api_protocol !== 'volcengine') S.fail('首版预算生图仅开放火山图片协议（单张同步生成）');
  const fields = kind === 'text' ? ['input_per_million','output_per_million'] : kind === 'image' ? ['per_image'] : ['per_second'];
  for (const field of fields) { if (st[field] == null || st[field] === '') S.fail('价格未知：请填写供应商费用上界后再生成'); S.money(st[field]); }
  return { config, snapshot: { ...st, provider: config.provider, base_url: config.base_url, endpoint: config.endpoint, query_endpoint: config.query_endpoint, api_protocol: config.api_protocol } };
}
function refsFor(doc, item) {
  return item.characters ? [...item.characters.map(id => doc.characters.find(c => c.id === id)), doc.scenes.find(s => s.id === item.scene)].filter(Boolean) : [];
}
function mediaInput(doc, target) {
  const item = S.json(S.target(doc,target)), refs = refsFor(doc,item).map(S.json);
  for (const obj of [item,...refs]) for (const key of ['video','stale','trim_in','trim_out','volume','enabled','video_prompt_needs_review']) delete obj[key];
  return { item, refs };
}
function estimate(kind, input, snapshot) {
  if (kind === 'text') return S.money((Buffer.byteLength(input.system + input.prompt, 'utf8') + 1024) / 1000000 * snapshot.input_per_million + MAX_TOKENS / 1000000 * snapshot.output_per_million);
  if (kind === 'asr') return S.money(Math.ceil(input.seconds) * snapshot.per_second);
  if (kind === 'image') return S.money(snapshot.per_image);
  if (kind === 'video') return S.money(input.item.duration * snapshot.per_second);
  return 0;
}
function task(db, id, projectId) {
  const row = db.prepare('SELECT * FROM studio_tasks WHERE id=? AND drama_id=?').get(id,Number(projectId));
  if (!row) S.fail('任务不存在',404);
  return { ...row, input: JSON.parse(row.input), config_snapshot: JSON.parse(row.config_snapshot), result: row.result ? JSON.parse(row.result) : null };
}
function prepare(db, cfg, id, body) {
  const p = S.project(db,id);
  if (p.revision !== body.revision) S.fail('作品已经修改，请刷新后生成',409);
  let kind = body.kind, target = body.target || 'story', input;
  if (kind === 'story' || kind === 'refine') {
    if (kind === 'story' && p.document.shots.length) S.fail('已有分镜，请使用局部微调保留已有素材');
    const instruction = String(body.instruction || '').trim();
    if (instruction.length > 8000) S.fail('修改指令过长');
    input = kind === 'story'
      ? { system: SYSTEM, prompt: p.document.story, mode:'story' }
      : { system: STORY_RULE + '你是短片编辑。只输出JSON对象，包含待修改字段的新值，不包含其他字段。不改变未要求的内容。允许字段：' + Object.keys(S.target(p.document,target)).filter(k => !['id','image','video','stale'].includes(k)).join(','), prompt: `当前对象：${JSON.stringify(S.target(p.document,target))}\n用户指令：${instruction}`, mode:'refine', before: S.target(p.document,target) };
    if (!input.prompt.trim() || (kind === 'refine' && !instruction)) S.fail('请先填写故事或修改指令');
    kind = 'text';
  } else if (kind === 'image' || kind === 'video') {
    input = mediaInput(p.document,target);
    if (kind === 'image' && input.item.characters && input.refs.some(r => !r.image)) S.fail('请先生成并选择出场角色和场景参考图');
    if (kind === 'video') {
      if (S.target(p.document,target).video_prompt_needs_review) S.fail('片段描述已修改，请先检查并确认该镜头的视频提示词');
      if (!target.startsWith('shots:') || !input.item.image) S.fail('请先为分镜选择静帧图');
      if (!p.document.preview_approved) S.fail('请先确认剧本和参考图预览');
      input.pilot = body.pilot === true;
      if (input.pilot && (input.item.duration !== 5 || !input.item.dialogue.trim())) S.fail('试镜须为5秒且包含人物对白');
      if (!input.pilot && !p.pilot_task) S.fail('请先生成并验收一个5秒对白试镜');
    }
  } else if (kind === 'export') {
    target = 'film'; input = { document: p.document };
    if (!p.document.shots.length || p.document.shots.some(s => s.enabled !== false && (!s.video || s.stale))) S.fail('请补齐视频并确认待更新镜头');
  } else S.fail('不支持的生成类型');
  input.revision = p.revision;
  let snapshot = {};
  if (kind !== 'export') snapshot = settingsFor(db,p,kind).snapshot;
  if (kind === 'video' && !input.pilot) {
    const pilot = task(db,p.pilot_task,id);
    if (pilot.state !== 'completed' || S.hash(pilot.config_snapshot) !== S.hash(snapshot)) S.fail('视频模型或价格已变化，请重新验收试镜');
  }
  return { kind, target, input, snapshot, amount: estimate(kind,input,snapshot) };
}
function submit(db, cfg, log, id, body) {
  const args = prepare(db,cfg,id,body);
  const row = S.reserve(db,id,body.request_key,args.kind,args.target,args.input,args.snapshot,args.amount);
  if (!row.duplicate) setImmediate(() => execute(db,cfg,log,row.id).catch(e => log.error('Studio task', { error:e.message })));
  return row;
}
async function transcribe(db,cfg,log,id,body,file) {
  if (!file?.buffer || file.buffer.length > 10*1024*1024) S.fail('请上传不超过10MB的音频');
  const p = S.project(db,id);
  const replay = db.prepare('SELECT * FROM studio_tasks WHERE drama_id=? AND request_key=?').get(Number(id),body.request_key);
  if (replay) {
    const original=JSON.parse(replay.input);
    if (replay.kind!=='asr' || original.audio_hash!==S.hash(file.buffer.toString('base64'))) S.fail('请求标识已用于其他录音',409);
    return {...replay,duplicate:true};
  }
  if (Number(body.revision) !== p.revision) S.fail('请刷新项目再转写',409);
  const { snapshot } = settingsFor(db,p,'asr');
  const root = storage(cfg), dir = path.join(root,'studio','recordings'); fs.mkdirSync(dir,{recursive:true});
  const filename = `${require('crypto').randomUUID()}.webm`, abs = path.join(dir,filename);
  fs.writeFileSync(abs,file.buffer);
  let info;
  try { info = await media.probe(abs); } catch (e) { fs.unlinkSync(abs); throw e; }
  if (!info.audio || !Number.isFinite(info.seconds) || info.seconds <= 0 || info.seconds > 300) { fs.unlinkSync(abs); S.fail('录音须包含音频且不超过5分钟'); }
  const input = { file:`studio/recordings/${filename}`, audio_hash:S.hash(file.buffer.toString('base64')), seconds:info.seconds, revision:p.revision };
  let row;
  try { row = S.reserve(db,id,body.request_key,'asr','story',input,snapshot,estimate('asr',input,snapshot)); }
  catch(e) { fs.unlinkSync(abs); throw e; }
  if (!row.duplicate) setImmediate(() => execute(db,cfg,log,row.id));
  return row;
}
async function chat(config, model, system, prompt) {
  const endpoint = config.endpoint || '/chat/completions';
  const body = applyDeepSeekChatOptions(config,{ model, messages:[{role:'system',content:system},{role:'user',content:prompt}], max_tokens:MAX_TOKENS, response_format:{type:'json_object'}, stream:false });
  const res = await postJSONWithTimeout(config.base_url.replace(/\/$/,'') + endpoint, {...(config.api_key ? {Authorization:'Bearer '+config.api_key} : {})},body,120000);
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error('模型接口返回HTTP '+res.statusCode+'，请检查模型权限与余额');
  const data = JSON.parse(res.raw), content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容');
  return { content, usage:data.usage, provider_task_id:data.id };
}
async function saveVideo(root, url, id) {
  if (!/^https?:\/\//.test(url || '')) throw new Error('视频结果地址无效');
  const res = await fetch(url,{signal:AbortSignal.timeout(120000)});
  if (!res.ok) throw new Error('视频下载失败，保留原任务以继续下载');
  const relative = `studio/videos/${id}.mp4`, abs = path.join(root,relative);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  const { pipeline } = require('stream/promises');
  const { Readable } = require('stream');
  await pipeline(Readable.fromWeb(res.body),fs.createWriteStream(abs));
  const info = await media.probe(abs);
  if (!info.video) throw new Error('返回的文件不是视频');
  return { path:relative, media_type:'video', info };
}
async function execute(db,cfg,log,taskId, resume = false) {
  if (active.has(taskId)) return;
  const row = db.prepare('SELECT drama_id FROM studio_tasks WHERE id=?').get(taskId);
  const t = task(db,taskId,row.drama_id);
  if (t.state !== 'reserved' && !resume) return;
  active.add(taskId);
  try {
    const root = storage(cfg), st = t.config_snapshot;
    let config;
    if (t.kind !== 'export') {
      config = aiConfigs.getConfig(db,Number(st.config_id));
      if (!config?.is_active) throw new Error('模型配置不存在或未启用');
      // A queued task uses its saved model/endpoint, never silently follows edited settings.
      config = { ...config, ...st, model:[st.model], default_model:st.model };
    }
    S.updateTask(db,t.id,{state:'running',error:null});
    let result, usage, actual, providerId;
    if (t.kind === 'text') {
      const res = await chat(config,st.model,t.input.system,t.input.prompt);
      usage=res.usage; providerId=res.provider_task_id;
      if (Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens)) actual=S.money(usage.prompt_tokens/1000000*st.input_per_million+usage.completion_tokens/1000000*st.output_per_million);
      // Retain billed usage even when structured content fails validation.
      S.updateTask(db,t.id,{usage:usage || null, provider_task_id:providerId || null, ...(actual != null ? {actual_micros:actual} : {})});
      const parsed=JSON.parse(res.content.replace(/^```(?:json)?\s*|\s*```$/g,''));
      if (t.input.mode === 'story') {
        const doc = { ...S.emptyDocument(), ...parsed, preview_approved:false, export_url:'' };
        for (const group of ['characters','scenes','shots']) for (const item of doc[group] || []) { delete item.image; delete item.video; }
        S.validate(doc); result={document:doc};
      } else {
        const p=S.project(db,t.drama_id);
        S.patchTarget(p.document,t.target,parsed); result={changes:parsed,before:t.input.before};
      }
    } else if (t.kind === 'asr') {
      const source=media.local(root,t.input.file), wav=source+'.wav';
      await media.run(require('../utils/ffmpegPath').getFfmpegPath(),['-y','-i',source,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
      const audio=fs.readFileSync(wav);
      const res=await postJSONWithTimeout(config.base_url.replace(/\/$/,'')+(config.endpoint || '/chat/completions'),{...(config.api_key ? {Authorization:'Bearer '+config.api_key} : {})},{model:st.model,messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:'data:audio/wav;base64,'+audio.toString('base64')}}]}],asr_options:{language:'zh'},stream:false},120000);
      if(res.statusCode<200 || res.statusCode>=300) throw new Error('语音接口返回HTTP '+res.statusCode);
      const data=JSON.parse(res.raw); if(!data.choices?.[0]?.message?.content) throw new Error('未识别出文字');
      result={transcript:data.choices[0].message.content}; usage=data.usage; providerId=data.id;
    } else if (t.kind === 'image') {
      const item=t.input.item, refs=t.input.refs;
      const prompt=item.image_prompt || (item.name+'。'+(item.appearance || item.description)+ '。写实电影摄影，人物定妆或空镜场景参考，画面无文字。');
      const res=await require('./imageClient').callImageApi(db,log,{config_override:config,model:st.model,prompt,size:'2560x1440',reference_image_urls:refs.map(r=>media.local(root,r.image)),storage_local_path:root,files_base_url:cfg.storage.base_url});
      if(res.error || !res.image_url) throw new Error(res.error || '生图未返回结果');
      const file=await require('./uploadService').downloadImageToLocal(root,res.image_url,'images',log,'studio',`studio/project-${t.drama_id}`);
      if(!file) throw new Error('图片没有保存到本机');
      result={path:file,media_type:'image'};
    } else if (t.kind === 'video') {
      let remote=t.result?.remote_url;
      if(!remote && !t.provider_task_id) {
        if(resume) throw new Error('提交状态不明且没有任务编号：请在供应商账单确认后对账，不能自动重发');
        const item=t.input.item;
        const context=t.input.refs.map(r=>r.name+'：'+(r.appearance || r.description)+(r.voice ? '，声音：'+r.voice : '')).join('\n');
        const res=await require('./videoClient').callVideoApi(db,log,{config_override:config,model:st.model,prompt:composeShotVideoPrompt(item,context),duration:item.duration,aspect_ratio:'16:9',resolution:st.resolution || '720p',generate_audio:true,image_url:media.local(root,item.image),storage_local_path:root,files_base_url:cfg.storage.base_url});
        if(res.error) throw new Error(res.error);
        remote=res.video_url;
        if(res.task_id) { t.provider_task_id=String(res.task_id); S.updateTask(db,t.id,{provider_task_id:t.provider_task_id,state:'polling'}); }
        if(!remote && !t.provider_task_id) throw new Error('供应商未返回任务编号，请先对账');
      }
      if(!remote) {
        const polled=await require('./videoClient').pollVideoTask(db,log,null,t.provider_task_id,config,90,10000);
        if(polled.error || !polled.video_url) throw new Error(polled.error || '视频还未完成，请继续查询原任务');
        remote=polled.video_url;
      }
      S.updateTask(db,t.id,{result:{remote_url:remote}});
      result={...await saveVideo(root,remote,t.id),remote_url:remote};
    } else if (t.kind === 'export') result=await media.render(root,t.input.document,t.id);
    S.updateTask(db,t.id,{state:'completed',result,usage:usage || null,...(providerId ? {provider_task_id:providerId} : {}),...(actual != null ? {actual_micros:actual} : {})});
  } catch(e) {
    S.updateTask(db,t.id,{state:t.kind === 'export' ? 'failed' : 'unknown',error:String(e.message).slice(0,500)});
  } finally { active.delete(taskId); }
}
function apply(db,id,taskId,revision) {
  const t=task(db,taskId,id), p=S.project(db,id);
  if(t.state!=='completed') S.fail('任务未完成');
  if(p.revision!==revision) S.fail('请刷新后再使用该版本',409);
  let doc=S.json(p.document), cleared;
  if(t.kind==='text') {
    if(t.input.revision!==p.revision) S.fail('修改预览已过期，请基于当前内容重新微调',409);
    doc=t.result.document || S.patchTarget(doc,t.target,t.result.changes);
  } else if(t.kind==='asr') {
    if(t.input.revision!==p.revision) S.fail('故事已修改，请手动复制转写结果以免覆盖',409);
    doc.story=t.result.transcript;
  } else if(t.kind==='image' || t.kind==='video') {
    // Allow choosing historical takes while explicitly marking content mismatches.
    const current=S.target(doc,t.target);
    const matches=S.hash(mediaInput(doc,t.target))===S.hash({item:t.input.item,refs:t.input.refs});
    current[t.kind]=t.result.path;
    if(t.kind==='video' && matches) cleared=t.target;
    else if(t.kind==='video') current.stale=true;
  } else if(t.kind==='export') {
    if(t.input.revision!==p.revision) S.fail('剪辑内容已变化，请重新导出',409);
    doc.export_url='/static/'+t.result.video;
  }
  return S.save(db,id,revision,doc,'使用生成版本 '+t.id,cleared);
}
function resume(db,cfg,log,id,taskId) {
  const t=task(db,taskId,id);
  if(t.kind!=='video' || (!t.provider_task_id && !t.result?.remote_url)) S.fail('没有可查询的视频任务编号，请先对账');
  if(!['unknown','polling','running'].includes(t.state)) S.fail('该任务无需继续查询');
  setImmediate(()=>execute(db,cfg,log,t.id,true));
}
function recover(db,cfg,log) {
  const rows=db.prepare("SELECT * FROM studio_tasks WHERE state IN ('reserved','running','polling')").all();
  for(const row of rows) {
    if(row.kind==='video' && row.provider_task_id) setImmediate(()=>execute(db,cfg,log,row.id,true));
    else S.updateTask(db,row.id,{state:'unknown',error:'应用曾中断，保留费用预留；请查询原任务或按账单对账后再生成'});
  }
}
module.exports={storage,settingsFor,mediaInput,estimate,task,prepare,submit,transcribe,execute,apply,resume,recover};
