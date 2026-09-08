const { randomUUID } = require('crypto');
const { postJSONWithTimeout } = require('./aiClient');

const DEFAULT_VOICE = 'zh_female_vv_uranus_bigtts';
const DEFAULT_MODEL = 'seed-tts-2.0';
const TTS_PATH = '/api/v3/tts/unidirectional/sse';

// Protocol reference: bytedance/agentkit-samples, byted-text-to-speech/scripts/text_to_speech.py
async function synthesizeAudio(config, { text, voice_id, speed = 1 } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('豆包 TTS text 不能为空');
  if (!config.api_key?.trim()) throw new Error('请填写豆包语音控制台的 API Key');
  let settings = config.settings || {};
  if (typeof settings === 'string') settings = JSON.parse(settings);
  const model = config.default_model || (Array.isArray(config.model) ? config.model[0] : config.model) || DEFAULT_MODEL;
  const base = (config.base_url || 'https://openspeech.bytedance.com').replace(/\/+$/, '');
  const url = /\/tts\/unidirectional(?:\/sse)?$/.test(base) ? base : base + TTS_PATH;
  const ratio = Number(speed);
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 2) throw new Error('豆包 TTS 语速范围为 0.5～2 倍');
  const response = await postJSONWithTimeout(url, {
    'X-Api-Key': config.api_key.trim(),
    'X-Api-Resource-Id': model,
    'X-Api-Request-Id': randomUUID(),
  }, {
    user: { uid: 'local-mini-drama' },
    req_params: {
      text: text.trim(),
      speaker: voice_id || config.voice_id || settings.voice_id || DEFAULT_VOICE,
      sample_rate: 24000,
      audio_params: { format: 'mp3', speech_rate: Math.round((ratio - 1) * 100), bit_rate: 64000 },
    },
  }, 120000);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`豆包 TTS HTTP ${response.statusCode}，请检查语音服务 Key、服务开通状态和接口地址`);
  }
  const audio = [];
  for (const line of response.raw.split(/\r?\n/)) {
    const value = line.trim();
    // Also accept the official HTTP Chunked variant's newline-delimited JSON.
    if (!value.startsWith('data:') && !value.startsWith('{')) continue;
    const payload = value.startsWith('data:') ? value.slice(5).trim() : value;
    if (payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch (_) { throw new Error('豆包 TTS 返回无效音频响应'); }
    if (event.code != null && event.code !== 0 && event.code !== 20000000) {
      throw new Error(`豆包 TTS 错误 ${event.code}：${event.message || '合成失败'}`);
    }
    if (event.data) {
      if (typeof event.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.data)) {
        throw new Error('豆包 TTS 返回无效音频编码');
      }
      audio.push(Buffer.from(event.data, 'base64'));
    }
  }
  const buffer = Buffer.concat(audio);
  if (!buffer.length) throw new Error('豆包 TTS 未返回音频，请检查音色 ID 与语音模型是否匹配');
  return buffer;
}

module.exports = { synthesizeAudio };
