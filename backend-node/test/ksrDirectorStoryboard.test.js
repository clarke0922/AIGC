const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const promptI18n = require('../src/services/promptI18n');
const migrate = require('../src/db/migrate');
const storyboardService = require('../src/services/storyboardService');

const zhCfg = { app: { language: 'zh' } };
const enCfg = { app: { language: 'en' } };

test('zh storyboard system prompt carries the KSR director contract and rationale/transition fields', () => {
  const p = promptI18n.getStoryboardSystemPrompt(zhCfg);
  assert.match(p, /导演决策合同/);
  assert.match(p, /最高点只有一个/);
  assert.match(p, /听者优先/);
  assert.match(p, /禁止按时间均匀切镜/);
  assert.match(p, /不超过3个/);
  assert.match(p, /物理事实/);
  assert.match(p, /固定镜头是默认|固定为默认/);
  assert.match(p, /\brationale\b/);
  assert.match(p, /\btransition\b/);
  assert.doesNotMatch(p, /固定镜头不得超过20%/);
  assert.doesNotMatch(p, /强制动态优先/);
});

test('en storyboard system prompt carries the KSR director contract and rationale/transition fields', () => {
  const p = promptI18n.getStoryboardSystemPrompt(enCfg);
  assert.match(p, /DIRECTOR'S DECISION CONTRACT/);
  assert.match(p, /exactly ONE highest-tension peak/);
  assert.match(p, /LISTENER-FIRST/);
  assert.match(p, /NEVER cut on an even time interval/);
  assert.match(p, /at most 3 physical actions/);
  assert.match(p, /PHYSICAL FACTS/);
  assert.match(p, /Static\/fixed is the DEFAULT/);
  assert.match(p, /\brationale\b/);
  assert.match(p, /\btransition\b/);
  assert.doesNotMatch(p, /Static\/fixed shots shall not exceed 20%/);
});

test('storyboard user suffix lists rationale and transition in both languages', () => {
  const zh = promptI18n.getStoryboardUserPromptSuffix(zhCfg, 5);
  const en = promptI18n.getStoryboardUserPromptSuffix(enCfg, 5);
  assert.match(zh, /rationale/);
  assert.match(zh, /transition/);
  assert.match(en, /rationale/);
  assert.match(en, /transition/);
});

test('rationale and transition columns persist and round-trip through storyboard service', () => {
  const db = new Database(':memory:');
  try {
    migrate.runMigrationsAndEnsure(db);
    db.prepare("INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, '剧', 't', 't')").run();
    db.prepare("INSERT INTO episodes (id, drama_id, episode_number, created_at, updated_at) VALUES (1, 1, 1, 't', 't')").run();
    const log = { info() {}, warn() {}, error() {} };
    const created = storyboardService.createStoryboard(db, log, { episode_id: 1, storyboard_number: 1, description: '测试镜头' });
    const updated = storyboardService.updateStoryboard(db, log, created.id, {
      rationale: '质问落地时切近景，让观众读到挨骂者的反应',
      transition: 'cut',
    });
    assert.equal(updated.rationale, '质问落地时切近景，让观众读到挨骂者的反应');
    assert.equal(updated.transition, 'cut');
    const reloaded = storyboardService.getStoryboardById(db, created.id);
    assert.equal(reloaded.rationale, '质问落地时切近景，让观众读到挨骂者的反应');
    assert.equal(reloaded.transition, 'cut');
  } finally {
    db.close();
  }
});
