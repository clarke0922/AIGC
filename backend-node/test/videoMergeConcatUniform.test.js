const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../src/utils/ffmpegPath');
const { normalizeClips, extractFrameRateNum } = require('../src/services/videoMergeService');

const skipNoFfmpeg = { skip: !hasLocalFfmpeg() };

test('extractFrameRateNum parses r_frame_rate strings', () => {
  assert.equal(extractFrameRateNum('25/1'), 25);
  assert.equal(extractFrameRateNum('30000/1001'), 30000 / 1001);
  assert.equal(extractFrameRateNum(''), null);
  assert.equal(extractFrameRateNum('0/0'), null);
  assert.equal(extractFrameRateNum('bogus'), null);
});

function makeClip(file, size, fps, log) {
  const r = spawnSync(getFfmpegPath(), [
    '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size.width}x${size.height}:r=${fps}:d=1`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  assert.equal(r.status, 0, 'clip generation failed');
}

test('normalizeClips keeps an already-homogeneous set untouched', skipNoFfmpeg, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmerge-hom-'));
  const log = { info(){}, warn(){} };
  try {
    const a = path.join(root, 'a.mp4');
    const b = path.join(root, 'b.mp4');
    makeClip(a, { width: 360, height: 640 }, 24, log);
    makeClip(b, { width: 360, height: 640 }, 24, log);
    const res = normalizeClips([a, b], root, log);
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.paths, [a, b], 'identical params must not be re-encoded');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizeClips re-encodes mismatched clips to first clip parameters so concat copy is safe', skipNoFfmpeg, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmerge-mix-'));
  const log = { info(){}, warn(){} };
  try {
    const a = path.join(root, 'a.mp4');
    const b = path.join(root, 'b.mp4');
    makeClip(a, { width: 360, height: 640 }, 24, log);
    makeClip(b, { width: 720, height: 1280 }, 30, log);
    const res = normalizeClips([a, b], root, log);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.paths.length, 2);
    assert.equal(res.paths[0], a, 'first clip acts as target and stays untouched');
    assert.notEqual(res.paths[1], b, 'mismatched second clip must be re-encoded');

    // The converted clip must match the first clip's parameters.
    const probe = (file) => JSON.parse(spawnSync(
      require('../src/utils/ffmpegPath').getFfprobePath(),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt', '-of', 'json', file],
      { encoding: 'utf8' }
    ).stdout).streams[0];
    const fpsOf = (info) => { const [n, d] = info.r_frame_rate.split('/').map(Number); return d ? n / d : n; };
    const p0 = probe(a), p1 = probe(res.paths[1]);
    assert.equal(p1.width, p0.width);
    assert.equal(p1.height, p0.height);
    assert.equal(p1.pix_fmt, p0.pix_fmt);
    assert.ok(Math.abs(fpsOf(p1) - fpsOf(p0)) < 0.01);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});