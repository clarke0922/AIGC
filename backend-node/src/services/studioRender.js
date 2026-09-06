const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { fail } = require('./studioStore');
function local(root, file) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file)) fail('素材必须是项目内的相对路径');
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) fail('素材路径超出存储目录');
  if (!fs.existsSync(absolute)) fail('素材文件不存在：' + file);
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) fail('素材路径超出存储目录');
  return real;
}
function run(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('媒体处理超时')); }, 180000);
    child.stdout.on('data', d => { stdout = (stdout + d).slice(-1000000); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-3000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error('媒体工具启动失败：' + e.message)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error('媒体处理失败：' + stderr)); });
  });
}
async function probe(file) {
  const info = JSON.parse(await run(getFfprobePath(), ['-v','error','-show_format','-show_streams','-of','json',file]));
  return { seconds: Number(info.format.duration), audio: info.streams.some(s => s.codec_type === 'audio'), video: info.streams.some(s => s.codec_type === 'video'), streams: info.streams };
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}
async function render(root, document, taskId) {
  const shots = document.shots.filter(s => s.enabled !== false);
  if (!shots.length || shots.some(s => !s.video || s.stale)) fail('请为启用的镜头生成视频，并处理待更新提示后再导出');
  const relative = `studio/exports/${taskId}`;
  const dir = path.join(root, relative);
  fs.mkdirSync(dir, { recursive: true });
  let cursor = 0;
  const subtitles = [], clips = [];
  for (const [i, s] of shots.entries()) {
    const video = local(root, s.video), info = await probe(video);
    const start = s.trim_in || 0, end = s.trim_out ?? s.duration, seconds = end - start;
    if (!info.video || !info.audio) fail(`第${i+1}镜缺少视频或声音，不能冒充完整对白成片`);
    if (end > info.seconds + 0.15) fail(`第${i+1}镜实际时长不足，请调整出点`);
    const file = `clip-${i}.mp4`;
    await run(getFfmpegPath(), ['-y','-ss',String(start),'-i',video,'-t',String(seconds),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24','-af',`volume=${s.volume ?? 1},aresample=48000`,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',file], dir);
    clips.push(`file '${file}'`);
    if (s.dialogue.trim()) subtitles.push(`${subtitles.length+1}\n${timestamp(cursor)} --> ${timestamp(cursor+seconds)}\n${s.dialogue.replace(/[\r\n]+/g,' ')}\n`);
    cursor += seconds;
  }
  fs.writeFileSync(path.join(dir,'clips.txt'), clips.join('\n'));
  fs.writeFileSync(path.join(dir,'dialogue.srt'), '\uFEFF' + subtitles.join('\n'), 'utf8');
  const args = ['-y','-f','concat','-safe','0','-i','clips.txt'];
  if (subtitles.length) args.push('-vf', "subtitles=dialogue.srt:force_style='FontName=Microsoft YaHei,FontSize=20,Outline=1,MarginV=24'",'-c:v','libx264','-crf','18','-preset','fast');
  else args.push('-c:v','copy');
  args.push('-c:a','copy','-movflags','+faststart','film.mp4');
  await run(getFfmpegPath(), args, dir);
  const verified = await probe(path.join(dir,'film.mp4'));
  if (!verified.audio || !verified.video || Math.abs(verified.seconds - cursor) > 0.5) fail('成片轨道或时长校验未通过');
  return { video: `${relative}/film.mp4`, subtitles: `${relative}/dialogue.srt`, duration: verified.seconds, subtitle_timing: '按镜头时间段显示，可通过剪辑入出点调整；非逐字强制对齐' };
}
module.exports = { local, run, probe, render };
