export function modelCandidates(ids, kind) {
  if (kind === 'image' || kind === 'storyboard_image') return ids.filter(id => /seedream/i.test(id))
  if (kind === 'video') return ids.filter(id => /seedance/i.test(id))
  return ids.filter(id => /deepseek|doubao.*(?:seed|pro|lite)|kimi|glm/i.test(id) && !/seedream|seedance|embedding|vision|speech|tts|asr/i.test(id))
}
export function singleModel(ids, kind) {
  const candidates = modelCandidates(ids, kind)
  return candidates.length === 1 ? candidates[0] : ''
}
