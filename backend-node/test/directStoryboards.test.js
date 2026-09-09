const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/services/dramaService');
const routes = require('../src/routes/drama');
const log = { info() {}, warn() {}, error() {} };

test('create directly from storyboards persists ordered prompts without a script; empty input remains editable', () => {
  const db = new Database(':memory:');
  try {
    require('../src/db/migrate').runMigrationsAndEnsure(db);
    const original = service.createDrama(db, log, { title: '普通项目' });
    assert.equal(service.getDrama(db, original.id).episodes.length, 0);
    const drama = service.createFromStoryboards(db, log, {
      title: '已有分镜', initial_storyboards: '雨夜推门。\r\n对白：我回来了。\r\n \r\n父亲抬头。',
      style: 'anime', metadata: { generation_language: 'en', aspect_ratio: '9:16' },
    });
    const loaded = service.getDrama(db, drama.id);
    assert.equal(loaded.style, 'anime');
    assert.equal(loaded.metadata.aspect_ratio, '9:16');
    assert.equal(loaded.episodes[0].script_content, '');
    const shots = loaded.episodes[0].storyboards;
    assert.deepEqual(shots.map(s => s.storyboard_number), [1, 2]);
    assert.deepEqual(shots.map(s => s.description), ['雨夜推门。\n对白：我回来了。', '父亲抬头。']);
    for (const shot of shots) {
      assert.equal(shot.image_prompt, shot.description);
      assert.equal(shot.video_prompt, shot.description);
      assert.equal(shot.duration, 5);
    }
    const empty = service.createFromStoryboards(db, log, { title: '空白分镜项目', initial_storyboards: ' \n ' });
    const ep = service.getDrama(db, empty.id).episodes[0];
    assert.equal(ep.storyboards.length, 0);
    const added = require('../src/services/storyboardService').createStoryboard(db, log, { episode_id: ep.id, storyboard_number: 1, description: '手动添加' });
    assert.equal(added.description, '手动添加');
    const count = db.prepare('SELECT count(*) n FROM dramas').get().n;
    for (const input of [null, [], 'a'.repeat(100001), Array(201).fill('镜头').join('\n\n')]) {
      let status;
      const res = { status(code) { status = code; return this; }, json() {} };
      routes(db, {}, log).createDrama({ body: { title: '无效', initial_storyboards: input } }, res);
      assert.equal(status, 400);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM dramas').get().n, count);
    db.exec("CREATE TRIGGER fail_shot BEFORE INSERT ON storyboards BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    assert.throws(() => service.createFromStoryboards(db, log, { title: '回滚', initial_storyboards: '镜头' }), /test rollback/);
    assert.equal(db.prepare('SELECT count(*) n FROM dramas').get().n, count);
  } finally { db.close(); }
});

