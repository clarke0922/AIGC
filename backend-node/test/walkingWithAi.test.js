const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {callVideoApi,pollVideoTask}=require('../src/services/videoClient');
const configs=require('../src/services/aiConfigService');
const client=require('../src/services/walkingWithAiClient');
const log={info(){},warn(){},error(){}};

test('self-hosted H3 uses the configured /api/v1 prefix, uploads assets, submits jobs and resolves output URLs',async t=>{
  const requests=[], uploads=[];
  let status='completed';
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req) raw+=chunk;
    requests.push({method:req.method,url:req.url,auth:req.headers.authorization,raw});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/v1/capabilities') return res.end(JSON.stringify({features:[{id:'minimax-h3'}]}));
    if(req.url==='/api/v1/assets?asset_type=image'){
      uploads.push(raw);return res.end(JSON.stringify({asset_id:'asset-'+uploads.length}));
    }
    if(req.url==='/api/v1/jobs' && req.method==='POST'){
      const body=JSON.parse(raw);
      assert.deepEqual(Object.keys(body).sort(),['feature','inputs','mode','parameters']);
      res.statusCode=202;return res.end(JSON.stringify({job_id:'job-1'}));
    }
    if(req.url==='/api/v1/jobs/job-1') return res.end(JSON.stringify({status,error:status==='failed'?'GPU unavailable':null}));
    if(req.url==='/api/v1/jobs/job-1/outputs') return res.end(JSON.stringify({outputs:[{media_type:'video/mp4',url:'/view?filename=result.mp4&type=output'}]}));
    res.statusCode=405;res.end(JSON.stringify({detail:'Method Not Allowed'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const config={provider:'minimax_h3',api_protocol:'minimax_h3',base_url:origin+'/api/v1',endpoint:'/jobs',query_endpoint:'/jobs/{job_id}',model:['minimax-h3'],api_key:''};
  await configs.testConnection({...config,service_type:'video'});
  assert.equal(requests[0].url,'/api/v1/capabilities');
  const invoke=opts=>callVideoApi(null,log,{config_override:config,prompt:'A quiet street',duration:5,aspect_ratio:'16:9',...opts});
  assert.equal((await invoke({})).task_id,'job-1');
  const body=JSON.parse(requests.at(-1).raw);
  assert.equal(body.mode,'t2v');
  assert.equal(body.parameters.duration,5);
  assert.equal(body.parameters.width%32,0);
  assert.equal(body.parameters.height%32,0);
  assert.match(body.inputs.prompt,/A quiet street/);
  assert.equal(requests.at(-1).auth,undefined);
  const image='data:image/png;base64,aW1hZ2UtYnl0ZXM=';
  await invoke({first_frame_url:image,last_frame_url:image});
  const frames=JSON.parse(requests.at(-1).raw);
  assert.equal(frames.mode,'i2v');
  assert.equal(frames.inputs.first_frame,'asset-1');
  assert.equal(frames.inputs.last_frame,'asset-1');
  assert.equal(uploads.length,1);
  assert.match(uploads[0],/image-bytes/);
  await invoke({reference_urls:[image],first_frame_url:image});
  const refs=JSON.parse(requests.at(-1).raw);
  assert.equal(refs.mode,'r2v');
  assert.deepEqual(refs.inputs.reference_images,['asset-2']);
  assert.equal(refs.inputs.first_frame,undefined);
  const completed=await pollVideoTask(null,log,1,'job-1',config,1,0);
  assert.equal(completed.video_url,origin+'/view?filename=result.mp4&type=output');
  for(const terminal of ['failed','cancelled']){
    status=terminal;
    const result=await pollVideoTask(null,log,1,'job-1',config,1,0);
    assert.match(result.error,terminal==='failed'?/GPU unavailable/:/已取消/);
  }
  const fs=require('node:fs'),path=require('node:path');
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'walkingwithai-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'reference.png'),'local-image-bytes');
  await invoke({first_frame_url:'reference.png',storage_local_path:root});
  assert.match(uploads.at(-1),/local-image-bytes/);
  const before=requests.length;
  assert.match((await invoke({first_frame_url:'../outside.png',storage_local_path:root})).error,/超出素材目录/);
  assert.equal(requests.length,before);
  config.api_key='test-key';
  await invoke({});
  assert.equal(requests.at(-1).auth,'Bearer test-key');
  status='running';
  assert.match((await pollVideoTask(null,log,1,'job-1',config,1,0)).error,/等待超时/);
});

test('self-hosted protocol is explicit or inferred only from the H3 /jobs configuration',()=>{
  assert.equal(client.isConfig({api_protocol:'walkingwithai'}),true);
  assert.equal(client.isConfig({provider:'minimax_h3',endpoint:'/jobs'}),true);
  assert.equal(client.isConfig({api_protocol:'minimax_h3',endpoint:'/v2/video_generation'}),false);
});

test('upload failure prevents job submission and preserves the upstream error',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url)=>{
    calls.push(url);
    if(url.startsWith('data:')) return new Response('image',{headers:{'Content-Type':'image/png'}});
    return new Response(JSON.stringify({detail:'image rejected'}),{status:400});
  });
  const result=await client.create({base_url:'http://localhost/api/v1'}, {prompt:'test',reference_urls:['data:image/png;base64,aQ==']});
  assert.match(result.error,/400 - image rejected/);
  assert.equal(calls.some(url=>url.endsWith('/jobs')),false);
});
