const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { runMergedEpisodePostProcess } = require('../src/services/mergedEpisodePostProcess');

test('merged subtitles retain original sound, all dialogue and the last cue', { skip: !process.env.STUDIO_MEDIA_TEST }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-subtitles-'));
  const source = path.join(root, 'source.mp4');
  const log = { info() {}, warn() {} };
  const rows = [
    { dialogue: '第一句对白。', narration: null },
    { dialogue: '最后一句对白也必须完整显示。', narration: null },
  ];
  const db = { prepare: () => ({ get: id => rows[id - 1] }) };
  try {
    const generated = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    assert.equal(generated.status, 0);
    const result = await runMergedEpisodePostProcess(db, log, {
      mergedAbsPath: source, storageRoot: root, episodeId: 1,
      scenes: [{ scene_id: 1, duration: 1 }, { scene_id: 2, duration: 1 }],
      mergeOpts: { burn_narration_subtitles: true, burn_dialogue_audio: true },
    });
    assert.equal(result.ok, true, result.error);
    const out = path.join(root, result.relativePath);
    const audio = spawnSync(getFfmpegPath(), ['-v', 'error', '-i', out, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', '-']);
    assert.equal(audio.status, 0);
    let power = 0;
    for (let i = 0; i < audio.stdout.length; i += 2) power += audio.stdout.readInt16LE(i) ** 2;
    assert.ok(Math.sqrt(power / (audio.stdout.length / 2)) > 100, 'original audible track must not become silence');
    const srt = fs.readFileSync(path.join(root, 'source_narration.srt'), 'utf8');
    for (const row of rows) assert.ok(srt.replace(/\r?\n/g, '').includes(row.dialogue));
    assert.ok(srt.split('\n').filter(line => /[\u4e00-\u9fff]/u.test(line)).every(line => [...line].length <= 12));
    assert.ok(srt.includes('00:00:01,000 --> 00:00:02,000'));
    const frame = spawnSync(getFfmpegPath(), ['-v', 'error', '-ss', '1.5', '-i', out, '-frames:v', '1', '-vf', 'crop=iw:ih/2:0:ih/2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    assert.equal(frame.status, 0);
    assert.ok(frame.stdout.some(value => value > 150), 'last subtitle is actually burned into the frame');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('merge uses measured durations and reports requested post-process failures', { skip: !process.env.STUDIO_MEDIA_TEST }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-timing-'));
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const config = require('../src/config');
  const originalConfig = config.loadConfig;
  const service = require('../src/services/videoMergeService');
  const log = { info() {}, warn() {} };
  try {
    const savedLog = console.log;
    try { console.log = () => {}; require('../src/db/migrate').runMigrationsAndEnsure(db); } finally { console.log = savedLog; }
    config.loadConfig = () => ({ storage: { local_path: root } });
    const source = path.join(root, 'source.mp4');
    assert.equal(spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]).status, 0);
    db.prepare("INSERT INTO dramas (id,title) VALUES (1,'test')").run();
    db.prepare('INSERT INTO episodes (id,drama_id,episode_number) VALUES (1,1,1)').run();
    db.prepare("INSERT INTO storyboards (id,episode_id,storyboard_number,dialogue,audio_local_path) VALUES (1,1,1,'对白','missing.mp3')").run();
    const request = { episode_id: 1, drama_id: 1, scenes: [{ scene_id: 1, video_url: source, duration: 5 }, { scene_id: 1, video_url: source, duration: 5 }], merge_options: { burn_narration_subtitles: true, burn_dialogue_audio: true } };
    const failed = service.create(db, log, request);
    await service.processVideoMerge(db, log, failed.merge_id, '');
    assert.equal(service.getById(db, failed.merge_id).status, 'failed');
    assert.match(service.getById(db, failed.merge_id).error_msg, /配音文件不存在/);
    db.prepare('UPDATE storyboards SET audio_local_path=NULL').run();
    const completed = service.create(db, log, request);
    await service.processVideoMerge(db, log, completed.merge_id, '');
    const result = service.getById(db, completed.merge_id);
    assert.equal(result.status, 'completed', result.error_msg);
    assert.equal(result.duration, 2, 'use two actual one-second clips instead of two planned five-second shots');
    const srt = fs.readFileSync(path.join(root, result.merged_url.replace('_post.mp4', '_narration.srt')), 'utf8');
    assert.ok(!srt.includes('00:00:05,'));
    // Adding an external track must keep the original 440 Hz source audible too.
    assert.equal(spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', path.join(root, 'voice.mp3')]).status, 0);
    db.prepare("UPDATE storyboards SET audio_local_path='voice.mp3'").run();
    const mixed = service.create(db, log, request);
    await service.processVideoMerge(db, log, mixed.merge_id, '');
    const mixedResult = service.getById(db, mixed.merge_id);
    assert.equal(mixedResult.status, 'completed', mixedResult.error_msg);
    const sound = spawnSync(getFfmpegPath(), ['-i', path.join(root, mixedResult.merged_url), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.ok(Number(sound.stderr.match(/mean_volume: ([\d.-]+)/)?.[1]) > -40);
  } finally {
    config.loadConfig = originalConfig;
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
