// Query the fixed Ark origin; never forward credentials to a user-provided URL or redirect.
async function listModels(apiKey, fetcher = fetch) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('请先填写火山 API Key');
  const res = await fetcher('https://ark.cn-beijing.volces.com/api/v3/models', {
    headers: { Authorization: 'Bearer ' + apiKey.trim() },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`模型列表查询失败（HTTP ${res.status}），请检查 Key 权限或手动填写控制台调用 ID`);
  const body = await res.json();
  if (!Array.isArray(body.data)) throw new Error('供应商未返回可识别的模型列表，请手动填写调用 ID');
  const ids = [...new Set(body.data.map(m => m?.id).filter(id => typeof id === 'string' && id.trim()))];
  if (!ids.length) throw new Error('供应商返回空模型列表，请检查权限或手动填写调用 ID');
  return ids.sort();
}
module.exports = { listModels };
