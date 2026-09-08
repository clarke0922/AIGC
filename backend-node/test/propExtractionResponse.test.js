const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');
const ai = require('../src/services/aiClient');
const configs = require('../src/services/aiConfigService');
const props = require('../src/services/propExtractionService');
const tasks = require('../src/services/taskService');
const log = {info(){},warn(){},error(){}};
const event = choice => 'data: ' + JSON.stringify({choices:[choice]}) + '\n\n';
async function provider(t, respond) {
  const server = http.createServer(async (req,res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.writeHead(200, {'Content-Type':'text/event-stream',Connection:'close'});
    respond(JSON.parse(raw),res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.mock.method(configs,'listConfigs',()=>[{
    id:1,provider:'openai',base_url:`http://127.0.0.1:${server.address().port}`,model:['test-reasoning'],is_active:true,is_default:true,settings:{max_tokens:2000},
  }]);
}
test('both text callers distinguish reasoning budget exhaustion from empty output', async t => {
  let reason = 'length';
  await provider(t, (_body,res) => res.end(event({delta:{reasoning_content:'private reasoning'}})+event({delta:{},finish_reason:reason}).trimEnd()));
  for (const call of [ai.generateText,ai.streamGenerateText]) {
    await assert.rejects(call({},log,'text','script','system',{max_tokens:2000}), /输出额度耗尽.*2000/);
  }
  reason='stop';
  await assert.rejects(ai.generateText({},log,'text','script','system'), /仅返回推理过程/);
  reason='content_filter';
  await assert.rejects(ai.generateText({},log,'text','script','system'), /内容审核拦截/);
});
test('stream parser preserves split Chinese UTF-8 and final content without a newline', async t => {
  await provider(t, (_body,res) => {
    const text=Buffer.from(event({delta:{content:'道具'}}).trimEnd());
    const split=text.indexOf(Buffer.from('道'))+1;
    res.write(text.subarray(0,split));
    setImmediate(()=>res.end(text.subarray(split)));
  });
  assert.equal(await ai.generateText({},log,'text','script','system'),'道具');
});
test('prop extraction has enough reasoning budget and never deletes props for a non-array response', async t => {
  const db = new Database(':memory:');
  t.after(()=>db.close());
  require('../src/db/migrate').runMigrationsAndEnsure(db);
  db.exec("INSERT INTO dramas(id,title) VALUES(1,'test'); INSERT INTO episodes(id,drama_id,script_content) VALUES(1,1,'林晓握着一封旧信。');");
  let valid = true;
  await provider(t, (body,res) => {
    assert.equal(body.max_tokens,8192); // old 2000 budget would return reasoning only
    res.end(event({delta:{reasoning_content:'not the final JSON'}})+event({delta:{content:valid ? '[{"name":"旧信","type":"信件","image_prompt":"泛黄的信封"}]' : '{"message":"no final answer"}'},finish_reason:'stop'}));
  });
  const run = async () => {
    const task = tasks.createTask(db,log,'prop_extraction','1');
    await props.processPropExtraction(db,log,task.id,1);
    return tasks.getTask(db,task.id);
  };
  const first = await run();
  assert.equal(first.status,'completed',first.error);
  assert.equal(JSON.parse(first.result).props[0].name,'旧信');
  valid=false;
  const second=await run();
  assert.equal(second.status,'failed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM props WHERE deleted_at IS NULL').get().n,1);
});
