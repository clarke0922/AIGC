const fs = require('fs');
const path = require('path');

function isConfig(config) {
  if (config.api_protocol === 'walkingwithai') return true;
  return (config.api_protocol === 'minimax_h3' || config.provider === 'minimax_h3')
    && /^\/?jobs\/?$/.test(String(config.endpoint || '').trim());
}
function baseUrl(config) { return String(config.base_url || '').trim().replace(/\/+$/, ''); }
function headers(config) { return config.api_key ? { Authorization: 'Bearer ' + config.api_key } : {}; }
async function request(config, endpoint, options = {}) {
  const res = await fetch(baseUrl(config) + endpoint, {
    ...options, headers: { ...headers(config), ...options.headers }, signal: AbortSignal.timeout(120000),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) { throw new Error(`自建视频服务返回非 JSON（HTTP ${res.status}），请检查 Base URL 是否以 /api/v1 结尾`); }
  if (!res.ok) {
    const detail = data.error?.message || data.detail || data.error || data.message || raw.slice(0, 300);
    throw new Error(`自建视频请求失败: ${res.status} - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data;
}
async function testConnection(config) {
  const data = await request(config, '/capabilities');
  if (!data.features?.some(f => f.id === 'minimax-h3')) throw new Error('该自建服务未提供 minimax-h3 功能');
}
async function uploadImage(config, raw, opts) {
  let blob;
  if (/^(https?:|data:image\/)/i.test(raw)) {
    const res = await fetch(raw, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`读取参考图失败: ${res.status}`);
    blob = await res.blob();
  } else {
    const root = path.resolve(opts.storage_local_path || './data/storage');
    const rel = String(raw).replace(/^.*\/static\//, '').replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('参考图路径超出素材目录');
    const type = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()] || 'application/octet-stream';
    blob = new Blob([await fs.promises.readFile(file)], {type});
  }
  const form = new FormData();
  form.append('file', blob, 'reference.' + (blob.type.split('/')[1] || 'png'));
  const data = await request(config, '/assets?asset_type=image', {method:'POST', body:form});
  if (!data.asset_id) throw new Error('参考图上传未返回 asset_id');
  return data.asset_id;
}
function dimensions(opts) {
  const [w,h] = String(opts.aspect_ratio || '16:9').split(':').map(Number);
  if (!(w > 0 && h > 0)) throw new Error('视频画幅比例无效');
  const short = /1080|2k/i.test(opts.resolution || '') ? 1088 : /480/i.test(opts.resolution || '') ? 480 : 768;
  const width = Math.round((w >= h ? short*w/h : short)/32)*32;
  const height = Math.round((h >= w ? short*h/w : short)/32)*32;
  if (width > 2160 || height > 2160 || width < 256 || height < 256) throw new Error('当前画幅与分辨率超出自建视频服务的尺寸范围');
  return {width,height};
}
async function create(config, opts) {
  try {
    const refs = [...new Set((opts.reference_urls || []).filter(Boolean))];
    const first = opts.first_frame_url || opts.image_url;
    const last = opts.last_frame_url;
    if (refs.length > 9) throw new Error('自建视频服务最多支持 9 张参考图');
    const inputs = {prompt:opts.prompt || ''};
    const parameters = {...dimensions(opts), duration:Math.max(2,Math.min(15,Number(opts.duration) || 5))};
    if (Number.isSafeInteger(opts.seed)) parameters.seed = opts.seed;
    const mode = refs.length ? 'r2v' : first || last ? 'i2v' : 't2v';
    const uploaded = new Map();
    const upload = async raw => {
      if (!uploaded.has(raw)) uploaded.set(raw, await uploadImage(config, raw, opts));
      return uploaded.get(raw);
    };
    if (mode === 'r2v') {
      inputs.reference_images = [];
      for (const ref of refs) inputs.reference_images.push(await upload(ref));
    } else if (mode === 'i2v') {
      if (first) inputs.first_frame = await upload(first);
      if (last) inputs.last_frame = await upload(last);
    }
    const data = await request(config, '/jobs', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({feature:'minimax-h3',mode,inputs,parameters})});
    if (!data.job_id) throw new Error('自建视频服务未返回 job_id');
    return {task_id:String(data.job_id),status:'processing'};
  } catch (e) { return {error:e.message}; }
}
async function poll(config, jobId, maxAttempts, intervalMs) {
  const endpoint = '/jobs/' + encodeURIComponent(jobId);
  for (let attempt=0; attempt<maxAttempts; attempt++) {
    if (attempt) await new Promise(resolve=>setTimeout(resolve,intervalMs));
    try {
      const data = await request(config, endpoint);
      if (['failed','cancelled'].includes(data.status)) return {error:data.error?.message || data.error || `自建视频任务${data.status === 'cancelled' ? '已取消' : '失败'}`};
      if (data.status === 'completed') {
        const result = await request(config, endpoint+'/outputs');
        const video = result.outputs?.find(o => o.url && (o.media_type?.startsWith('video/') || /\.mp4(?:[?]|$)/i.test(o.url)));
        if (!video) return {error:'自建视频任务完成但未返回视频文件'};
        return {video_url:new URL(video.url, baseUrl(config)+'/').href};
      }
    } catch (e) { return {error:e.message}; }
  }
  return {error:'自建视频任务等待超时，可继续查询原任务'};
}
module.exports = {isConfig,testConnection,create,poll};
