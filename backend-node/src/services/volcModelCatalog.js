// Query the fixed Ark origin; never forward credentials to a user-provided URL or redirect.
const PLAN_PATHS = { standard: '/api/v3', coding: '/api/coding/v3', agent: '/api/plan/v3' };
async function listModels(apiKey, fetcher = fetch, plan = 'standard') {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('请先填写火山 API Key');
  if (!Object.hasOwn(PLAN_PATHS, plan)) throw new Error('不支持的方舟套餐类型');
  const res = await fetcher(`https://ark.cn-beijing.volces.com${PLAN_PATHS[plan]}/models`, {
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
