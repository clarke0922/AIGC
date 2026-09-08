// Query the fixed Ark origin; never forward credentials to a user-provided URL or redirect.
// Reference IDs only, not account entitlements. Checked 2026-09-08:
// https://github.com/volcengine/ark-cli/blob/main/dsh-plugins/ark-plan-api/cordis.patch.yml
// https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-profile/references/arkcli-profile-set-default.md
// Plan discovery uses control-plane ListAgentPlanLatestModel / ListArkCodeLatestModel,
// not GET {inferenceBase}/models. Never send inference keys to that unsupported route.
const PLAN_MODELS = {
  coding: ['doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo', 'doubao-seed-evolving', 'doubao-seed-2.0-lite', 'glm-5.3', 'deepseek-v4-pro', 'minimax-m3', 'deepseek-v4-flash'],
  agent: ['doubao-seed-evolving', 'doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo', 'doubao-seed-2.0-lite', 'doubao-seed-2.0-mini', 'glm-5.3', 'kimi-k3', 'deepseek-v4-pro', 'minimax-m3', 'deepseek-v4-flash', 'doubao-seedream-5.0-lite', 'doubao-seedance-2.0'],
};
async function listModels(apiKey, fetcher = fetch, plan = 'standard') {
  if (plan !== 'standard' && !Object.hasOwn(PLAN_MODELS, plan)) throw new Error('不支持的方舟套餐类型');
  if (plan !== 'standard') return [...PLAN_MODELS[plan]].sort();
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('请先填写火山 API Key');
  const res = await fetcher('https://ark.cn-beijing.volces.com/api/v3/models', {
    headers: { Authorization: 'Bearer ' + apiKey.trim() },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`模型列表查询失败（HTTP ${res.status}），请确认所选套餐与 API Key 匹配并检查权限。套餐目录可能不开放，可手动填写该套餐控制台的调用 ID`);
  const body = await res.json();
  if (!Array.isArray(body.data)) throw new Error('供应商未返回可识别的模型列表，请手动填写调用 ID');
  const ids = [...new Set(body.data.map(m => m?.id).filter(id => typeof id === 'string' && id.trim()))];
  if (!ids.length) throw new Error('供应商返回空模型列表，请检查权限或手动填写调用 ID');
  return ids.sort();
}
module.exports = { listModels };
