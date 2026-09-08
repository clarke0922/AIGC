export function modelCandidates(ids, kind) {
  if (kind === 'image' || kind === 'storyboard_image') return ids.filter(id => /seedream/i.test(id))
  if (kind === 'video') return ids.filter(id => /seedance/i.test(id))
  return ids.filter(id => /ark-code|minimax|deepseek|doubao.*(?:seed|pro|lite)|kimi|glm/i.test(id) && !/seedream|seedance|embedding|vision|speech|tts|asr/i.test(id))
}
export function singleModel(ids, kind) {
  const candidates = modelCandidates(ids, kind)
  return candidates.length === 1 ? candidates[0] : ''
}

export const volcPlans = {
  standard: { label: '普通方舟（按量计费）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  coding: { label: 'Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
  agent: { label: 'Agent Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3' },
}
export function volcPlanConfigs(configs, plan) {
  return configs.filter(c => plan !== 'coding' || c.service_type === 'text').map(c => ({
    ...c, base_url: volcPlans[plan].baseUrl,
    name: `火山引擎 ${volcPlans[plan].label} ${{text:'文本/对话',image:'文本生图',storyboard_image:'分镜图',video:'视频'}[c.service_type]}`,
  }))
}
