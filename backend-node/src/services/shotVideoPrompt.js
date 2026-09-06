const STORY_RULE = '片段描述是本镜剧情依据：不得改变人物、地点、动作、事件顺序或结局。视频提示词仅补充表演节奏、光线和质感；与片段描述、独立对白或运镜字段冲突的补充必须忽略，不得新增剧情或台词。';
function composeShotVideoPrompt(shot, context = '') {
  return `${STORY_RULE}\n片段描述：${shot.description}\n运镜：${shot.camera}\n中文对白（准确表演并同步口型）：${shot.dialogue || '无对白，不添加说话声'}\n角色与场景参考：${context}\n拍摄补充（仅在不违背上述事实时使用）：${shot.video_prompt || ''}\n真实人声与环境声，不生成字幕。`;
}
module.exports = { STORY_RULE, composeShotVideoPrompt };
