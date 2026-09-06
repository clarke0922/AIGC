const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { rebuildVideoPromptForStoryboard } = require('../src/services/episodeStoryboardService');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, style TEXT, metadata TEXT, deleted_at TEXT);
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      title TEXT,
      episode_number INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      storyboard_number INTEGER,
      title TEXT,
      description TEXT,
      location TEXT,
      time TEXT,
      duration REAL DEFAULT 5,
      dialogue TEXT,
      narration TEXT,
      action TEXT,
      result TEXT,
      atmosphere TEXT,
      emotion TEXT,
      emotion_intensity TEXT,
      image_prompt TEXT,
      polished_prompt TEXT,
      video_prompt TEXT,
      shot_type TEXT,
      angle TEXT,
      angle_h TEXT,
      angle_v TEXT,
      angle_s TEXT,
      movement TEXT,
      bgm_prompt TEXT,
      sound_effect TEXT,
      scene_description TEXT,
      characters TEXT,
      segment_index INTEGER DEFAULT 0,
      segment_title TEXT,
      creation_mode TEXT,
      universal_segment_text TEXT,
      layout_description TEXT,
      first_frame_image_id INTEGER,
      last_frame_image_id INTEGER,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE storyboard_characters (storyboard_id INTEGER, character_id INTEGER, created_at TEXT);
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER, created_at TEXT);
  `);
  return db;
}

test('rebuildVideoPromptForStoryboard updates universal video_prompt from segment text', () => {
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, title, deleted_at) VALUES (1, \'D\', NULL)').run();
  db.prepare('INSERT INTO episodes (id, drama_id, episode_number, deleted_at) VALUES (1, 1, 1, NULL)').run();
  db.prepare(
    'INSERT INTO storyboards (id, episode_id, storyboard_number, duration, creation_mode, universal_segment_text, characters, deleted_at) VALUES (1, 1, 1, 5, \'universal\', \'父亲沉默地看着女儿。\', NULL, NULL)'
  ).run();

  const result = rebuildVideoPromptForStoryboard(db, log, 1);
  assert.ok(result);
  assert.equal(result.id, 1);
  assert.equal(db.prepare('SELECT video_prompt FROM storyboards WHERE id = 1').get().video_prompt, '父亲沉默地看着女儿。');
});

test('rebuildVideoPromptForStoryboard returns null for missing storyboard', () => {
  const db = createDb();
  assert.equal(rebuildVideoPromptForStoryboard(db, log, 999), null);
});

test('rebuildVideoPromptForStoryboard handles invalid id', () => {
  const db = createDb();
  assert.equal(rebuildVideoPromptForStoryboard(db, log, 0), null);
});