const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const prompts = require('../src/services/promptI18n');
const ai = require('../src/services/aiClient');
const library = require('../src/services/characterLibraryService');
const service = require('../src/services/characterGenerationService');
const tasks = require('../src/services/taskService');
const log = {info(){},warn(){},error(){}};

test('life-stage extraction requirements survive Chinese overrides and English mode', () => {
  try {
    for (const language of ['zh','en']) {
      prompts.setOverrideInMemory('character_extraction', '用户自定义角色规则');
      const prompt = prompts.getCharacterExtractionPrompt({app:{language}});
      assert.match(prompt, /life_stage/);
      assert.match(prompt, language === 'zh' ? /三个对象/ : /THREE objects/);
      assert.match(prompt, language === 'zh' ? /不得因为对白提及/ : /Do not create stages merely mentioned/);
    }
    assert.match(prompts.getLockedSuffix('character_extraction'), /life_stage/);
    assert.match(prompts.formatUserPrompt({}, 'character_constraint'), /对应阶段的角色ID/);
  } finally { prompts.clearOverrideInMemory('character_extraction'); }
});

test('extraction persists three stage assets, preserves appearances and reuses only matching stages across episodes', async (t) => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../migrations/01_init.sql'),'utf8'));
  db.prepare('INSERT INTO dramas (id,title) VALUES (1,?)').run('成长');
  db.exec('INSERT INTO episodes (id,drama_id) VALUES (1,1),(2,1)');
  const stages = ['初中','高中','大学'];
  t.mock.method(ai, 'generateText', async (_db,_log,_type,user,system,opts) => {
    if (opts.scene_key !== 'role_extraction') return '{}';
    assert.match(system, /life_stage/);
    assert.match(user, /初中.*高中.*大学/);
    return JSON.stringify([
      ...stages.map((life_stage,i) => ({name:i===1 ? '林晓(高中)' : '林晓',life_stage,appearance:`${life_stage}形象`,description:`${life_stage}经历`})),
      {name:'林晓（初中）',life_stage:'初中'}, // repeated scene must not duplicate the asset
      {name:'陈老师',life_stage:''}, // no invented stages for other characters
    ]);
  });
  t.mock.method(library, 'generateCharacterPromptOnly', async () => {});
  async function extract(episode_id) {
    const id = service.generateCharacters(db, {}, log, {drama_id:1,episode_id,outline:'林晓初中入学，高中参加比赛，大学毕业；陈老师送别。'});
    for (let i=0;i<100;i++) {
      await new Promise(setImmediate);
      const task = tasks.getTask(db,id);
      if (task.status === 'completed') return JSON.parse(task.result);
      assert.notEqual(task.status,'failed',task.message);
    }
    assert.fail('extraction did not complete');
  }
  try {
    const first = await extract(1);
    assert.equal(first.count,4);
    assert.deepEqual(first.characters.map(c=>c.name),['林晓（初中）','林晓（高中）','林晓（大学）','陈老师']);
    assert.equal(new Set(first.characters.map(c=>c.id)).size,4);
    assert.deepEqual(first.characters.slice(0,3).map(c=>c.appearance),stages.map(s=>`${s}形象`));
    const second = await extract(2);
    assert.deepEqual(second.characters.map(c=>c.id),first.characters.map(c=>c.id));
    await extract(1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM characters WHERE deleted_at IS NULL').get().n,4);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM episode_characters').get().n,8);
    await new Promise(setImmediate);
  } finally { db.close(); }
});
