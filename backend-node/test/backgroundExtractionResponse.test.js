const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const ai = require('../src/services/aiClient');
const tasks = require('../src/services/taskService');
const backgrounds = require('../src/services/backgroundExtractionService');

const log = { info() {}, warn() {}, error() {} };

test('scene extraction accepts model response using scene_key and scene_prompt', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  require('../src/db/migrate').runMigrationsAndEnsure(db);
  db.prepare("INSERT INTO dramas(id,title) VALUES (15,'湖边')").run();
  db.prepare("INSERT INTO episodes(id,drama_id,script_content) VALUES (13,15,'黄昏的湖面，小雅走向码头。')").run();
  const taskId = tasks.createTask(db, log, 'background_extraction', '13').id;

  const generateText = t.mock.method(ai, 'generateText', async (_db, _log, _type, _prompt, systemPrompt, options) => {
    assert.match(systemPrompt, /从剧本中提取所有唯一的场景背景/);
    assert.equal(options.max_tokens, 8192);
    return JSON.stringify([
      {
        scene_id: 1,
        scene_key: '湖面，黄昏',
        scene_prompt: '黄昏时分广袤平静的湖面，夕阳洒在水面上，空无一人。',
      },
      {
        scene_name: '码头',
        time_of_day: '傍晚',
        background_prompt: '废弃木码头延伸到湖面，无人物。',
      },
    ]);
  });

  await backgrounds.processBackgroundExtraction(db, { style: {} }, log, taskId, 13, undefined, '', 'zh');
  const task = tasks.getTask(db, taskId);
  assert.equal(task.status, 'completed', task.error);
  assert.equal(generateText.mock.callCount(), 1);

  const result = JSON.parse(task.result);
  assert.equal(result.count, 2);
  assert.deepEqual(result.scenes.map((scene) => [scene.location, scene.time, scene.prompt]), [
    ['湖面', '黄昏', '黄昏时分广袤平静的湖面，夕阳洒在水面上，空无一人。'],
    ['码头', '傍晚', '废弃木码头延伸到湖面，无人物。'],
  ]);
});

test('scene extraction fails instead of saving blank scenes when JSON is invalid', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  require('../src/db/migrate').runMigrationsAndEnsure(db);
  db.prepare("INSERT INTO dramas(id,title) VALUES (1,'测试')").run();
  db.prepare("INSERT INTO episodes(id,drama_id,script_content) VALUES (1,1,'雨夜码头。')").run();
  const taskId = tasks.createTask(db, log, 'background_extraction', '1').id;
  t.mock.method(ai, 'generateText', async () => '模型没有返回 JSON');

  await backgrounds.processBackgroundExtraction(db, { style: {} }, log, taskId, 1, undefined, '', 'zh');
  const task = tasks.getTask(db, taskId);
  assert.equal(task.status, 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scenes WHERE deleted_at IS NULL').get().n, 0);
});
