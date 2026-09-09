const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../src/utils/ffmpegPath');
const { normalizeClips, extractFrameRateNum, runFfmpegConcat } = require('../src/services/videoMergeService');

const skipNoFfmpeg = { skip: !hasLocalFfmpeg() };

test('mixed audio rates, time bases and missing audio merge with continuous timestamps and seekable video', skipNoFfmpeg, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmerge-timeline-'));
  const log = { info() {}, warn() {} };
  try {
    const inputs = ['red', 'green', 'blue'].map((color, i) => {
      const file = path.join(root, `${color}.mp4`);
      const audio = i === 2 ? [] : ['-f', 'lavfi', '-i', `sine=frequency=${440 * (i + 1)}:sample_rate=${i ? 32000 : 44100}:duration=1`];
      const r = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x240:r=24:d=1`, ...audio,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-video_track_timescale', i ? '90000' : '12288', '-c:a', 'aac', file]);
      assert.equal(r.status, 0, String(r.stderr));
      return file;
    });
    const norm = normalizeClips(inputs, root, log);
    assert.equal(norm.ok, true, norm.error);
    const out = path.join(root, 'merged.mp4');
    assert.equal(runFfmpegConcat(norm.paths, out, log), true);
    const probe = JSON.parse(spawnSync(getFfprobePath(), ['-v', 'error', '-show_streams', '-show_packets', '-of', 'json', out], { encoding: 'utf8' }).stdout);
    const video = probe.streams.find(s => s.codec_type === 'video');
    const audio = probe.streams.find(s => s.codec_type === 'audio');
    assert.equal(audio.sample_rate, '44100');
    assert.equal(audio.channels, 2);
    assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.1);
    assert.ok(Number(video.duration) >= 3 && Number(video.duration) < 3.2);
    for (const stream of probe.streams) {
      const packets = probe.packets.filter(p => p.stream_index === stream.index);
      for (let i = 1; i < packets.length; i++) {
        const delta = Number(packets[i].dts_time) - Number(packets[i - 1].dts_time);
        assert.ok(delta > 0 && delta < 0.1, `stream ${stream.index} discontinuity: ${delta}`);
      }
    }
    const decoded = spawnSync(getFfmpegPath(), ['-v', 'error', '-xerror', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.equal(decoded.stderr, '');
    for (let i = 0; i < 3; i++) {
      const frame = spawnSync(getFfmpegPath(), ['-v', 'error', '-ss', String(i + 0.5), '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
      assert.equal(frame.status, 0);
      assert.ok(frame.stdout[i] > frame.stdout[(i + 1) % 3] + 50, `seek must reach clip ${i + 1}`);
      const pcm = spawnSync(getFfmpegPath(), ['-v', 'error', '-ss', String(i + 0.3), '-i', out, '-t', '0.3', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
      assert.equal(pcm.status, 0);
      let power = 0;
      for (let j = 0; j < pcm.stdout.length; j += 2) power += pcm.stdout.readInt16LE(j) ** 2;
      const rms = Math.sqrt(power / (pcm.stdout.length / 2));
      assert.ok(i === 2 ? rms < 10 : rms > 100, `clip ${i + 1} audio must be retained or padded with silence`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test('normalizeClips also normalizes the first clip and apparently homogeneous clips', skipNoFfmpeg, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmerge-hom-'));
  const log = { info(){}, warn(){} };
  try {
    const a = path.join(root, 'a.mp4');
    const b = path.join(root, 'b.mp4');
    makeClip(a, { width: 360, height: 640 }, 24, log);
    makeClip(b, { width: 360, height: 640 }, 24, log);
    const res = normalizeClips([a, b], root, log);
    assert.equal(res.ok, true, res.error);
    assert.ok(res.paths.every((p, i) => p !== [a, b][i]), 'surface parameters cannot establish stream-copy compatibility');
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
    assert.notEqual(res.paths[0], a, 'first clip must use the same encoder and audio settings');
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
