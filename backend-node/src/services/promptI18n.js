// 内存覆盖缓存：key => body（仅存可编辑部分，不含锁定的 JSON 格式要求）
const _overrideCache = {};

function loadOverridesIntoCache(overrides) {
  for (const o of overrides) {
    _overrideCache[o.key] = o.content;
  }
}

function setOverrideInMemory(key, content) {
  _overrideCache[key] = content;
}

function clearOverrideInMemory(key) {
  delete _overrideCache[key];
}

// 与 Go application/services/prompt_i18n.go 对齐：提示词与语言
function getLanguage(cfg) {
  return (cfg?.app?.language || 'zh').toLowerCase();
}

function isEnglish(cfg) {
  return getLanguage(cfg) === 'en';
}

/** 画风由前端写入 dramas.metadata.style_prompt_zh / style_prompt_en，mergeCfgStyleWithDrama 注入 cfg.style */

function styleTextForCfgLang(cfg) {
  const z = (cfg?.style?.default_style_zh || '').trim();
  const e = (cfg?.style?.default_style_en || '').trim();
  const d = (cfg?.style?.default_style || '').trim();
  if (isEnglish(cfg)) return e || d;
  return z || d;
}

function styleTextZhForPolish(cfg) {
  return (cfg?.style?.default_style_zh || cfg?.style?.default_style || '').trim();
}

function styleTextEnForImage(cfg) {
  return (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
}

function getCharacterStageRule(cfg) {
  return isEnglish(cfg)
    ? `
[Life-stage character assets — required]
Extract one object per person per life stage actually depicted in the script (including depicted flashbacks). If Lin appears in junior high, senior high and university, output THREE objects, never one combined profile. Add life_stage (e.g. "junior high", "senior high", "university"); name must be "Lin（junior high）", etc. If only one stage is depicted, keep the original name and set life_stage to "". Keep the same person's stable facial identity across stages, but describe ONLY the corresponding age, hairstyle, clothing, appearance and background in each object. Repeated scenes in the same stage are one asset. Do not create stages merely mentioned in dialogue, hypothetical futures or another person's history. Before returning, check every depicted person-stage pair is present exactly once.`
    : `
【人生阶段角色拆分：必须遵守】
按“人物＋剧本实际呈现的人生阶段”提取独立角色资产（包含实际呈现的回忆画面）。例如林晓分别出现在初中、高中、大学三个阶段，必须返回三个对象，不能合成一个跨年龄角色。每个对象增加 life_stage 字段（如“初中”“高中”“大学”），name 分别为“林晓（初中）”“林晓（高中）”“林晓（大学）”。只有一个阶段出场的人物保持原名，life_stage 填空字符串。各阶段保留同一人物的稳定五官特征，但 appearance、description 仅描述该阶段的年龄、发型、服装、外貌与背景，不得将多个阶段的形象混写。相同人物同一阶段在多个场景重复出现只提取一次。不得因为对白提及、假设未来或其他人物的经历就虚构阶段。输出前逐一核对剧本中实际呈现的每个“人物＋阶段”，确保无遗漏、无合并、无重复。`;
}

function getCharacterExtractionPrompt(cfg) {
  return getCharacterExtractionBody(cfg) + getCharacterStageRule(cfg);
}

function getCharacterExtractionBody(cfg) {
  const style = styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional character analyst, skilled at extracting and analyzing character information from scripts.

Your task is to extract and organize character settings for all named characters in the script.

Requirements:
1. Extract all characters with names (ignore unnamed passersby or background characters)
2. For each character, extract:
   - name: Character name
   - role: Character role (main/supporting/minor)
   - appearance: Detailed physical appearance for AI image generation (gender, age, body type, facial features, hairstyle, clothing style — NO scene or background info)
   - description: Brief background and relationships (50-100 words)
3. Main characters need detailed appearance; supporting characters can be simplified
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**
Each element is a character object containing the above fields.`;
  }
  const _charOverride = _overrideCache['character_extraction'];
  if (_charOverride) {
    return _charOverride + `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个元素是一个角色对象，包含上述字段。`;
  }
  return `你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。

**【语言要求】所有字段的值必须使用中文，禁止出现英文内容（role字段的值除外，固定为 main/supporting/minor）。**

你的任务是根据提供的剧本内容，提取并整理剧中出现的所有有名字角色的设定。

要求：
1. 提取所有有名字的角色（忽略无名路人或背景角色）
2. 对每个角色，提取以下信息（全部用中文填写）：
   - name: 角色名字（中文）
   - role: 角色类型，固定值之一：main / supporting / minor
   - appearance: 外貌描述（中文，100-200字，包含性别、年龄、体型、面部特征、发型、服装风格等，不含任何场景或环境信息）
   - description: 背景故事和角色关系（中文，50-100字）
3. 主要角色外貌要详细，次要角色可简化
- **风格要求**：${style}
- **图片比例**：${imageRatio}
输出格式：
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**
每个元素是一个角色对象，包含上述字段。`;
}

function getStoryboardSystemPrompt(cfg) {
  if (isEnglish(cfg)) {
    return `[Role] You are a senior film storyboard artist, proficient in Robert McKee's shot breakdown theory, skilled at building emotional rhythm.

[Task] Break down the novel script into storyboard shots based on **independent action units**.

[Shot Breakdown Principles]
1. **Action Unit Division**: Each storyboard shot corresponds to a **narrative beat**, and may contain 1-4 rapid internal cuts (described in the style of "Shot 1 ... Cut to Shot 2 ...") to fully utilize AI video clips of 5-15 seconds, avoiding excessive short clips caused by the old "one action per shot" rule that wastes generation time.
   - Ideal for merging character power awakening, quick reactions, or continuous actions into one storyboard entry connected by internal cuts
   - Only split into separate shots when there are clear pauses, scene changes, or narrative reasons for independent presentation
   - Traditional storyboard prompt style (with multi-shot cut descriptions) is fully supported

2. **Shot Type Standards** (choose based on storytelling needs):
   - Extreme Long Shot (ELS): Environment, atmosphere building
   - Long Shot (LS): Full body action, spatial relationships
   - Medium Shot (MS): Interactive dialogue, emotional communication
   - Close-Up (CU): Detail display, emotional expression
   - Extreme Close-Up (ECU): Key props, intense emotions

3. **Camera Movement Requirements**（**Dynamic Priority Mandatory**）:
   - 【Core Rule】: Static/fixed is the DEFAULT. Move the camera ONLY when the emotion motivates it (tension rising, a reveal, a decision, pursuit); a movement without emotional reason is showy and must be cut. Do NOT force a dynamic-shot quota or cap static shots — choose each movement from the beat.
   - Basic movements:
     * Push In: Forward approach, builds tension/intimacy
     * Pull Out: Backward reveal, shows environment or emotional release
     * Pan: Horizontal rotation, spatial reveal or lateral following
     * Tilt: Vertical rotation, height reveal or emotional rise/fall
     * Tracking/Follow: Camera follows subject, keeps subject framed
     * Crane Up: Ascending boom, grandeur or liberation
     * Crane Down: Descending boom, oppression or weight
     * Orbit: 360° circling around subject,立体 spatial depth
     * Handheld: Slight shake, realism/tension
   - Advanced movements:
     * Zoom: Optical zoom in/out without moving camera position
     * Roll: Rotation along lens axis, vertigo or weightlessness
     * Whip Pan: Rapid whip pan, temporal jump or chaos
     * Spiral: Ascend/descend while orbiting, dreamlike or crushing
   - Cinematic compound shots (use based on emotion):
     * Hitchcock Zoom (hitchcock_zoom): Push + zoom out (or reverse), spatial distortion vertigo, expresses terror/disorientation
     * Bullet Time (bullet_time): Orbit + slow-motion, subject ultra-slow, background spins fast, captures peak dramatic moment
     * Dutch Angle + Move (dutch_angle_move): Tilted frame + pan/orbit, mental breakdown/world collapse
     * Dolly + Track (dolly_track): Push + lateral move, complex emotional progression
     * Slow-mo Orbit (slowmo_orbit): Slow-motion circling, time-freezing dramatic instant

4. **Emotion & Intensity Markers**:
   - Emotion: Brief description (excited, sad, nervous, happy, etc.)
   - Intensity: Emotion level using arrows
     * Extremely strong ↑↑↑ (3): Emotional peak, high tension
     * Strong ↑↑ (2): Significant emotional fluctuation
     * Moderate ↑ (1): Noticeable emotional change
     * Stable → (0): Emotion remains unchanged
     * Weak ↓ (-1): Emotion subsiding

5. **Narrative Segment Grouping**:
   - Group consecutive shots into named narrative segments (e.g., "Arrival", "Confrontation", "Resolution")
   - Each segment = a coherent dramatic beat or scene transition
   - Segment rules:
     * 1–3 segments for short scripts (≤10 shots)
     * 3–6 segments for medium scripts (10–30 shots)
     * Shot count per segment: suggest 3–8 shots (avoid 1-shot segments unless a major turning point)
     * Opening shots: wide/establishing, closing shots: close-up/reaction to cap the beat

[Output Requirements]
1. Return a JSON array. Each element is one shot object containing ALL of the following fields:
   - shot_number: Shot number (integer, starting from 1)
   - title: Shot title (3–8 words, concise summary of this shot's key action or visual, e.g., "Lin Wei Enters the Room", "Tense Eye Contact")
   - segment_index: Segment index (0-based integer, e.g., 0, 1, 2…)
   - segment_title: Segment name (short 2–6 words, e.g., "Chance Encounter", "Hidden Truth Revealed")
   - location: Location name (e.g., "bedroom interior", "rooftop", "hospital corridor")
   - time: Time of day (e.g., "morning", "dusk", "night", "afternoon")
   - shot_type: Shot type (extreme long shot/long shot/medium shot/close-up/extreme close-up)
   - camera_angle: Camera angle (eye-level/low-angle/high-angle/side/back)
   - camera_movement: Camera movement — MUST be one of: static, push, pull, pan, tilt, tracking, crane_up, crane_dn, orbit, handheld, zoom, roll, whip_pan, spiral, hitchcock_zoom, bullet_time, dutch_angle_move, dolly_track, slowmo_orbit (static is default; pick a movement only when the beat motivates it)
   - lighting_style: Lighting style — choose ONE: natural/front/side/backlit/top/under/soft/dramatic/golden_hour/blue_hour/night/neon
   - depth_of_field: Depth of field — choose ONE: extreme_shallow/shallow/medium/deep (close-up → shallow/extreme_shallow; wide shot → deep)
   - action: Action description
   - result: Visual result of the action
   - dialogue: Character dialogue or narration (if any)
   - emotion: Current emotion
   - emotion_intensity: Emotion intensity level (3/2/1/0/-1)
   - rationale: One-sentence DESIGN REASON for this exact shot_size / angle / movement choice, grounded in emotion, beat, or character power relation (e.g., "tighten to CU as the accusation lands so the audience reads the listener's reaction"). Never empty.
   - transition: Transition INTO the next shot — one of cut/dissolve/fade/whip_pan/hard_cut/match_cut; default cut, use a non-cut transition only when the beat motivates it.

**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**

[DIRECTOR'S DECISION CONTRACT — HIGHEST PRIORITY]
Work like a director advising a beginner: every choice translates emotion, and every shot must carry its reason.
1. Decompose the scene into five variables first: dominant emotion; dramatic beat (setup/escalation/turning-point/outburst/resolution); character relations (who holds power); space (interior/exterior, scale, key props); action (who does what). If information is missing, proceed with a reasonable assumption.
2. Build ONE tension arc before shot-listing: the scene has exactly ONE highest-tension peak; every other shot serves it. A beat of stillness MUST precede an outburst, and a release (pull-back / wide / empty frame) MUST follow it. Open wide to establish space and staging; close on the person who is left / the emotional residue, not whoever exits.
3. Shot size = emotional distance: as conflict escalates, tighten size progressively (wide -> medium -> close -> ECU); snapping back to wide after an outburst reads as detachment. Avoid 3+ identical sizes in a row.
4. Angle = power relation: eye-level is neutral; low angle empowers, high angle weakens/judges; dutch angle (tilted frame) only for imbalance or psychological breakdown.
5. Dialogue uses shot/reverse-shot as backbone but LISTENER-FIRST: on the decisive line cut to the listener's reaction — emotion lives on the listener's face. Speaker close-ups at most 2-3 per scene. Respect the 180-degree axis unless disorientation is intended.
6. Cut only at four legal points: an emotional turn, the peak frame of an action, after a key line (to the reaction), or a breathing pause. NEVER cut on an even time interval.
7. One shot = one action unit with at most 3 physical actions (more breaks AI generation). Externalize emotion as FILMABLE PHYSICAL ACTION: not "he is angry" but "he clenches his fist until his knuckles whiten".
8. Light only as PHYSICAL FACTS, never mood adjectives: write "a single desk lamp lights half the face, the rest in shadow", not "oppressive atmosphere"; state source direction, hardness, color temperature.
9. Before an action outburst give one wide shot establishing where everyone is, so rapid cutting reads as tension not confusion; show the cost afterwards (breath, wounds, disarray).
10. If a single scene needs more than 14 shots, split it into two scenes rather than over-cramming.

[Important Notes]
- Shot count should match the number of **narrative beats** in the script (merging rapid consecutive actions with internal cuts inside a single storyboard entry is encouraged to optimize AI video duration)
- Each shot must have clear title, action (which may include multi-cut descriptions), result
- Shot types must match storytelling rhythm (don't use same shot type continuously)
- Emotion intensity must accurately reflect script atmosphere changes
- segment_index must be sequential integers starting from 0; all shots in the same segment share the same index and title`;
  }
  const _sbOverride = _overrideCache['storyboard_system'];
  if (_sbOverride) {
    return _sbOverride + '\n\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n\n【重要提示】\n- 镜头数量必须与剧本中的独立动作数量匹配（不允许合并或减少）\n- 每个镜头必须有明确的动作和结果\n- 景别选择必须符合叙事节奏（不要连续使用同一景别）\n- 情绪强度必须准确反映剧本氛围变化';
  }
  return `【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。

【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。

【分镜拆解原则】
1. **动作单元划分**：每个分镜对应一个**叙事节拍**，允许包含1-4个快速连续的内部切镜（使用“镜头1 ... 切镜到镜头2 ...”风格描述），以充分利用AI视频至少5秒、最长可达15秒的时长，避免因“一个镜头一个动作”导致产生过多短时长片段造成时间浪费。
   - 适合将角色能量觉醒、快速反应、连续动作等合并在一个分镜内，用内部切镜串联
   - 仅当动作间有明显停顿、场景切换或叙事需要独立呈现时，才拆分为多个分镜
   - 传统分镜风格的提示词（含多镜头切镜描述）同样支持

2. **景别标准**（根据叙事需要选择）：
   - 大远景：环境、氛围营造
   - 远景：全身动作、空间关系
   - 中景：交互对话、情感交流
   - 近景：细节展示、情绪表达
   - 特写：关键道具、强烈情绪

3. **运镜要求**（**情绪驱动，固定为默认**）：
   - 【运镜总原则】：**固定镜头是默认**，只有当情绪需要时才动镜头（紧张升级、揭示、下决心、追逐等）；没有情绪理由的运镜是炫技，必须砍掉。不强制运动镜头占比、不设固定镜头配额，每个运镜都必须能在 rationale 中讲出情绪依据。
   - 基础运镜：
     * 推镜（push）：镜头向前推进，增强紧张/亲密感
     * 拉镜（pull）：镜头向后拉开，揭示环境或情绪回落
     * 横摇（pan）：水平旋转摄像机，展现空间或跟随横向动作
     * 纵摇（tilt）：垂直旋转摄像机，展现高度或情绪起伏
     * 跟镜/跟踪（tracking）：摄像机跟随主体移动，保持主体在画框内
     * 升镜（crane_up）：吊臂上升，展现宏大或解放感
     * 降镜（crane_dn）：吊臂下降，压迫或沉重感
     * 环绕（orbit）：绕主体360°运动，展现立体空间
     * 手持（handheld）：轻微晃动，增加真实/紧张感
   - 进阶运镜：
     * 变焦（zoom）：光学变焦推进或拉远，不移动机位
     * 旋转/滚镜（roll）：镜头沿光轴旋转，制造眩晕/失重
     * 甩镜（whip_pan）：快速急摇，制造时空跳转或混乱感
     * 螺旋（spiral）：边升/降边环绕，梦幻或压迫感
   - 电影化组合镜头（根据剧情情绪选用）：
     * 希区柯克镜头（hitchcock_zoom）：向前推+变焦拉远（或反向），制造空间扭曲的眩晕感，表现惊恐/错乱
     * 子弹时间（bullet_time）：环绕+升格（slow-motion），主体动作极缓，背景高速旋转，表现关键高能时刻
     * 荷兰角+运镜（dutch_angle_move）：倾斜构图+横摇/环绕，表现精神错乱/世界崩塌
     * 推轨复合（dolly_track）：推镜+横向移动，复杂情绪递进
     * 升格环绕（slowmo_orbit）：慢动作环绕，时间凝固的戏剧性时刻

4. **情绪与强度标记**：
   - emotion：简短描述（兴奋、悲伤、紧张、愉快等）
   - emotion_intensity：用箭头表示情绪等级
     * 极强 ↑↑↑ (3)：情绪高峰、高度紧张
     * 强 ↑↑ (2)：情绪明显波动
     * 中 ↑ (1)：情绪有所变化
     * 平稳 → (0)：情绪不变
     * 弱 ↓ (-1)：情绪回落

5. **叙事段落分组**：
   - 将连续镜头归组为命名段落（如"邂逅"、"矛盾激化"、"和解"）
   - 每个段落 = 一个连贯的戏剧节拍或场景切换
   - 分组规则：
     * 短剧本（≤10个镜头）：1–3个段落
     * 中等剧本（10–30个镜头）：3–6个段落
     * 每段建议3–8个镜头，避免1镜头单独成段（除非是重大转折点）
     * 段落开篇用大远景/远景建立环境，段落结尾用近景/特写收尾

【输出要求】
1. 返回一个JSON数组，每个元素是一个镜头对象，必须包含以下**全部**字段：
   - shot_number：镜头号（整数，从1开始）
   - title：镜头标题（3–8字，简洁概括本镜头的核心动作或视觉重点，如"林薇走进房间"、"紧张的对视"）
   - segment_index：段落索引（从0开始的整数，如 0、1、2……）
   - segment_title：段落名称（简短2–6字，如"意外相遇"、"真相大白"）
   - location：场景地点名称（如"卧室内"、"天台"、"医院走廊"）
   - time：拍摄时间（如"清晨"、"黄昏"、"夜晚"、"午后"）
   - shot_type：景别（大远景/远景/中景/近景/特写）
   - camera_angle：机位角度（平视/仰视/俯视/侧面/背面）
   - camera_movement：运镜方式（static/推镜push/拉镜pull/横摇pan/纵摇tilt/跟镜tracking/升镜crane_up/降镜crane_dn/环绕orbit/手持handheld/变焦zoom/旋转roll/甩镜whip_pan/螺旋spiral/希区柯克hitchcock_zoom/子弹时间bullet_time/荷兰角dutch_angle_move/推轨复合dolly_track/升格环绕slowmo_orbit）（固定为默认，仅在节拍需要时选择运镜）
   - lighting_style：灯光风格 — 从以下选一个填入：natural/front/side/backlit/top/under/soft/dramatic/golden_hour/blue_hour/night/neon（根据 time 和 atmosphere 判断；夜晚→night，黄昏→golden_hour，室内暖光→soft，强情绪→dramatic，逆光→backlit）
   - depth_of_field：景深 — 从以下选一个填入：extreme_shallow/shallow/medium/deep（特写/近景→shallow，中景→medium，远景/大远景→deep）
   - action：动作描述
   - result：动作完成后的画面结果
   - dialogue：角色对话或旁白（如有）
   - emotion：当前情绪
   - emotion_intensity：情绪强度等级（3/2/1/0/-1）
   - rationale：本镜的**设计理由**（一句话），说明该景别/角度/运镜为何服务于情绪、节拍或人物强弱关系（例如“质问落地时切近景，让观众读到挨骂者的反应”），严禁留空
   - transition：与下一镜的**转场方式**，从 cut/dissolve/fade/whip_pan/hard_cut/match_cut 中选一个，默认 cut，仅在节拍需要时使用非常规转场

2. **构图与视觉设计参考**（生成分镜时运用）：
   - 景别变化规律：禁止连续3个及以上镜头使用相同景别，情绪递进时逐步推近（远→中→近→特写）
   - 构图建议：三分法（稳定叙事）/ 对角线（动态张力）/ 框架构图（增加纵深）/ 中心构图（庄重仪式感）
   - 光线方向：在 atmosphere 字段中注明光源方向和色温（如"左侧冷蓝光，逆光轮廓"）
   - 对话场景：使用正反打（过肩镜头交替），避免连续同向构图

**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**

【导演决策合同——最高优先级】
以一位面向新手的导演顾问方式工作：每个镜头选择都在翻译情绪，且每镜必须能讲出理由。
1. 先拆五个调度变量：主导情绪；戏剧节拍（铺垫/升级/转折/爆发/收尾）；人物关系（谁占上风）；空间（室内外、空间大小、关键道具）；动作（谁在做什么）。信息不足时按合理假设推进。
2. 排镜前先定一条张力曲线：一场戏**最高点只有一个**，其余镜头都为它服务；爆发前必须先给一拍安静（静默特写或固定镜头），爆发后必须给释放（拉远/大远景/空镜）。开场用远景/大远景建立空间与站位；收尾停在被留下的人或情绪余味上，不追离场者。
3. 景别=情绪距离：冲突升级时景别逐步收紧（远→中→近→特写）；爆发后突然回全景表达抽离；禁止连续3个以上相同景别。
4. 角度=权力关系：平视客观，仰拍赋予强势，俯拍表现弱势/审视，荷兰角（画面倾斜）只用于失衡或心理失常。
5. 对话以正反打为骨架但**听者优先**：关键台词落地时切到听者反应镜（情绪发生在听者脸上）；全场说话者特写最多2-3个；遵守180度轴线，除非有意制造混乱。
6. 只在四个合法切点切换：情绪转折处、动作顶点那一帧、台词重锤后（切听者）、呼吸停顿处；**禁止按时间均匀切镜**。
7. 一镜一个动作单元，单镜物理动作**不超过3个**（超了AI必崩）；情绪必须外化为**可拍摄的物理动作**：不写“他愤怒”，写“他攥紧拳头、指节发白”。
8. 光线只写**物理事实**、不写情绪形容词：写“仅一盏台灯，人物半张脸在阴影里”，不写“氛围压抑”；须写清光源方向、软硬、色温。
9. 动作爆发前先给一镜全景建立人物方位，碎切才是紧张而非混乱；爆发后让代价可见（喘息、伤痕、狼狈）。
10. 单场若超过14镜，拆成两场戏，不要硬塞。

【重要提示】
- 镜头数量应与剧本中的**叙事节拍**数量匹配（允许在单个分镜内用内部切镜合并快速连续动作，以优化AI视频时长）
- 每个分镜必须有明确的 title（标题）、action（动作）和 result（结果）；action 中可包含多镜头切镜描述
- 景别选择必须符合叙事节奏（不要连续使用同一景别）
- 情绪强度必须准确反映剧本氛围变化
- segment_index 必须从0开始递增的整数，同一段落内所有镜头共享相同的 segment_index 和 segment_title`;
}

/**
 * 全能片段描述统一格式说明（分镜批量生成 / 生成全能提示词 / 润色 共用）
 */
function getUniversalOmniMultiBeatFormatSpec(cfg) {
  const { DEFAULT_LINE3 } = require('./universalOmniMultiBeatFormat');
  if (isEnglish(cfg)) {
    return `
[UNIVERSAL_SEGMENT_TEXT — MULTI-BEAT BLOCK FORMAT ONLY]
FORBIDDEN: SoulLens/SEEDANCE single-line rows (主体:/叙事动态:/空间:/[禁BGM]); FORBIDDEN @人物N — use @图片1, @图片2, … only.

Field "universal_segment_text" is a **multi-line string** (use \\n in JSON). Structure:
Line 1: 画面风格和类型: 真人写实, 电影风格, 高清画质, <short style from project>
Line 2: 生成一个由以下M个分镜组成的视频. (M integer 1–8)
Line 3 (copy verbatim): ${DEFAULT_LINE3}
Lines 4..(3+M): 分镜k： Tk秒: <cinematic English prose for that slice; camera motion chain; light; emotion>
Sum(T1..TM) MUST equal this shot's JSON "duration" seconds exactly.

Reference tokens: @图片1 = scene/environment only; @图片2+ = characters in characters[] order; then props if any.
Dialogue: @图片2 says:"verbatim line" or …嗓音…："line". No speech: end with 无对白。
Narration: 旁白（画面无声）："verbatim narration"
- FORBIDDEN: rendering subtitles/captions for the spoken dialogue or narration into the video frames. Voices are audible; text must NOT appear on screen.
Each beat: rich motion picture prose (push in, pull back, rack focus), not a static snapshot caption.`;
  }
  return `
【universal_segment_text — 多子分镜段落格式（与「生成全能提示词」「润色」完全一致）】
**禁止**使用已废弃的灵境/SoulLens **单行**格式（含「主体：」「叙事动态：」「空间：」「镜头：」段标、行末 [禁BGM][禁字幕]、@人物N 指代参考图）。

本字段为 **多行字符串**（JSON 中用 \\n 换行），结构固定：
第1行：画面风格和类型: 真人写实, 电影风格, 高清画质, <可再加项目风格短语>
第2行：生成一个由以下M个分镜组成的视频。（M 为 1–8 的整数，与下文分镜条数一致）
第3行（必须逐字一致）：${DEFAULT_LINE3}
第4行起：分镜1： T1秒: …、分镜2： T2秒: … … 分镜M： TM秒: …
**硬性约束**：T1+T2+…+TM 必须严格等于本镜 JSON 的 duration（秒）；每行一条子分镜，禁止额外说明行。

子分镜正文写法（电影化中文长句，参考产品范例）：
- **参考图**：仅用 @图片1、@图片2…（阿拉伯数字）；@图片1 只写环境/光影/陈设；角色从 @图片2 起按 characters[] 顺序；有道具则继续 @图片3 …
- **运镜**：每段含至少两步运镜（如 缓推、横移、跟拍、拉回、俯拍特写），与人物动作同步。
- **对白**：有 dialogue 时必须写出原文，格式如 @图片2 的嗓音…："对白原文" 或 @图片2 说："对白原文"；无对白则句末写 **无对白。**
- **解说**：有 narration 时写在合适子分镜：**旁白（画面无声）："解说原文"**
- **禁止**：概括式台词（如「他说了一句重要的话」）、@人物N、markdown、SoulLens 段标签
- **禁止**：在画面内生成或烧录对白/旁白字幕（人声可听见，但画面不得出现字幕文字）

范例结构（勿照抄剧情，仅学排版）：
画面风格和类型: 真人写实, 电影风格, 高清画质, 日本动漫画风
生成一个由以下3个分镜组成的视频。
${DEFAULT_LINE3}
分镜1： 5秒: 镜头从 @图片1 … 无对白。
分镜2： 5秒: … @图片2 …："台词原文"
分镜3： 5秒: … 旁白（画面无声）："解说原文"`;
}

/**
 * 分镜生成「全能分镜模式」：JSON 每镜带 creation_mode + universal_segment_text（多子分镜段落格式）
 */
function getStoryboardUniversalOmniModeSuffix(cfg) {
  const spec = getUniversalOmniMultiBeatFormatSpec(cfg);
  if (isEnglish(cfg)) {
    return `

[HIGHEST PRIORITY — UNIVERSAL OMNI STORYBOARD MODE]
Every shot object MUST also include:
1. "creation_mode": exact string "universal".
2. "universal_segment_text": multi-line block per spec below (NOT a single SoulLens line).
${spec}`;
  }
  return `

【最高优先级——全能分镜模式】
每个镜头在保留上述全部原有字段的同时，还必须额外包含：
1. "creation_mode"：固定字符串 "universal"（不可省略）。
2. "universal_segment_text"：按下列 **多子分镜段落** 规范书写（与后续「生成全能提示词」「润色」同一套版式，禁止单行灵境格式）。
${spec}`;
}

/** 分镜生成勾选「解说旁白」时追加到用户提示词末尾 */
function getStoryboardNarrationExtraInstructions(cfg) {
  if (isEnglish(cfg)) {
    return `

【VO / Narration mode — STRICT (user enabled full VO pipeline)】
- Add string field "narration" to **each** shot. **Every "narration" MUST be a non-empty string** (at least one full sentence), readable within this shot's "duration".
- **Shot with shot_number = 1 MUST** open with narrator lines: set time/place/mood or a hook — never leave empty because the shot is "establishing only".
- **Shot 2** should also carry narration if it is still wide/establishing; do not leave both 1 and 2 empty.
- Third-person / documentary narrator voice — **not** character dialogue (keep spoken lines in "dialogue" only). Do not copy dialogue text into "narration".
- 1–3 short sentences per shot; forbid consecutive shots with empty "narration".`;
  }
  return `

【解说旁白模式 — 硬性要求（用户已开启全片解说管线）】
- 在 "storyboards" 数组的**每一个**镜头对象中必须有字符串字段 "narration"，且 **narration 一律不得为空字符串**（每镜至少一句完整解说，约 10～50 字，须在本镜 duration 秒内能读完）。
- **shot_number 为 1 的第一个镜头**：必须有**开场解说**（交代时间、空间、氛围或悬念钩子），禁止以「纯建立镜头、无对白所以无旁白」为由留空；大远景/远景用旁白描述环境与基调，把观众带进故事。
- **第 2 个镜头**：若仍为远景/大远景/环境铺垫，同样必须写旁白；**禁止第 1、2 镜连续留空**。
- narration 为画外第三人称或纪录片式解说，与角色对白 dialogue 严格区分；对白只写在 dialogue，不要把对白原文复制进 narration。
- 每镜 1～3 句为宜；禁止连续多个镜头的 narration 为空。`;
}

function formatUserPrompt(cfg, key, ...args) {
  const style = styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  const templates = {
    en: {
      character_request: 'Script content:\n%s\n\nPlease extract and organize detailed character profiles for ALL named characters from the script.',
      drama_info_template: `Title: %s\nSummary: %s\nGenre: %s\nStyle: ${style}\nImage ratio: ${imageRatio}`,
      script_content_label: '【Script Content】',
      task_label: '【Task】',
      character_list_label: '【Available Character List】',
      scene_list_label: '【Extracted Scene Backgrounds】',
      task_instruction: 'Break down the novel script into storyboard shots based on **independent action units**.',
      character_constraint: '**Important** — characters field rules:\n1. Only use character IDs (numbers) from the above character list. Do not invent IDs.\n2. Only include characters who **physically appear and act** in this specific shot. Do NOT list characters who are merely mentioned, offscreen, or appear in the overall scene but not in this shot.\n3. The number of characters listed must match who is described in the action/dialogue fields. If the action only describes one person, list only that one character.\n4. If the same person has separate life-stage assets, choose only the ID for the stage depicted in this shot (including flashbacks); never substitute another stage or include all stages.',
      scene_constraint: '**Important**: In the scene_id field, select the most matching background ID (number) from the above background list. If no suitable background exists, use null.',
      prop_list_label: '【Available Prop List】',
      prop_constraint: '**Important** — props field rules:\n1. Only use prop IDs (numbers) from the above prop list. Do not invent IDs.\n2. Only include props that are **visually present and actively used or prominently featured** in this specific shot.\n3. If no props from the list appear in the shot, use an empty array [].',
      frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the first frame without any explanation:',
      key_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the key frame without any explanation:',
      last_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the last frame without any explanation:',
      shot_description_label: 'Shot description: %s',
      scene_label: 'Scene: %s, %s',
      characters_label: 'Characters: %s',
      action_label: 'Action: %s',
      result_label: 'Result: %s',
      dialogue_label: 'Dialogue: %s',
      atmosphere_label: 'Atmosphere: %s',
      shot_type_label: 'Shot type: %s',
      angle_label: 'Angle: %s',
      movement_label: 'Movement: %s',
      storyboard_count_constraint: '**Constraint**: Total shot count must be around %s (allow ±20%). Please merge or split actions to meet this requirement.',
      video_duration_constraint: '**Constraint**: Total video duration must be around %s seconds (allow ±10%). Please adjust shot count and duration to meet this requirement.',
    },
    zh: {
      character_request: '剧本内容：\n%s\n\n请提取剧本中所有有名字角色的设定。',
      drama_info_template: `剧名：%s\n简介：%s\n类型：%s\n风格: ${style}\n图片比例: ${imageRatio}`,
      script_content_label: '【剧本内容】',
      task_label: '【任务】',
      character_list_label: '【本剧可用角色列表】',
      scene_list_label: '【本剧已提取的场景背景列表】',
      task_instruction: '将小说剧本按**独立动作单元**拆解为分镜头方案。',
      character_constraint: '**重要** — characters字段填写规则：\n1. 只能使用上述角色列表中的角色ID（数字），不得自创ID。\n2. 只填写在**本镜头中实际出现并有具体行为**的角色。不要把"提到的"、"画面外的"、或整个场景里有但本镜头动作中未描述的角色也列进去。\n3. characters数量必须与action/dialogue中实际描写的人物数量一致。如果action只描述了一个人的动作，characters里就只填那一个人的ID。\n4. 同一人物有多个阶段角色时，根据本镜头的时间阶段（包括回忆）仅选择对应阶段的角色ID；不得混用初中、高中、大学等不同阶段，也不得将各阶段全部加入同一镜头。',
      scene_constraint: '**重要**：在scene_id字段中，必须从上述背景列表中选择最匹配的背景ID（数字）。如果没有合适的背景，则填null。',
      prop_list_label: '【本集可用道具列表】',
      prop_constraint: '**重要** — props字段填写规则：\n1. 只能使用上述道具列表中的道具ID（数字），不得自创ID。\n2. 只填写在**本镜头中视觉上出现并被使用或显著展示**的道具。\n3. 如果本镜头中没有列表中的道具出现，则填空数组[]。',
      frame_info: '镜头信息：\n%s\n\n请直接生成首帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      key_frame_info: '镜头信息：\n%s\n\n请直接生成关键帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      last_frame_info: '镜头信息：\n%s\n\n请直接生成尾帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      shot_description_label: '镜头描述: %s',
      scene_label: '场景: %s, %s',
      characters_label: '角色: %s',
      action_label: '动作: %s',
      result_label: '结果: %s',
      dialogue_label: '对白: %s',
      atmosphere_label: '氛围: %s',
      shot_type_label: '景别: %s',
      angle_label: '角度: %s',
      movement_label: '运镜: %s',
      storyboard_count_constraint: '**重要约束**：总分镜数量必须控制在 %s 个左右（允许 ±20% 的偏差）。请务必合并或拆分动作以满足此数量要求。',
      video_duration_constraint: '**重要约束**：视频总时长必须控制在 %s 秒左右（允许 ±10% 的偏差）。请调整分镜数量和单镜时长以满足此要求。',
    },
  };
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const t = templates[lang][key] || templates.zh[key];
  if (!t) return args[0] != null ? String(args[0]) : '';
  let i = 0;
  return t.replace(/%[sd]/g, () => (args[i] != null ? String(args[i++]) : ''));
}

/** 分镜用户提示词后缀：详细输出格式与要求
 * @param {object} cfg - 配置对象
 * @param {number|null} shotDuration - 单镜建议时长（秒），由后端从项目配置或总时长/数量推算后注入
 */
function getStoryboardUserPromptSuffix(cfg, shotDuration) {
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const durationHint = shotDuration && Number.isFinite(Number(shotDuration)) && Number(shotDuration) > 0
    ? Number(shotDuration)
    : null;
  if (lang === 'en') {
    const durationInstruction = durationHint
      ? `approximately ${durationHint}s per shot (project setting), adjust ±1s based on dialogue length and action complexity`
      : 'estimate per shot from dialogue length, action complexity, and emotion';
    return `

**dialogue field**: "Character: \"line\"". Multiple: "A: \"...\" B: \"...\"". Monologue: "(Monologue) content". No dialogue: "".

**scene_id**: Select the most matching background ID from the scene list above, or null if none suitable.

**duration (seconds)**: ${durationInstruction}.

**Audio rule**: bgm_prompt MUST be an empty string or "No BGM". Do not design background music per shot. Put only diegetic ambience, foley, and voice/timbre details in sound_effect, so audio remains consistent across clips.

**Output**: JSON with "storyboards" array. Each item: shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters (array of IDs), props (array of prop IDs), is_primary, rationale (non-empty design reason), transition (cut/dissolve/fade/whip_pan/hard_cut/match_cut). Return ONLY valid JSON, no markdown.`;
  }
  const _sbUserLocked = `\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary, rationale（必填，本镜设计理由，一句话）, transition（转场：cut/dissolve/fade/whip_pan/hard_cut/match_cut，默认cut）, **layout_description（画面布局与人物站位描述，必填，最高优先级空间合同）**。**必须只返回纯JSON，不要markdown。**`;
  const _sbUserOverride = _overrideCache['storyboard_user_suffix'];
  if (_sbUserOverride) {
    return '\n\n' + _sbUserOverride + _sbUserLocked;
  }
  const durationInstruction = durationHint
    ? `每镜头约${durationHint}秒（项目配置），综合对话、动作、情绪可适当调整±1秒`
    : '综合对话、动作、情绪估算每镜时长（秒）';
  return `

【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：
1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪
2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]
3. **地点**：[场景完整描述+空间布局+环境细节]
4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**
5. **人物行为**：**详细动作描述**
6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）
7. **画面结果**：动作的即时后果+视觉细节+氛围变化
8. **环境氛围**：光线质感+色调+声音环境+整体氛围
9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；**不要为单个片段设计背景音乐**。sound_effect 只写现场环境声、动作音效、对白/旁白音色（如低沉、沙哑、颤抖、冷静、急促等）和口型同步要求
10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）

**【最高优先级空间合同 - layout_description（必填，最高优先级铁律）】**
这是本分镜的**核心空间锚点 + 真实物体尺度 + 运镜呼吸空间**铁律，用于首帧/尾帧图片生成时在保持一致性的同时，为运镜留出必要空间（尤其是 Seedance 1.5 Pro 等依赖首尾帧的模型）：

- 必须明确写出**主要角色在画面中的核心站位**（画面左/中/右三分、朝向、与关键道具的基本空间关系）。这是硬性锁定。
- **必须同时写出所有主要道具的真实物理尺度与相对比例**（仅描述本分镜/剧本中实际出现的道具，尺度须符合其所属时代与场景；例如古代场景写案几高度、书卷尺寸、铜器体量等，现代场景写对应家具与小物件真实尺寸；所有道具均为次要环境元素）。严禁任何会导致AI把道具做大、立起或当成主导元素的描述；**严禁写入与时代背景不符的道具**（古代/古装分镜不得出现智能手机、遥控器、现代茶几等现代物品）。
- 必须写明**整体构图方式和基本机位距离感**（中景、三分法等）。
- **必须为 declared movement（运镜方式）预留电影化演化空间**：明确说明首尾帧在核心站位和真实尺度保持一致的前提下，允许根据 movement 进行自然的取景微调（例如：缓推时尾帧可比首帧稍紧；手持时允许轻微取景晃动与不完美平衡；横摇/跟拍时允许画面左右自然的进入/退出变化）。目标是让首尾帧既像“同一场同一空间的连续镜头”，又能真正支持运镜产生动态视频，而不是变成几乎定格的画面。
- **严禁写入会导致比例失真或完全锁死运镜的表述**（即使剧本里有相关描述也禁止）："道具作为视觉焦点/占画面主导"、"手持晃动带来纪实感"、"完全相同的构图平衡"等。
- 好示例（古代场景，带运镜空间）："主角坐画面左中榻上，是绝对视觉焦点；右下前景木质案几高约75cm，书卷平放于案面为正常尺寸，铜灯与茶具均为次要环境小物件，绝不可夸大；中景，三分法构图，核心平衡稳定。若 movement 为缓推，尾帧允许人物在画面中占比自然增加、背景稍被压缩；若为手持，允许轻微取景不完美偏移。"
- **执行原则**：首帧按此锚点生成初始画面；尾帧必须保持核心站位、角色与道具的真实尺度与基本空间关系，仅根据 movement 和 result 进行自然的取景演化。违背核心锁定 = 失败；完全没有运镜演化空间也属于不合格结果。

**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。
**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。
**duration时长**：${durationInstruction}。
**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 必须补充音色与情绪强度，并与动作节奏、环境声保持一致。

【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary, rationale（必填，本镜设计理由，一句话）, transition（转场：cut/dissolve/fade/whip_pan/hard_cut/match_cut，默认cut）。**必须只返回纯JSON，不要markdown。**`;
}

/**
 * 真实物理尺度铁律 — 时代/场景自适应，专治布局描述冲突与跨时代道具幻觉
 */
function getRealisticPhysicalScaleContract(isEn) {
  if (isEn) {
    return `【HIGHEST PRIORITY REALISTIC PHYSICAL SCALE & PROPORTION CONTRACT — ERA-AWARE, ABSOLUTE OVERRIDE】
Every visible object in the scene MUST be rendered at 100% correct real-world physical dimensions for its era/setting, with correct relative proportions and accurate photographic perspective. This rule has HIGHER PRIORITY than any conflicting instruction in the layout_description / spatial anchor above.
CRITICAL RULES:
- **Era fidelity (MANDATORY)**: Props MUST match the story's time period and location. In ancient/historical/costume drama scenes, NEVER include smartphones, remote controls, modern coffee tables, A4 books, or any anachronistic modern items. Only describe props that actually belong in this shot according to the script and scene context.
- **Scale only for props actually present**: For each major prop visible in the frame, state realistic size relative to the human figure and environment (e.g. ancient: writing desk ~70–85 cm, scroll ~25–35 cm; modern: side table ~38–52 cm, small handheld device lying flat at true size). Never invent props not in the shot.
- **Secondary props**: The human character is the ONLY primary visual subject. All props are strictly secondary environmental elements — never oversized, never upright as dominant elements, never breaking perspective.
- If layout_description contains scale-distorting phrases, IGNORE those implications and follow era-appropriate realistic scale and "secondary prop" rules above.
This contract applies to BOTH first frame and last frame with zero exception.
Violation (anachronistic props, oversized objects, broken perspective, props as dominant elements) = critical generation failure.`;
  }
  return `【最高优先级真实物理尺度与道具比例铁律 — 时代自适应，绝对覆盖，违反即严重失败】
本分镜内所有可见物体必须100%遵循其所属时代/场景的真实世界物理尺寸、正确相对比例和电影摄影透视法则。本铁律的优先级绝对高于上方布局描述中任何可能导致比例失真的表述。
【关键规则（即使布局描述写得有问题也必须遵守）】
- **时代一致性（强制）**：道具必须严格符合剧本设定的时代背景。古代/古装/架空历史场景中**严禁**出现智能手机、遥控器、现代茶几、A4书籍、平板等任何现代物品；只描述本分镜中实际存在且符合时代的道具。
- **仅描述画面内实际道具的尺度**：对每个主要道具写出相对人体与环境的合理真实尺寸（例如古代：案几高约70-85cm、书卷长约25-35cm、铜镜直径约15-20cm；现代：边桌高约38-52cm等），不得凭空添加剧本未出现的道具。
- **次要环境元素**：角色是画面中唯一的首要视觉主体和焦点；所有道具均为严格次要的小型环境元素，不得夸大、立起成为主导视觉、或破坏透视。
- 若布局描述中有会导致不真实尺度的表述，必须忽略其对物体尺寸和透视的影响，只严格执行本铁律中符合时代的真实尺度与「次要道具」要求。
本铁律同时适用于首帧和尾帧生成，零例外。
任何生成结果出现时代错乱道具、物体过大失真、透视错误、道具成为主导元素，均视为严重失败。`;
}

function getFirstFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the FIRST FRAME - a completely static image showing the initial state BEFORE the action begins.

Core Rules:
1. Static initial state only - the moment before any action
2. NO movement or action descriptions
3. Describe character's initial posture, screen position (left/center/right), and expression
4. ONLY characters listed in "ALLOWED CHARACTERS IN THIS SHOT" may appear — never add unlisted characters
5. For each allowed character write ONLY "Name (use appearance from reference image)" plus position/posture/expression/props — NEVER put hair, face, skin, makeup, or temperament inside parentheses or anywhere else. Scene/environment lines must contain ZERO human appearance descriptions
6. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)

Cinematic Language (must apply):
- COMPOSITION: Choose based on shot type: Rule of Thirds (subject at grid intersections), Frame Composition (use doors/windows/branches as natural frame), Center Composition (symmetrical, ceremonial), Foreground Layering (blurred foreground for depth)
- LIGHTING: Specify light source direction (left/right/top/backlight/bottom), quality (hard light=dramatic shadows / soft light=natural warmth), color temperature (warm=golden/orange, cool=blue/cyan)
- DEPTH OF FIELD: Close-up/medium-close=shallow DOF, background blur; Medium shot=medium DOF; Long shot/wide=deep DOF, full scene clarity
- CHARACTER POSITION: Describe placement in frame, facing direction (toward/away from camera/profile), body language
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description)
- description: Simplified Chinese description (for reference)`;
  }
  const _ffLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _ffOverride = _overrideCache['first_frame_prompt'];
  if (_ffOverride) {
    return _ffOverride + _ffLocked;
  }
  const ffScaleContract = getRealisticPhysicalScaleContract(false);
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。

${ffScaleContract}

核心规则：
1. 聚焦初始静态状态 - 动作发生之前的那一瞬间，禁止包含任何动作或运动描述
2. 描述角色在画面中的位置（画面左/中/右）、朝向（面向/背对/侧面）、初始姿态和表情
3. 【出场角色铁律】仅允许 CONTEXT 中「本分镜允许出场的角色」名单内的人物出现；名单外角色严禁写入 prompt（不得出现其名字、站位、动作、表情）
4. 【角色外貌写法铁律 - 违反即失败】每个允许出场的角色在 prompt 中**只能**写为「角色名（参考图中的人物形象）」+ 画面位置 + 姿态 + 表情 + 手持道具；括号内及前后**严禁**写发型、发色、发长、五官、面容、眉眼、轮廓、肤质、妆容、气质等任何外貌词。**禁止**把锚点/appearance 里的外貌特征抄进 prompt（图生图由参考图锁定外貌）
5. 【场景描写铁律】「场景为…」「环境…」等空间/环境句**严禁**出现任何人物外貌描写，只写空间、道具、光线、氛围
6. 如 CONTEXT 提供了角色视觉锚点，仅供理解身份，**不得**将锚点内容写入 prompt 正文

【电影语言规范（必须应用）】

构图规则（根据景别选择）：
- 三分法：主体置于三分线交点，稳定平衡，适合大多数叙事镜头
- 框架构图：用门窗/树枝/栏杆形成自然画框，突出主体，增加纵深
- 中心构图：对称庄重，适合特写和仪式感场景
- 前景遮挡：前景虚化元素增加层次感

光线设计（必须描述）：
- 光源方向：左侧光/右侧光/顶光/逆光（轮廓光）/底光
- 光线质感：硬光（强烈阴影，戏剧张力）/ 柔光（柔和过渡，自然温馨）
- 色温：暖光（金黄/橙红，温暖怀旧）/ 冷光（蓝调/青白，冷漠疏离）

景深设置：
- 特写/近景：浅景深，背景虚化，突出人物情绪
- 中景：中等景深，人物与环境均清晰
- 远景/全景：深景深，前后均清晰，交代空间关系
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度强制要求】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加「第1层」等层标签文字）。**在第3层“内容焦点”中必须包含一段符合时代背景的真实物体尺度描述**（仅写本分镜实际出现的道具；古代场景示例：“所有道具严格符合古代真实物理比例，案几高约75cm，书卷为正常尺寸平放于案面，铜灯与茶具均为次要环境小物件，绝不可夸大，主角为绝对视觉焦点”）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（如「中景，平视角度，三分法构图」）
第2层-光线：光源方向 + 光线质感 + 色温（如「左侧柔暖光，黄金时刻暖调」）
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+初始姿态+表情，不写外貌）+ 场景环境关键细节（不含人物外貌） + **必须包含真实物体尺度描述（见上方强制要求）**
第4层-氛围：情绪基调 + 色彩倾向（如「安静紧张氛围，低饱和冷色调」）
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，高清细节，所有物体严格真实尺度

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文，仅允许必要风格专有名如 realistic 等单个词；必须自然融入符合时代的真实尺度描述，严禁时代错乱道具或物体过大失真）
- description：一句话中文描述（供人类参考）`;
}

function getKeyFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the KEY FRAME - capturing the most intense and climactic moment of the action.

Core Rules:
1. Focus on the peak moment of the action - maximum dramatic tension
2. Capture the emotional climax - character's most expressive state
3. Can include dynamic effects (motion blur, impact lines, visual tension)
4. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)
5. Show character's body language and expression at climax

Cinematic Language (must apply):
- COMPOSITION: For action/climax - diagonal composition (dynamic tension, leads viewer's eye), Dutch angle (unease/intensity for conflict scenes), over-shoulder (confrontation/dialogue tension)
- LIGHTING: Dramatic lighting for peak moments - rim light separating subject from background, strong chiaroscuro (light/shadow contrast), or explosive bright key light for revelations
- DEPTH OF FIELD: Usually shallow to isolate the critical action; deep for wide action involving environment
- EMOTIONAL COLOR: Warm saturated (passion/anger), cool desaturated (shock/loss), high contrast (climax/confrontation)
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description)
- description: Simplified Chinese description (for reference)`;
  }
  const _kfLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _kfOverride = _overrideCache['key_frame_prompt'];
  if (_kfOverride) {
    return _kfOverride + _kfLocked;
  }
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的关键帧 - 捕捉动作最激烈、情绪最饱满的高潮瞬间。

核心规则：
1. 聚焦动作高潮时刻，最大化戏剧张力
2. 捕捉情绪顶点，角色表情和肢体语言处于最强烈状态
3. 可包含动态效果（动作模糊、视觉冲击感）
4. 【出场角色铁律】仅允许「本分镜允许出场的角色」名单内人物；名单外角色严禁出现
5. 【角色外貌写法铁律】每个角色只写「名字（参考图中的人物形象）」+ 姿态 + 表情，严禁外貌描写；锚点内容不得写入 prompt
6. 【场景描写铁律】环境/场景句严禁人物外貌描写
7. 展示角色高潮状态下的肢体姿态和神情

【电影语言规范（必须应用）】

构图规则（高潮/动作场景）：
- 对角线构图：强烈动态感，视觉引导，适合冲突/行动镜头
- 荷兰角/斜角：不安感和紧张感，适合对峙/心理冲击场景
- 过肩镜头：适合对话高潮、面对面对峙

光线设计（高潮时刻）：
- 轮廓光：将主体从背景中分离，突出人物
- 强烈明暗对比（硬光）：戏剧张力，冲突感
- 爆发性亮光：适合揭示真相、情绪爆发时刻
- 色温情绪化：暖色饱和（激情/愤怒）/ 冷色低饱和（震惊/失落）

景深与色调：
- 通常使用浅景深聚焦关键动作，隔离背景
- 高对比度色调强化高潮感
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度强制要求】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加层标签文字）。**在第3层“内容焦点”中必须包含一段符合时代背景的真实物体尺度描述**（仅写本分镜实际出现的道具，严禁写入与时代不符的现代物品）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（如「特写，低角度，对角线构图」）
第2层-光线：光源方向 + 光线质感 + 色温（如「轮廓光，强明暗对比，暖色饱和」）
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+高潮姿态+情绪表情）+ 场景关键细节（不含外貌） + **必须包含真实物体尺度描述**
第4层-氛围：情绪基调 + 色彩倾向（如「激烈对峙，高对比，鲜艳饱和色调」）
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，动态张力，所有物体严格真实尺度

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文；必须自然融入真实尺度描述）
- description：一句话中文描述（供人类参考）`;
}

function getLastFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the LAST FRAME - a static image showing the final state AFTER the action ends.

Core Rules:
1. Focus on the final resting state after action completion
2. Show the visible result/consequence of the action
3. Describe character's final posture, position, and emotional expression
4. Emphasize the emotional aftermath - relief, tension, sadness, triumph
5. ONLY characters in "ALLOWED CHARACTERS IN THIS SHOT" may appear; write each as "Name (use appearance from reference image)" plus position/posture/expression only — no hair/face/skin in scene or character lines
6. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)
7. **CORE POSITION + SCALE LOCK + MOVEMENT EVOLUTION (for 5-15s videos)**: 
- Must keep core character screen placement (left/center/right third, facing), realistic physical sizes of all props, and basic spatial relationships consistent with the first frame / layout contract (no left-right swaps, no major repositioning of key elements, no scale distortion).
- However, for 5-15 second clips, the last frame MUST show meaningful cinematic evolution driven by the declared camera_movement + the RESULT:
  - Slow push-in → noticeably tighter framing on the character (higher screen occupancy).
  - Handheld / tracking → natural slight framing drift and imperfect composition.
  - Pan / orbit → natural entry/exit changes or minor camera drift on sides.
- Goal: First and last frames must feel like the same continuous physical scene, but with enough visual progression that the generated video actually realizes the declared movement instead of looking nearly static. Zero movement evolution = undesirable result.

Cinematic Language (must apply):
- COMPOSITION: For 5-15s videos, the last frame must balance "same physical space" consistency with visible evolution from the declared movement. Keep core placement and realistic prop scales, but allow framing changes that naturally result from the camera movement (tighter on push-in, natural drift on handheld, side shifts on pan). The goal is meaningful visual progression, not near-identical framing that kills motion.
- LIGHTING: Reflect emotional aftermath - soft warm light (resolution/comfort), lingering dramatic shadows (unresolved tension), fading light (loss/ending)
- DEPTH OF FIELD: Match the emotional tone - shallow for intimate emotional close, deep for consequential wide shots showing impact on environment
- CHARACTER POSITION: Show the final state after the full action + movement. Character's ending posture/expression per RESULT, with framing that reflects the cumulative effect of the declared camera_movement over the clip duration (more significant evolution allowed for 5-15s videos), while strictly keeping core placement, realistic prop scales, and no major spatial violations of the layout contract.
- ATMOSPHERE: Describe color tone and mood that carries the emotional weight of the scene's conclusion
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description). For 5-15s videos, the prompt must describe visible framing evolution caused by the declared camera_movement (e.g. tighter framing after push-in, natural drift on handheld) while keeping core positions and realistic prop scales.
- description: Simplified Chinese description (for reference)`;
  }
  const _lfLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _lfOverride = _overrideCache['last_frame_prompt'];
  if (_lfOverride) {
    return _lfOverride + _lfLocked;
  }
  const lfScaleContract = getRealisticPhysicalScaleContract(false);
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。

【最高优先级真实物理尺度与道具比例铁律 + 运镜演化（5-15秒视频）】（详见本分镜“空间布局锚点”中的完整铁律）
本分镜内所有可见物体必须100%遵循其所属时代/场景的真实世界物理尺寸、正确相对比例和电影摄影透视法则；仅描述实际出现的道具，严禁时代错乱物品。所有道具均为次要环境元素。
尾帧允许根据 movement 进行取景演化（例如缓推后人物占比明显增加、手持后自然漂移），但严禁改变任何物体的真实物理尺寸、相对比例或破坏透视。尺度失真 = 失败；完全没有运镜演化 = 同样不理想。

核心规则：
1. 聚焦动作完成后的最终静态状态
2. 展示动作的可见结果和后果
3. 描述角色在动作完成后的最终姿态、位置和情绪表情
4. 强调情绪余韵：释然/平静/悲伤/胜利/遗憾
5. 【出场角色铁律】仅允许「本分镜允许出场的角色」名单内人物；名单外角色严禁出现
6. 【角色外貌写法铁律】每个角色只写「名字（参考图中的人物形象）」+ 最终姿态 + 表情，严禁外貌描写；锚点不得写入 prompt
7. 【场景描写铁律】环境/场景句严禁人物外貌描写
8. 【人物站位与运镜演化铁律（5-15秒视频专用）】如果提供了首帧参考图或首帧构图描述（包括空间布局锚点），**必须保持核心站位、真实物理尺度、基本空间关系与透视一致**（主要角色不左右互换、主要道具不大幅移位、所有物体真实尺寸不变）。但**必须根据本分镜的 movement（运镜方式）和视频时长（通常5-15秒）进行有意义的取景演化**：
   - 例如：缓推（slow push-in）时，尾帧人物在画面中的占比应明显比首帧更大、背景更被压缩；
   - 手持跟拍时，允许自然的取景轻微晃动与不完美偏移；
   - 横摇/环绕时，画面可有自然的左右进入/退出变化或轻微机位漂移。
   目标是让尾帧体现运镜的累积视觉结果 + result 描述的最终状态，而非与首帧几乎一模一样。完全没有运镜演化空间属于不合格。

【电影语言规范（必须应用）】

构图规则（收尾镜头，5-15秒视频）：
- 收尾镜头必须在核心站位、真实物体尺度、基本空间关系上与首帧保持一致（硬锁）。
- 但**必须体现 declared movement 的累积视觉效果**：例如缓推后尾帧应比首帧更紧（人物占比明显增加）、手持跟拍后允许自然取景漂移、横摇后画面可有轻微左右偏移。
- 目标是让首尾帧之间有足够但合理的视觉差异，使基于它们的视频能真正“动”起来，而不是几乎定格。
- 严禁大幅移动主要角色或道具位置、破坏真实尺度或透视。

光线设计（情绪余韵）：
- 柔和暖光：事件解决后的温情/宽慰
- 残留戏剧阴影：未解决的张力，悬念延续
- 渐弱光线/冷调：失去/结束/遗憾的情绪
- 色调整体偏暗或偏亮反映情绪归宿

景深与氛围：
- 情绪收场：浅景深，聚焦面部情绪细节
- 结果展示：深景深，展示行动对环境/他人的影响
- 整体色调和氛围承载本镜头情绪的收尾重量
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度 + 运镜演化强制要求（5-15秒视频）】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加层标签文字）。
- **第3层“内容焦点”必须同时包含**：真实物体尺度描述 + 根据本分镜 movement 和时长（5-15秒）进行的取景演化描述（例如“缓推后人物画面占比明显增加”、“手持跟拍后取景有自然轻微漂移”等）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（需体现尾帧相对于首帧的自然演化）
第2层-光线：光源方向 + 光线质感 + 色温
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+最终姿态+情绪余韵）+ 场景最终状态（不含外貌） + 真实尺度 + **运镜累积演化描述**（必须写，5-15秒视频需有明显但合理的视觉差异）
第4层-氛围：情绪基调 + 色彩倾向
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，所有物体严格真实尺度，运镜自然演化

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文；必须自然融入符合时代的真实尺度 + 根据 movement 的取景演化描述，5-15秒视频尾帧需体现运镜累积效果，严禁时代错乱道具或物体过大失真）
- description：一句话中文描述（供人类参考）`;
}

/** 道具提取系统提示词（system prompt，剧本内容由 user prompt 单独传入） */
function getPropExtractionPrompt(cfg) {
  const base = styleTextForCfgLang(cfg);
  const propExtra = (cfg?.style?.default_prop_style || '').toString().trim();
  const style = [base, propExtra].filter(Boolean).join(', ');
  const imageRatio = cfg?.style?.default_prop_ratio || cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional script prop analyst, skilled at extracting key props with visual characteristics from scripts.

Your task is to extract and organize all key props that are important to the plot or have special visual characteristics from the provided script content.

[Requirements]
1. Extract ONLY key props that are important to the plot or have special visual characteristics.
2. Do NOT extract common daily items (e.g., normal cups, pens) unless they have special plot significance.
3. If a prop has a clear owner, note it **only** in "description" (Chinese OK). **Never** put character names, nicknames, or relationship words in "image_prompt".
4. "image_prompt" must be **English**, written as a **professional catalog / product-hero** shot for a single prop: describe shape, material, color, wear, scale cues, and finish in detail.
5. In "image_prompt" you **must** specify: **one seamless solid-color studio backdrop** (matte, no gradient), **only the prop as the sole subject**, **soft even studio lighting** (readable micro-detail, no dramatic movie lighting), and explicitly forbid people, hands, furniture, floors, tables, scenery, packaging (unless the prop *is* the package), text, logos, dust/debris, or any secondary objects.
6. **No script leakage in "image_prompt"**: forbid character names, place names, organization names, dialogue, plot beats, and other **original-script identifiers**. Replace with generic visual terms (e.g. "engraved serif lettering" instead of a name). The **only** exception is text that is **visibly printed or engraved on the prop itself** as part of its graphic design—describe that text generically if possible ("small engraved inscription") unless the script explicitly requires exact wording on the object.
7. **Strict, non-expanding "image_prompt"**: include **only** attributes grounded in the script or the "description" you output—**no** invented accessories, era/brand backstory, mood adjectives unrelated to materials, or "hero story" filler. Prefer a **tight** prompt over a long one.
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**
Each object containing:
- name: Prop Name
- type: Type (e.g., Weapon/Key Item/Daily Item/Special Device)
- description: Role in the drama and visual description
- image_prompt: English hero product shot prompt (single prop, solid seamless backdrop, no clutter, no environment, soft studio light, tight wording, no names/places from script, ultra-detailed only where visually grounded)`;
  }
  const _propLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名、归属可写在此字段，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；**禁止**剧本人名/地名/组织名/台词/剧情标签；只写有依据的外观词，**不脑补、不扩写**；中文项目输出中文提示词并匹配项目「语音」与尺度铁律）`;
  const _propOverride = _overrideCache['prop_extraction'];
  if (_propOverride) {
    return _propOverride + _propLocked;
  }
  return `你是一位专业的剧本道具分析师，擅长从剧本中提取具有视觉特征的关键道具。

你的任务是根据提供的剧本内容，提取并整理所有对剧情有重要作用或有特殊视觉特征的关键道具。

要求：
1. 只提取对剧情发展有重要作用、或有特殊视觉特征的关键道具。
2. 普通的生活用品（如普通的杯子、笔）如果无特殊剧情意义不需要提取。
3. 若道具有明确归属者，**仅**写在 "description" 中（可用中文人名）；**禁止**在 "image_prompt" 中出现任何角色名、昵称、称谓或人际关系用语。
4. **description 字段强制纯中文**：必须输出**纯中文、80-150字**的详细视觉外观描述 + 该道具在剧中的核心作用/归属/剧情功能。必须严格遵循本项目一贯的中文影视提示词「语音」：融入符合道具所属时代的真实物理尺度意识、材质工艺细节、磨损痕迹、柔和棚拍光质感、电影化构图暗示。严禁任何英文单词/句子，严禁只写剧情不写可用于画图的外观细节，严禁空泛或翻译腔。
5. "image_prompt" 按项目语言撰写（**中文项目必须输出纯中文提示词**、英文项目用英文），按**影视资产库 / 电商主图级**单道具产品照标准：写清轮廓、材质、颜色、磨损与工艺细节、体量感。必须完整匹配项目中文影视提示词「语音」（融入真实尺度铁律、次要道具原则、电影化细节、纯色无缝背景、柔和均匀棚光）。
6. "image_prompt" 中**必须**写明：**单一无缝纯色棚拍背景**（哑光、无渐变）、**画面中仅有该道具一个主体**、**柔和均匀的棚拍光**（便于看清细节，避免电影化强反差光），并**明确禁止**：人物、手、家具、地面/台面、室内外环境、散落杂物、其他道具、文字商标、包装（除非该道具本身就是包装）、烟尘粒子等任何多余元素。
7. **image_prompt 禁止泄漏剧本特征**：不得出现剧本人名、地名、组织名、台词、情节梗专有称呼等；一律改写为**泛化视觉描述**（如用 "刻有细小铭文" 而非具体人名）。**唯一例外**：文字**实体印/刻在道具表面**且剧本明确要求还原该字样时，可保留该可见字样；否则用泛化描述。
8. **image_prompt 严格不扩展**：只写剧本与你在本对象 "description" 中已交代、且**肉眼可见**的外观信息；禁止凭空增加配饰、品牌故事、时代煽情形容词、叙事性铺垫；宁可**短而准**，不要为凑字数扩写。必须自然融入「符合时代的真实物理比例」等项目铁律。
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**
每个对象包含：
- name: 道具名称
- type: 类型 (如：武器/关键证物/日常用品/特殊装置)
- description: **纯中文**的在剧中的作用 + 详细视觉外观描述（必须80-150字，严格遵循项目中文提示词语音：真实尺度、次要元素、电影化细节等）
- image_prompt: **纯中文**（中文项目）单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；融入项目真实尺度铁律与次要道具语音；无剧本人名地名等；只写有依据的外观词，简练不扩写）`;
}

function getSceneExtractionPrompt(cfg, style) {
  const styleText = (style || '').toString().trim();
  const s = styleText || styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `[Task] Extract all unique scene backgrounds from the script

[Requirements]
1. Identify all different scenes (location + time combinations) in the script
2. Generate detailed **English** image generation prompts for each scene
3. **Important**: Scene descriptions must be **pure backgrounds** without any characters, people, or actions
4. Prompt requirements:
   - Must use **English**, no Chinese characters
   - Detailed description of scene, time, atmosphere, style
   - Must explicitly specify "no people, no characters, empty scene"
   - **Style Requirement**: ${s}
   - **Image Ratio**: ${imageRatio}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks. Start directly with [ and end with ].**
Each element: location, time, prompt (English image generation prompt for pure background).`;
  }
  const _sceneLocked = `\n5. **风格要求**：${s}\n   - **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
  const _sceneOverride = _overrideCache['scene_extraction'];
  if (_sceneOverride) {
    return _sceneOverride + _sceneLocked;
  }
  return `【任务】从剧本中提取所有唯一的场景背景

【要求】
1. 识别剧本中所有不同的场景（地点+时间组合）
2. 为每个场景生成详细的**中文**图片生成提示词（Prompt）
3. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素
4. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）
5. **风格要求**：${s}
   - **图片比例**：${imageRatio}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**
每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
}

/**
 * 故事扩展：根据梗概生成短片剧本正文（中英文系统提示词）
 */
function getStoryExpansionSystemPrompt(cfg, episodeCount) {
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回一个 JSON 数组，包含 ${n} 个对象，每个对象格式如下：\n[\n  {\n    "episode": 1,\n    "title": "第一集标题（5-10字，概括本集核心内容）",\n    "content": "本集剧本正文（约800字）"\n  }\n]\n**必须只返回纯 JSON 数组，不要任何 markdown 代码块、说明文字。直接以 [ 开头，以 ] 结尾。**`;
  if (isEnglish(cfg)) {
    const enNote = `\n\n**Output format (STRICTLY required)**:\nReturn a JSON array with ${n} object(s), each in this format:\n[\n  {\n    "episode": 1,\n    "title": "Episode title (5-15 words)",\n    "content": "Episode script body (~800 words)"\n  }\n]\n**Return ONLY the JSON array. No markdown, no explanation. Start directly with [ and end with ].**`;
    return `You are a professional screenwriter. Your task is to expand the user's story premise into ${n} episode(s) of a short-film script.

Requirements:
1. Write in clear, fluent English suitable for later storyboard breakdown.
2. Include scene descriptions, character actions and dialogue. Do NOT use shot numbers, "INT./EXT." headings, or screenplay formatting marks.
3. Each episode: approximately 800 words. Episodes must be connected in story continuity — each episode picks up from where the previous one ended.
4. Each episode should have a clear beginning, development, and a hook or turning point at the end.${enNote}`;
  }
  const _storyOverride = _overrideCache['story_expansion_system'];
  const base = _storyOverride || `你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。

要求：
1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。
2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。
3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。
4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。`;
  return base + jsonNote;
}

const STORY_STYLE_LABELS = {
  en: { modern: 'Modern', ancient: 'Period/Ancient', fantasy: 'Fantasy', daily: 'Slice of life' },
  zh: { modern: '现代', ancient: '古风', fantasy: '奇幻', daily: '日常' },
};
const STORY_TYPE_LABELS = {
  en: { drama: 'Drama', comedy: 'Comedy', adventure: 'Adventure' },
  zh: { drama: '剧情', comedy: '喜剧', adventure: '冒险' },
};

/**
 * 故事扩展：构建用户侧提示（梗概 + 可选风格/类型/集数），中英文
 */
function buildStoryExpansionUserPrompt(cfg, premise, style, type, episodeCount) {
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const styleLabels = STORY_STYLE_LABELS[lang];
  const typeLabels = STORY_TYPE_LABELS[lang];
  if (lang === 'en') {
    let prompt = `Please create ${n} episode(s) of a short-film script based on the following story premise:\n\n${premise}`;
    if (style && styleLabels[style]) {
      prompt += `\n\nStyle: ${styleLabels[style]}`;
    }
    if (type && typeLabels[type]) {
      prompt += `\nGenre: ${typeLabels[type]}`;
    }
    if (n > 1) {
      prompt += `\nEpisodes: ${n}`;
    }
    return prompt;
  }
  let prompt = `请根据以下故事梗概，创作 ${n} 集短片剧本：\n\n${premise}`;
  if (style && styleLabels[style]) {
    prompt += `\n\n故事风格：${styleLabels[style]}`;
  }
  if (type && typeLabels[type]) {
    prompt += `\n剧本类型：${typeLabels[type]}`;
  }
  if (n > 1) {
    prompt += `\n生成集数：${n} 集`;
  }
  return prompt;
}

/**
 * 返回指定提示词 key 的可编辑默认正文（中文，不含动态锁定部分）。
 * promptOverrides.js 调用此函数，确保 UI 展示的内容与 promptI18n.js 始终一致。
 */
function getDefaultPromptBody(key) {
  switch (key) {
    case 'story_expansion_system':
      return '你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。\n\n要求：\n1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。\n2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。\n3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。\n4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。';

    case 'storyboard_system':
      return '【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。\n\n【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。\n\n【分镜拆解原则】\n1. **动作单元划分**：每个镜头必须对应一个完整且独立的动作\n   - 一个动作 = 一个镜头（角色站起来、走过去、说一句话、做一个反应表情等）\n   - 禁止合并多个动作（站起+走过去应拆分为2个镜头）\n\n2. **景别标准**（根据叙事需要选择）：\n   - 大远景：环境、氛围营造\n   - 远景：全身动作、空间关系\n   - 中景：交互对话、情感交流\n   - 近景：细节展示、情绪表达\n   - 特写：关键道具、强烈情绪\n\n3. **运镜要求**：\n   - 固定镜头：稳定聚焦于一个主体\n   - 推镜：接近主体，增强紧张感\n   - 拉镜：扩大视野，交代环境\n   - 摇镜：水平移动摄像机，空间转换\n   - 跟镜：跟随主体移动\n   - 移镜：摄像机与主体同向移动\n\n4. **情绪与强度标记**：\n   - emotion：简短描述（兴奋、悲伤、紧张、愉快等）\n   - emotion_intensity：用箭头表示情绪等级\n     * 极强 ↑↑↑ (3)：情绪高峰、高度紧张\n     * 强 ↑↑ (2)：情绪明显波动\n     * 中 ↑ (1)：情绪有所变化\n     * 平稳 → (0)：情绪不变\n     * 弱 ↓ (-1)：情绪回落\n\n【输出要求】\n1. 生成一个数组，每个元素是一个镜头，包含：\n   - shot_number：镜头号\n   - scene_description：场景（地点+时间，如"卧室内，早晨"）\n   - shot_type：景别（大远景/远景/中景/近景/特写）\n   - camera_angle：机位角度（平视/仰视/俯视/侧面/背面）\n   - camera_movement：运镜方式（static/推镜push/拉镜pull/横摇pan/纵摇tilt/跟镜tracking/升镜crane_up/降镜crane_dn/环绕orbit/手持handheld/变焦zoom/旋转roll/甩镜whip_pan/螺旋spiral/希区柯克hitchcock_zoom/子弹时间bullet_time/荷兰角dutch_angle_move/推轨复合dolly_track/升格环绕slowmo_orbit）（固定为默认，仅在节拍需要时选择运镜）\n   - action：动作描述\n   - result：动作完成后的画面结果\n   - dialogue：角色对话或旁白（如有）\n   - emotion：当前情绪\n   - emotion_intensity：情绪强度等级（3/2/1/0/-1）';

    case 'character_extraction':
      return '你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。\n\n**【语言要求】所有字段的值必须使用中文，禁止出现英文内容（role字段的值除外，固定为 main/supporting/minor）。**\n\n你的任务是根据提供的剧本内容，提取并整理剧中出现的所有有名字角色的设定。\n\n要求：\n1. 提取所有有名字的角色（忽略无名路人或背景角色）\n2. 对每个角色，提取以下信息（全部用中文填写）：\n   - name: 角色名字（中文）\n   - role: 角色类型，固定值之一：main / supporting / minor\n   - appearance: 外貌描述（中文，100-200字，包含性别、年龄、体型、面部特征、发型、服装风格等，不含任何场景或环境信息）\n   - description: 背景故事和角色关系（中文，50-100字）\n3. 主要角色外貌要详细，次要角色可以简化';

    case 'scene_extraction':
      return '【任务】从剧本中提取所有唯一的场景背景\n\n【要求】\n1. 识别剧本中所有不同的场景（地点+时间组合）\n2. 为每个场景生成详细的**中文**图片生成提示词（Prompt）\n3. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素\n4. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）';

    case 'prop_extraction':
      return '你是一位专业的剧本道具分析师，擅长从剧本中提取具有视觉特征的关键道具。\n\n你的任务是根据提供的剧本内容，提取并整理所有对剧情有重要作用或有特殊视觉特征的关键道具。\n\n要求：\n1. 只提取对剧情发展有重要作用、或有特殊视觉特征的关键道具。\n2. 普通的生活用品（如普通的杯子、笔）如果无特殊剧情意义不需要提取。\n3. 归属者、剧中人名等**只**写在 "description"，**不要**写进 "image_prompt"。\n4. "image_prompt" 按项目语言撰写（中文项目优先用中文），按「产品主图 / 资产白模照」标准撰写：只描述该道具本体（造型、材质、颜色、工艺与磨损），并强制纯色无缝棚拍背景、无场景无杂物。匹配项目中文提示词语音（融入真实尺度、次要元素原则）。\n5. "image_prompt" 须明确排除人物、手、家具、台面、其他物体与环境叙事元素。\n6. "image_prompt" **禁止**出现剧本人名、地名、组织名、台词、剧情专有词；用泛化视觉词替代，且**禁止无依据扩写**（不凭空加配饰、品牌叙事、煽情形容词）。';

    case 'storyboard_user_suffix':
      return '【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：\n1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪\n2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]\n3. **地点**：[场景完整描述+空间布局+环境细节]\n4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**\n5. **人物行为**：**详细动作描述**\n6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）\n7. **画面结果**：动作的即时后果+视觉细节+氛围变化\n8. **环境氛围**：光线质感+色调+声音环境+整体氛围\n9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；不要为单个片段设计背景音乐。sound_effect 只写现场环境声、动作音效、对白/旁白音色与口型同步要求\n10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）\n\n**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。\n**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。\n**duration时长**：综合对话、动作、情绪估算每镜时长（具体目标秒数由系统自动注入）。\n**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 须补充音色与情绪强度。';

    case 'first_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。\n\n核心规则：\n1. 聚焦初始静态状态 - 动作发生之前的那一瞬间，禁止包含任何动作或运动描述\n2. 描述角色在画面中的位置（画面左/中/右）、朝向（面向/背对/侧面）、初始姿态和表情\n3. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（根据景别选择）：\n- 三分法：主体置于三分线交点，稳定平衡，适合大多数叙事镜头\n- 框架构图：用门窗/树枝/栏杆形成自然画框，突出主体，增加纵深\n- 中心构图：对称庄重，适合特写和仪式感场景\n- 前景遮挡：前景虚化元素增加层次感\n\n光线设计（必须描述）：\n- 光源方向：左侧光/右侧光/顶光/逆光（轮廓光）/底光\n- 光线质感：硬光（强烈阴影，戏剧张力）/ 柔光（柔和过渡，自然温馨）\n- 色温：暖光（金黄/橙红，温暖怀旧）/ 冷光（蓝调/青白，冷漠疏离）\n\n景深设置：\n- 特写/近景：浅景深，背景虚化，突出人物情绪\n- 中景：中等景深，人物与环境均清晰\n- 远景/全景：深景深，前后均清晰，交代空间关系';

    case 'key_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的关键帧 - 捕捉动作最激烈、情绪最饱满的高潮瞬间。\n\n核心规则：\n1. 聚焦动作高潮时刻，最大化戏剧张力\n2. 捕捉情绪顶点，角色表情和肢体语言处于最强烈状态\n3. 可包含动态效果（动作模糊、视觉冲击感）\n4. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n5. 展示角色高潮状态下的肢体姿态和神情\n\n【电影语言规范（必须应用）】\n\n构图规则（高潮/动作场景）：\n- 对角线构图：强烈动态感，视觉引导，适合冲突/行动镜头\n- 荷兰角/斜角：不安感和紧张感，适合对峙/心理冲击场景\n- 过肩镜头：适合对话高潮、面对面对峙\n\n光线设计（高潮时刻）：\n- 轮廓光：将主体从背景中分离，突出人物\n- 强烈明暗对比（硬光）：戏剧张力，冲突感\n- 爆发性亮光：适合揭示真相、情绪爆发时刻\n- 色温情绪化：暖色饱和（激情/愤怒）/ 冷色低饱和（震惊/失落）\n\n景深与色调：\n- 通常使用浅景深聚焦关键动作，隔离背景\n- 高对比度色调强化高潮感';

    case 'last_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。\n\n核心规则：\n1. 聚焦动作完成后的最终静态状态\n2. 展示动作的可见结果和后果\n3. 描述角色在动作完成后的最终姿态、位置和情绪表情\n4. 强调情绪余韵：释然/平静/悲伤/胜利/遗憾\n5. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（收尾镜头）：\n- 通常用较宽的景别重建空间背景，或用紧镜头聚焦情绪收场\n- 留白构图：大面积空旷空间传递孤独/结束感\n- 呼应开场构图：收尾镜头可与首帧构图呼应，形成闭环\n\n光线设计（情绪余韵）：\n- 柔和暖光：事件解决后的温情/宽慰\n- 残留戏剧阴影：未解决的张力，悬念延续\n- 渐弱光线/冷调：失去/结束/遗憾的情绪\n- 色调整体偏暗或偏亮反映情绪归宿\n\n景深与氛围：\n- 情绪收场：浅景深，聚焦面部情绪细节\n- 结果展示：深景深，展示行动对环境/他人的影响';

    default:
      return '';
  }
}

/**
 * 返回指定提示词 key 的锁定后缀（供 UI 展示，动态字段用占位符替代）。
 */
function getLockedSuffix(key) {
  switch (key) {
    case 'story_expansion_system':
      return null;
    case 'storyboard_system':
      return '\n\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n\n【重要提示】\n- 镜头数量必须与剧本中的独立动作数量匹配（不允许合并或减少）\n- 每个镜头必须有明确的动作和结果\n- 景别选择必须符合叙事节奏（不要连续使用同一景别）\n- 情绪强度必须准确反映剧本氛围变化\n- 【角色一致性】每个镜头的characters列表必须与该镜头action/dialogue中实际描写的人物严格一致，不得把（在场景中存在但本镜头动作未涉及）的角色列入';
    case 'character_extraction':
      return getCharacterStageRule() + '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个元素是一个角色对象，包含上述字段。';
    case 'scene_extraction':
      return '\n5. **风格要求**：[当前剧集风格]\n   - **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。';
    case 'prop_extraction':
      return '\n- **风格要求**：[当前道具风格]\n- **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名归属可写此处，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色底、仅主体；无剧本人名地名等；简练、不扩写；中文项目用中文并匹配项目语音与真实尺度铁律）';
    case 'storyboard_user_suffix':
      return '\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters, is_primary。**必须只返回纯JSON，不要markdown。**';
    case 'first_frame_prompt':
    case 'key_frame_prompt':
    case 'last_frame_prompt':
      return '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）';
    default:
      return null;
  }
}

/**
 * 场景单图提示词生成：文本AI将场景描述转化为单图场景参考图提示词（非四宫格）
 */
function getScenePolishPromptSingle(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  return `# 场景单图参考图生成器

## 你的身份
你是专业的影视美术设计师，负责将场景描述转换为AI绘图标准单图场景参考图提示词（**非四宫格**）。

## 核心规则

### 提取与统一
- **单张连续画面**：生成一段完整、统一的场景描述，用于绘制**一张**图片
- **完整展示**：必须包含场景的全貌、主要建筑结构、地面材质、关键陈设、光线/时段、氛围
- **禁止出现**：角色、人物剪影、文字标注、水印、四宫格/分格/第1格/第2格等字样
- **真实可信**：建筑风格、材质、植被必须符合场景所属时代和地域${style ? '\n- **画风风格**：' + style : ''}

### 单图内容设计原则
- 用最宽/最合适的视角一次性展示整体空间关系，不遗漏边界
- 清晰呈现人物最常活动的区域（对话区/行动区）
- 突出最具场景辨识度的标志性细节
- 强调光线、材质、氛围的统一性

### 避免与生图侧重复
- **不要**写四宫格顺序、无人物、无文字水印等与版面/负面清单相关的长段说明（生图 API 会统一注入）；只写场景可视信息与完整画面内容

## 输出要求
直接输出一段连贯的场景描述文字，不要分段落标题，不要出现「第X格」字样。

${isEnglish(cfg) ? "OUTPUT LANGUAGE: Write all descriptions and section headings in English; translate the template headings above. Preserve character names and required technical labels." : "输出语言：所有描述使用中文，保留角色名及要求的技术标签。"}`;

}

function getSceneGridContract() {
  return `KSR SCENE 3×3 REFERENCE SHEET — mandatory layout and continuity contract (override any conflicting single illustration, poster, split-screen or 2×2 layout):
- Create ONE square photographic scene reference sheet in an exact 3×3 grid: nine equal panels, thin dark dividers, legible panel labels PANEL 01 through PANEL 09. No people, no characters, no silhouettes, no human shadows, no story action.
- Panel visual hooks: PANEL 01 WIDE ESTABLISHING (eye-level full space and boundaries); PANEL 02 MAIN ACTIVITY ZONE (usable standing/seating/action area, no people); PANEL 03 SIGNATURE MATERIAL DETAIL; PANEL 04 HIGH ANGLE showing layout; PANEL 05 LOW ANGLE showing vertical structure; PANEL 06 SIDE DEPTH VIEW / corridor or receding perspective; PANEL 07 ENTRANCE OR EDGE VIEW; PANEL 08 WEATHER / LIGHT CONDITION on architecture and materials; PANEL 09 REVERSE ANGLE looking back through the same space.
- All nine panels depict the same location and the same core concept. Preserve architecture, terrain, ground materials, key furnishings, props, vegetation, color palette, time of day, weather, light direction and color temperature; only camera height, focal length and viewing angle may change.
- PHOTO TONE must be handled as one unified description: light quality, source, direction, atmosphere, contrast and palette remain consistent across panels. Use absolute visual language; no vague "maybe", "approximately", or "seems like".
- MATERIAL TRUTH: describe the physical behavior of every material, such as rough stone, polished metal, damp wood, dusty plaster, weathered brick, reflective glass, dry soil or worn fabric. Integrate color codes into descriptive prose rather than listing a separate swatch strip.
- AVOID instructions must be specific to this location and grouped by SPACE / MATERIAL / LIGHT / FORMAT: no wrong era, no architectural mismatch, no duplicated room layout, no warm/cool color-temperature jump, no people, no random text, no logo, no watermark, no tenth panel, no poster crop, no unequal panel size.`;
}

/**
 * KSR 场景九宫格提示词生成：文本 AI 将场景描述转化为 3×3 多角度场景参考图提示词。
 */
function getScenePolishPrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  return `# KSR 场景九宫格参考图提示词生成器

## 你的身份
你是专业影视美术指导、场景概念设计师与 GPT Image 提示词作者，负责把场景信息转换为严格的 **3×3 九宫格多角度场景参考图**。它用于后续分镜空间、色调、材质和光影一致性，不是单张插画、海报或剧情截图。

## 核心原则

### 参考图 4 原则
- **色卡融入叙述**：保留明确色号，但要写成“灰褐色石墙 #B5B0A8”这类材质描述，不单独列色卡表。
- **PHOTO TONE 一段压完**：光源、方向、色温、天气、空气感、反差和氛围必须集中成一段完整描述，九个面板统一遵守。
- **AVOID 精简且场景特定**：否定项按 SPACE / MATERIAL / LIGHT / FORMAT 分组，只写本场景真实可能犯的错误，不堆通用否定词。
- **MATERIAL TRUTH**：每种关键材质写清物理状态，例如粗糙、光滑、湿润、风化、锈蚀、磨损、积灰、反光或哑光。

### 九宫格 4 原则
- **panel 视觉钩子**：每个面板用 1–2 句话锚定该角度最重要的空间或材质重点。
- **色卡统一 PRESERVE**：九个面板色温和材质颜色一致，不许面板之间跳色。
- **贯穿核心概念**：九格围绕同一个地点、同一时代、同一空间功能、同一光线条件展开。
- **绝对语言**：用确定的画面语言，不写“可能、大约、似乎、类似”。

### 统一与限制
- 九个面板必须是同一场景：建筑结构、地形、地面材质、主要陈设、标志物、植被、天气、时段和光源方向完全连续。
- 只允许改变机位高度、焦距、观察方向和景别；不允许把场景改成另一个房间或另一个时间。
- 禁止人物、角色、人影、剧情动作、字幕、水印、logo、随机文字、额外第 10 格。
- 建筑、道具、植被和材质必须符合时代与地域；不要凭空加入现代物件。
- 每个面板都要有明确镜头用途，避免九格只是重复构图。${style ? '\n- **画风风格（只影响渲染质感，不改变九宫格版式）**：' + style : ''}

## 九宫格固定内容

| 面板 | 标签 | 内容 |
|------|------|------|
| 1 | PANEL 01 WIDE ESTABLISHING | 平视全景建立镜头，完整交代空间边界、地形/建筑轮廓和整体色调 |
| 2 | PANEL 02 MAIN ACTIVITY ZONE | 主要活动区域中景，展示可站立/对话/行动的空间、地面和关键陈设，但不出现人物 |
| 3 | PANEL 03 SIGNATURE MATERIAL DETAIL | 最具辨识度的材质或建筑部件特写，写清纹理、磨损、颜色和物理状态 |
| 4 | PANEL 04 HIGH ANGLE | 高角度/微俯视角，展示平面布局、动线和空间关系 |
| 5 | PANEL 05 LOW ANGLE | 低角度，展示梁柱、屋顶、山体、高楼等垂直结构与尺度 |
| 6 | PANEL 06 SIDE DEPTH VIEW | 侧面纵深视角，利用走廊、街道、林间、门洞或家具排列表现透视 |
| 7 | PANEL 07 ENTRANCE OR EDGE | 入口、边界、窗洞、河岸、门口或场景边缘，交代内外关系 |
| 8 | PANEL 08 WEATHER / LIGHT CONDITION | 同一光线与天气如何落在建筑/材质上：雾、雨痕、灰尘、光斑、阴影等 |
| 9 | PANEL 09 REVERSE ANGLE | 反向机位回看同一空间，验证背向结构、出口和空间连续性 |

## 时代场景匹配表

| 类型 | 场景风格 |
|------|---------|
| 古风/仙侠 | 中国古代建筑，青砖黑瓦，红柱彩梁，庭院回廊 |
| 武侠 | 江湖风貌，茶馆客栈，山野林间，镖局武馆 |
| 西幻/奇幻 | 欧洲中世纪石砌城堡、酒馆、森林、写实魔法痕迹 |
| 现代都市 | 现代建筑、办公室、咖啡厅、街道、居家空间 |

${getSceneGridContract()}

## 输出格式

【SCENE CORE】
地点名称、室内/室外/自然场景、时代地域、空间功能、核心视觉概念。

【COLOR / MATERIAL TRUTH】
用自然描述写清主要材质和色号：墙面、地面、金属、木材、织物、植被等，以及粗糙/光滑/湿润/风化等真实物理状态。

【PHOTO TONE】
一段话完整写清光源、方向、色温、天气、空气质感、反差和氛围；九个面板统一执行。

【PANEL 01 WIDE ESTABLISHING】
1–2 句具体画面钩子。

【PANEL 02 MAIN ACTIVITY ZONE】
1–2 句具体画面钩子。

【PANEL 03 SIGNATURE MATERIAL DETAIL】
1–2 句具体画面钩子。

【PANEL 04 HIGH ANGLE】
1–2 句具体画面钩子。

【PANEL 05 LOW ANGLE】
1–2 句具体画面钩子。

【PANEL 06 SIDE DEPTH VIEW】
1–2 句具体画面钩子。

【PANEL 07 ENTRANCE OR EDGE】
1–2 句具体画面钩子。

【PANEL 08 WEATHER / LIGHT CONDITION】
1–2 句具体画面钩子。

【PANEL 09 REVERSE ANGLE】
1–2 句具体画面钩子。

【AVOID】
按 SPACE / MATERIAL / LIGHT / FORMAT 四类列出本场景特定否定项，简短具体。

${isEnglish(cfg) ? "OUTPUT LANGUAGE: Write all descriptions and section headings in English; translate the template headings above. Preserve required technical labels." : "输出语言：所有描述使用中文，保留 PANEL 等技术标签。"}`;
}

/**
 * KSR 场景九宫格图片生成：图片 AI 的硬性 3×3 版式契约，画风由用户消息首部强调。
 */
function getSceneGenerateImagePrompt() {
  return `Scene environment reference sheet — image only, no text reply.

${getSceneGridContract()}

Use photorealistic location-reference quality unless the user prompt gives a different mandatory art style. Follow ART STYLE / 画风 / MANDATORY ART STYLE at the start of the user message when present, but never let it change the exact 3×3 layout, nine panel labels, continuity, no-people rule, or unified PHOTO TONE.`;
}


/**
 * 场景单图提示词生成：图片AI的system prompt（单图场景，非四宫格）
 */
function getSceneGenerateSingleImagePrompt() {
  return `Scene environment reference — image only, no text reply.

ONE single continuous image (no grid, no split panels, no collage).
Show the complete scene in one unified view: wide establishing shot capturing the full space, key architectural features, lighting, atmosphere, and environmental details.
No people: no characters, silhouettes, human shadows. No text/labels/watermarks/location lettering.
Follow ART STYLE / 画风 block at the start of the user message if present.`;
}

/**
 * KSR 角色四宫格：文本 AI 将角色外貌描述转化为 2×2 character sheet 绘图提示词。
 */
function getRoleAnatomyContract() {
  return `KSR 4-PANEL CHARACTER SHEET — mandatory layout, lighting and anatomy contract (override any conflicting portrait, poster, costume-sheet or multi-panel layout):
- Create ONE square photographic character sheet in an exact 2×2 grid with four equal panels, thin dark dividers, a legible title, and exact panel labels: top-left "FACE FRONT", top-right "FACE SIDE", bottom-left "BODY FRONT (NO FACE)", bottom-right "BACK". No extra panels, no collage, no environment portrait.
- TOP-LEFT FACE FRONT: direct frontal head-and-shoulders face portrait, identity-focused, eyes looking into camera, same age, makeup, hairstyle and facial identity as every other panel. TOP-RIGHT FACE SIDE: exact 90-degree left or right profile head-and-shoulders portrait; same person, same expression and lighting direction; not a three-quarter turn.
- BOTTOM-LEFT BODY FRONT (NO FACE): complete front full-body clothing and proportion reference; the facial features are deliberately absent by cropping above the eyes or placing the upper face outside the panel edge, while preserving the front-facing neck, torso, costume, arms, hands, legs and feet. Never turn this body into a back view.
- BOTTOM-RIGHT BACK: complete back full-body reference facing directly away, showing back of head, rear hairstyle, back collar/costume construction, heels and sole direction; no visible face, no looking over the shoulder.
- Keep the same character, outfit version, body proportions, scale, skin tone, hairstyle and material colors in all four panels. Align body scale and weight; never stretch or squash a figure to fill a panel. Human characters must have one head, one torso, two arms and two legs, coherent joints, correctly attached hands and feet, no missing, duplicated, fused or twisted limbs.
- Studio rule: every panel uses a seamless solid cool-gray cyclorama background #606570, one single 45-degree side-rim/back-rim light with cold steel-blue tone, no fill light, no warm key light, no colored environment and no projected scene. The pose must communicate the character's psychological state through concrete weight, spine, shoulder and hand placement; do not write abstract emotion in the image prompt.
- Printed title and the four exact panel labels are part of the requested reference sheet, not watermarks. No logo, no random text, no color-swatch strip, no fifth detail panel.`;
}

function getRolePolishPrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  return `# KSR 角色四宫格 Character Sheet 提示词生成器

## 你的身份
你是专业的影视角色视觉设计师与 GPT Image 提示词指导，负责把角色描述转换为严格的 **4-panel character sheet（2×2 四宫格角色参考图）**。成品用于后续角色一致性参考，不是单张环境立绘、海报、漫画分镜或贴纸拼贴。

## 核心规则

### 提取与限制
- **仅提取**：角色描述中明确的外貌与服装特征
- **严禁添加**：剧情场景、无关环境、对白、故事事件、无法画出的抽象评价
- **标志性装备**：仅当原文明确给出身份 DNA 物件时锚定；不得凭空添加武器、徽章、饰品或剧情道具
- **全版面一致**：四个面板必须是同一角色、同一年龄段、同一套装版本、同一妆面、同一发型与体型比例
- **时代匹配**：服装与发型必须符合作品类型所属时代背景${style ? '\n- **画风风格（须贯穿各栏描述，与下长生图侧画风块一致）**：' + style : ''}

### KSR 版式（强制）
- **精确 2×2 grid**，四个等大面板，细深色分割线，标题和面板标签清晰可读
- **上排左：FACE FRONT**：正面脸部头肩特写，正面朝向镜头，重点呈现五官、肤质、妆容、发型正面结构
- **上排右：FACE SIDE**：精确 90° 侧面脸部头肩特写，呈现鼻梁、唇线、下颌、耳后与发型侧面；必须与 FACE FRONT 是同一张脸
- **下排左：BODY FRONT (NO FACE)**：正面全身服装与比例参考，刻意不显示五官（可裁切到眼睛上方或让脸的上缘出画），但颈部、躯干、服装正面、双臂、双手、双腿和双脚必须完整
- **下排右：BACK**：背面全身，角色完全背对镜头，展示后脑发型、后领、背部裁片、服装背面、脚跟与鞋底方向
- **棚拍规则**：所有面板统一纯色冷灰无缝棚拍背景 **#606570**；单一 45° 侧逆光/轮廓光，冷钢蓝色调；**无填充光、无暖色主光、无环境光、无场景投影**
- **姿势=心理状态**：用具体重心、脊柱、肩膀、下巴、手部位置表现人物状态；不要写“自信”“温柔”“霸气”等抽象词
- **材质真实**：布料、金属、皮革、磨损、湿润、风化等必须写物理状态；颜色优先保留色号，并把色号自然融入描述
- **影视参考锚定**：可根据角色时代与类型补一个明确的影视/游戏视觉美学锚点；若原文风格不足，不要编造具体剧情道具

### 输出语言约束
- **禁止抽象形容**：禁止「俊美」「自信」「温柔」「气场强大」等无法直接画出的词
- **只用具象描述**：可视化物理特征

## 时代服装匹配表

| 类型 | 服装体系 |
|------|---------|
| 古风/仙侠/玄幻 | 中国古代汉服体系，交领右衽、广袖长袍 |
| 武侠 | 中国古代劲装体系，交领窄袖劲装 |
| 西幻/奇幻 | 欧洲中世纪服饰，束腰长袍、斗篷 |
| 现代都市 | 现代服装，T恤、衬衫、西装、连衣裙 |

## 抽象词汇转具象示例

| 禁用词 | 替换为 |
|-------|--------|
| 俊美/英俊 | 五官比例协调，鼻梁挺直 |
| 自信 | 重心落在后脚，下巴微抬，肩膀放松 |
| 温柔 | 眉毛弧度柔和，眼角微圆，肩颈放松 |

${getRoleAnatomyContract()}

## 输出格式

【TITLE】
标题文字：角色名 + CHARACTER SHEET

【PHOTO TONE / MATERIAL TRUTH】
一段话压完：#606570 冷灰棚拍背景、单一 45° 冷钢蓝侧逆光、无填充光；同时写清皮肤、布料、金属/皮革等材质的真实物理状态与保留色号。

【VISUAL ANCHOR】
一个符合角色时代/类型的影视或游戏美学锚点；没有依据时写“无额外影视锚点”。

【基础设定】
人物基础: 性别，年龄段，身高体型，肤色
五官: 眉形，眼型，瞳色，鼻型，唇形
表情: 中性、平静、可重复的证件照式表情
发型: 颜色，长度，质感，发型结构
服装: 款式名称，主色，材质，领型，袖型

【FACE FRONT｜上排左】
正面头肩特写：发际线到下颌、五官、妆面、正面发型与身份特征。

【FACE SIDE｜上排右】
90° 侧面头肩特写：鼻梁、唇线、下颌、耳朵、后脑与侧面发型；同一人。

【BODY FRONT (NO FACE)｜下排左】
正面全身但刻意无脸：颈部以下完整服装、肩胸腰胯、双臂双手、裤/裙、双腿双脚、材质与重心姿势。

【BACK｜下排右】
背面全身：后脑发型、后领、背部结构、下摆/裤线、鞋跟；完全背对，无脸。

【SIGNATURE DNA OBJECT｜可选】
仅在原文明确提供时，写标志性装备及其材质、磨损、佩戴方式；否则写“无”。

【AVOID】
按 FACE / BODY / LIGHT / FORMAT 四类写具体否定项，例如身份错面、肢体数量错误、现代材质错代、填充光、暖色光、单张海报、多出来的第五面板等；不要堆通用否定词。

${isEnglish(cfg) ? "OUTPUT LANGUAGE: Write all descriptions and section headings in English; translate the template headings above. Preserve character names and required technical labels." : "输出语言：所有描述使用中文，保留角色名及要求的技术标签。"}`;
}

/**
 * KSR 角色四宫格图片生成：图片 AI 的硬性版式契约，画风由用户消息首部强调。
 */
function getRoleGenerateImagePrompt() {
  return `KSR character reference sheet — image only, no text reply.

${getRoleAnatomyContract()}

Use photorealistic studio reference quality unless the user prompt gives a different mandatory art style. Follow ART STYLE / 画风 / MANDATORY ART STYLE at the start of the user message when present, but never let it change the exact four-panel layout, #606570 studio background, or cold 45-degree side-rim lighting.`;
}


/**
 * 分镜图片 prompt 二次优化：将分镜叙事描述转化为图片生成模型优化的 prompt
 * 供 imageService.js Step3.5 调用，结果回写 image_generations.prompt
 */
function getImagePolishPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are an expert image prompt engineer specializing in AI image generation for cinematic storyboards.

Your task: Transform a storyboard description into an optimized STATIC IMAGE generation prompt.

CRITICAL RULES:
1. Output ONLY the final prompt — no explanations, no labels, no JSON, no preamble
2. STATIC SINGLE FRAME — describe ONE frozen millisecond only. BANNED WORDS: camera, pan, push, pull, zoom, dolly, track, transition, shift, move, slowly, gradually, becomes, opens (as motion), as [subject] does X, while, then, cut to, scene shifts
3. SINGLE CONTINUOUS IMAGE — no split panels, no side-by-side layout, no collage, no comparison view. All characters share one unified scene space
4. Length: 50–100 words
5. Structure: [Shot framing] + [Scene/environment] + [Characters' frozen poses/expressions] + [Lighting at this exact instant] + [Atmosphere] + [Style tokens]
6. Describe characters' POSE and EXPRESSION at peak moment — not their motion arc
7. Preserve character names exactly as listed in ASSETS (they are reference image anchors)
8. **Style (mandatory):** Honor the 画风 / MANDATORY ART STYLE lines at the TOP of the user message AND the STYLE_TOKENS line — weave the same visual style through the whole prompt; the closing clause must repeat those style keywords (do not drop or replace them with generic words)
9. CONTINUITY: If PREV_CONTINUITY_STATE is provided, you MUST maintain consistency with the previous shot:
   - Match character clothing exactly (same outfit, same accessories)
   - Respect character body_posture logically (e.g. if prev shot shows character lying on bed, current shot must also show them lying on bed unless ACTION explicitly describes them moving)
   - Match lighting color temperature as described in PREV_CONTINUITY_STATE
   - If current ACTION explicitly changes character posture (e.g. "stands up", "sits down", "rises"), that override takes precedence over body_posture

Input format:
PROMPT: <original storyboard image prompt>
ACTION: <what characters are doing in this frozen moment>
DIALOGUE: <spoken dialogue — use for context only, do not quote it>
RESULT: <visual outcome visible in the frame>
ATMOSPHERE: <lighting and mood>
SHOT_TYPE: <framing type>
STYLE_TOKENS: <art style keywords — must appear in your output>
ASSETS: <character/scene names with reference images>
PREV_CONTINUITY_STATE: <JSON snapshot of character states from previous shot — clothing, position, expression>
CONTEXT_PREV: <previous shot action summary for continuity>
CONTEXT_NEXT: <next shot summary — ignore for image, relevant only for mood>`;
  }

  // 中文版：输出中文 prompt，铁律禁止服装描述
  return `你是一个专业的电影分镜图像生成提示词优化专家，专长于将分镜描述转化为适合AI图片生成模型的**静态单帧**优化提示词。

你的任务：输出**仅最终中文 prompt**（直接给图片AI使用，无任何解释、无标签、无JSON、无前言）。

【核心严格规则】

1. **静态单帧画面**：只描述动作完成后的一个冻结瞬间。严禁任何动态/运动词语（推镜、拉镜、摇镜、移动、逐渐、然后、切到、while、as [subject] does 等）。

2. **单一连续完整画面**：无分割、无四宫格、无并列、无拼贴、无对比布局。所有角色共享同一统一空间。

3. 输出长度约 80-160 字中文，用中文逗号「，」自然流畅连接成一段提示词。

4. 推荐 5 层结构（不加“第X层”标签，直接用逗号拼接）：
   第1层-镜头设计：景别 + 机位角度 + 构图方式
   第2层-光线：光源方向 + 光线质感 + 色温
   第3层-内容焦点：角色（**仅固定身份特征**：脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄/性别等 + 结果姿态 + 情绪余韵） + 场景最终状态 + 关键道具位置
   第4层-氛围：情绪基调 + 色彩倾向 + 凝滞感/紧绷感
   第5层-视觉风格：必须完整重复用户消息顶部的画风词 + 电影分镜质感 + 图片比例 + 情绪收束

5. **角色外貌描述铁律（最高优先级，任何违反均视为失败）**：
   - 角色外貌**仅允许使用固定身份特征**（脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄性别等）。
   - **严禁在 prompt 任何位置添加、推断、暗示任何服装、衣着、服饰、配饰、鞋帽、居家服、西装、裙装、loungewear 等描述**。
   - 服装、穿着、配饰完全由参考图（ASSETS 中列出的角色参考图）决定，**文字提示词中绝不出现任何服装相关词汇**。
   - 只有当固定身份特征中本来就包含眼镜、疤痕、纹身等辨识标记时，才可极简提及；否则一律不提。

6. 严格保留 ASSETS 列表中的角色名称（它们是参考图锚点），格式示例：“李娟（圆脸、高鼻梁、短发、面容略带疲惫）”。

7. **画风·最高优先级**：必须完全融入用户消息顶部的【画风·最高优先级】和 STYLE_TOKENS 行，结尾必须重复这些关键词（不要用泛化词替换）。

8. **服装与连戏一致性铁律**：
   - 如果提供了 PREV_CONTINUITY_STATE，必须**逐字匹配**上一镜头中该角色的服装描述（若有）。
   - 当前 ACTION 未明确写明“换衣服/脱外套/换装”等动作，则**绝不改变或重新描述服装**。
   - 没有 PREV_CONTINUITY_STATE 时，**完全不在 prompt 中出现任何服装相关词**。
   - 参考图的视觉优先级永远高于文字描述。

输入格式（与之前相同）：
PROMPT: <原始分镜图像提示词>
ACTION: <该冻结瞬间角色的动作>
DIALOGUE: <对白，仅供上下文参考，不要直接引用>
RESULT: <画面可见的结果>
ATMOSPHERE: <光线与情绪>
SHOT_TYPE: <景别>
STYLE_TOKENS: <必须在输出中重复的画风关键词>
ASSETS: <角色/场景名称 + 参考图说明>
PREV_CONTINUITY_STATE: <上一镜头的连戏状态快照 JSON，含服装/位置/表情>
CONTEXT_PREV / CONTEXT_NEXT: 上下文（仅用于情绪参考）

请直接输出一段纯中文 prompt 文字。`;
}

/**
 * 全能模式（可灵 Omni-Video、火山即梦 Seedance 2.0 多图参考等）：模板 + 仅用 @图片1/@图片2…（与参考图顺序一致，不用 @姓名）
 */
function getUniversalOmniSegmentPrompt(cfg) {
  const specZh = getUniversalOmniMultiBeatFormatSpec(cfg);
  return `You write the main prompt for multi-reference video (e.g. Kling Omni-Video, Volcengine Seedance omnivideo) "片段描述" in ${isEnglish(cfg) ? 'English' : 'Chinese'}. Keep the fixed Chinese format labels and reference tokens unchanged.

The USER message includes MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS, SHOT_PACING_AND_POSITION, EPISODE_SCRIPT, NEIGHBOR_* detail, IMAGE_SLOT_MAP, LINE3_REQUIRED, STYLE_HINT, and storyboard fields.

FORBIDDEN output styles: SoulLens single-line (主体:/叙事动态:/[禁BGM]); @人物N as image tokens. Use ONLY the multi-beat block below — same as「全能分镜模式」batch storyboard output.
${specZh}

This is **one** API clip whose wall-clock length is TOTAL_CLIP_SECONDS. Split into **M** internal beats (子分镜, M = 1–8 you choose). Each beat = one line「分镜k： Tk秒:」. Sum of all Tk = TOTAL_CLIP_SECONDS exactly.

Output structure (no lines before or after this block):

Line 1 — exactly:
画面风格和类型: <comma-separated tags; MUST include 真人写实, 电影风格, 高清画质; MAY add STYLE_HINT / DRAMA_GENRE phrase>

Line 2 — exactly (M must match count of 分镜k lines):
生成一个由以下M个分镜组成的视频。

Line 3 — copy LINE3_REQUIRED from the USER message verbatim.

Lines 4 through (3+M) — for each k, one full line:
分镜k： Tk秒: <Rich cinematic ${isEnglish(cfg) ? 'English' : 'Chinese'} prose for this slice only: camera motion chain (≥2 moves when Tk≥3s), @图片N bindings per IMAGE_SLOT_MAP, light, emotion. Dialogue: …说："verbatim" or …："verbatim". No speech: 无对白。 Narration: 旁白（画面无声）："verbatim". Avoid static snapshot captions.>

DIALOGUE — CRITICAL (when USER message contains DIALOGUE_VERBATIM):
- Every line listed under「必须逐字出现在输出中的台词」MUST appear in some子分镜 line inside 「」, character-for-character (only spacing around @图片N may vary).
- NEVER replace dialogue with summaries like「他选择了一个亿」「说完台词」without the actual quoted words.
- Distribute lines across beats by story order; longer Tk beats that contain speech must include the full quoted line(s), not paraphrase.
- If DIALOGUE / DESCRIPTION【对话】/ VIDEO_PROMPT_对话段 / EPISODE_SCRIPT imply spoken lines, include them verbatim even when CURRENT_UNIVERSAL_SEGMENT omitted them.
- Silent shots: state silence explicitly; do not invent dialogue.

Reference images — CRITICAL (applies to every子分镜 line’s prose):
- Use ONLY IMAGE_SLOT_MAP tokens @图片1, @图片2, … (Arabic digits).
- Follow CHARACTER_IMAGE_BINDING. When @图片1 is 场景, never put character face/body/costume on @图片1; characters start at @图片2 as mapped.
- Spacing: ASCII space after each @图片N before following Chinese/Latin.
- No @姓名 as image token; no markdown.

Pacing & M selection (professional):
- Read SHOT_PACING_AND_POSITION, EPISODE_SCRIPT, NEIGHBOR_* , STORYBOARD FIELDS (movement, shot_type, dialogue density). Increase M for rapid reversals / climax / montage-like pressure; use M=1 for a single sustained long-take feel when the script implies it.
- Never change the **total** seconds: T1+…+TM must equal TOTAL_CLIP_SECONDS.

Scene reference layout — CRITICAL (when SCENE_REFERENCE_LAYOUT applies):
- Reference may be multi-panel; do NOT make the final video mimic grids. Each子分镜 line’s prose should reinforce: one continuous full frame, no split-screen collage in the delivered clip.

If CURRENT_UNIVERSAL_SEGMENT is non-empty, preserve narrative beats but rewrite to satisfy MULTI_BEAT_OUTPUT, duration sum, and IMAGE_SLOT_MAP.`;
}

/**
 * 全能片段「润色」模式：在 getUniversalOmniSegmentPrompt 的硬性格式与参考图规则之上，强化短剧叙事与上下文一致。
 */
function getUniversalOmniPolishPrompt(cfg) {
  return `${getUniversalOmniSegmentPrompt(cfg)}

ADDITIONAL_POLISH_MODE (short drama enhancement — still MUST obey MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS sum, IMAGE_SLOT_MAP, LINE3_REQUIRED above):
- You receive FULL_EPISODE_SCRIPT plus NEIGHBOR blocks and structured fields. Use them only for **continuity** and **information completeness**; do NOT invent plot absent from SCRIPT + STORYBOARD FIELDS + CURRENT omni draft.
- **Information parity**: every script-relevant fact must appear across the子分镜 lines (lines 4…3+M), without losing information when expanding; if the draft was an old SoulLens single-line, **rewrite** into this multi-beat block; keep the same facts and total seconds.
- **Re-polish / anti-stagnation**: USER may click polish repeatedly on the same draft. Each response MUST deliver **substantially rephrased** ${isEnglish(cfg) ? 'English' : 'Chinese'} on lines 1, 2 (if M changes), and all子分镜 body lines — same facts, same total seconds, same @图片 bindings, but **not** a copy-paste of CURRENT_OMNI_DRAFT except line 3 which must stay **character-identical** to LINE3_REQUIRED. If you would otherwise output nearly identical prose, deliberately vary verbs, clause order, and camera wording while preserving meaning.
- **Short drama rhythm**: vertical-drama density — stakes, micro-expressions, blocking, camera motion; distribute across beats when M>1.
- **Inner monologue & dialogue**: brief 心想 / 「」 only when supported by DIALOGUE / NARRATION / SCRIPT / draft. When DIALOGUE_VERBATIM is present, **every** listed line must remain verbatim in 「」 after polish; rephrase motion/camera text freely but **not** quoted dialogue.
- **Neighbors**: align entry/exit with NEIGHBOR_* ; no redundant retelling of the previous shot.
- Language: ${isEnglish(cfg) ? 'English' : 'Chinese'} for子分镜 prose; lines 1–3 format as in base prompt; M must match line 2 and match the count of「分镜k」lines.`;
}

/**
 * 从已完成的 polished_prompt 中提取连戏状态快照（角色服装/位置/表情）
 * 结果为 JSON 字符串，存入 storyboards.continuity_snapshot
 */
function getContinuitySnapshotPrompt() {
  return `You are a script supervisor (continuity analyst) for a film production.

Given a completed image generation prompt for a storyboard shot, extract a structured continuity state snapshot.

Output ONLY a valid JSON object — no explanations, no markdown fences.

JSON schema:
{
  "characters": {
    "<character_name>": {
      "screen_position": "<EXACT screen standing position for layout lock — e.g. 'left third of frame, facing camera', 'right side of frame standing behind table', 'center, slightly left of partner', 'far left background'. Include relative to other characters and camera. This is CRITICAL for position consistency between first/last frames and cross-shot continuity.>",
      "body_posture": "<BODY POSTURE only — e.g. 'lying on bed', 'sitting on edge of bed', 'standing', 'kneeling on floor', 'crouching'. NEVER write camera framing here (no 'close-up', 'extreme close-up', etc). If shot is close-up but context implies lying/sitting, infer from scene context>",
      "clothing": "<clothing description, e.g. 'white hanfu robe, loosened collar'>",
      "expression": "<facial expression, e.g. 'pained, eyes closed', 'tearful, concerned'>",
      "props": ["<prop1>", "<prop2>"]
    }
  },
  "lighting": "<color temperature and direction, e.g. 'warm amber sidelight from window'>",
  "location": "<scene location, e.g. 'ancient Chinese bedroom, daytime'>",
  "overall_composition": "<brief overall layout note e.g. 'two-shot, woman left, man right, medium wide framing'>"
}

Rules:
- Only include characters that are explicitly described in the prompt
- Keep each field concise (≤15 words)
- **screen_position is the MOST IMPORTANT field for solving "人物站位经常变"** — extract or infer precise left/center/right placement + relation to other characters/camera from the prompt description. If the prompt mentions "left", "right", "beside", "opposite", "in front of", use that. For first/last frame pairs this enables layout locking.
- body_posture MUST describe physical body state, NOT camera shot type. Infer from scene context if needed (e.g. bedroom scene + lying character → 'lying on bed')
- If a detail truly cannot be determined even by inference, use null

Input:
PROMPT: <the completed image generation prompt>
ASSETS: <character names present in this shot>`;
}

/**
 * 为单个分镜重新生成/优化 layout_description（空间布局与人物站位合同）
 * 专为首尾帧一致性 + 上下分镜连贯性设计
 */
function getRegenerateLayoutDescriptionPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are a professional film continuity supervisor and storyboard spatial designer.

Your task: Regenerate or optimize a precise, concise "layout_description" (spatial layout anchor / 画面布局锚点) for the CURRENT shot.

Core Requirements (HIGHEST PRIORITY):
1. Output ONLY the new layout_description text (1-2 short sentences, max ~120 characters). No explanations, no JSON, no labels.
2. Be extremely specific about screen positions: left/center/right third of frame, relative distances between characters, facing directions, relation to props/environment, overall composition (rule of thirds / center / frame etc.), and camera distance feel.
3. **Realistic physical scale awareness (MANDATORY)**: Explicitly state realistic sizes and proportions of major props that actually appear in the shot, matching the story's era/setting (e.g. ancient: writing desk ~75cm, scroll at normal size; modern: side table ~45cm). Never write phrases that would cause scale errors or anachronistic modern props in period settings.
4. **Cinematic breathing room for movement (MANDATORY)**: Reserve natural evolution space for the shot's declared camera_movement (push/pull/pan/handheld etc.). State that first/last frames must keep core character placement and realistic prop scales, but allow natural framing adjustments that result from the movement (e.g. slight tighter framing on push-in, slight handheld drift, natural entry/exit on pan). Goal: enable real dynamic video instead of near-static locked shots.
5. **Cross-shot continuity (CRITICAL)**: The new layout MUST form a natural, believable spatial continuation from PREV_LAYOUT (if provided) and must logically lead into NEXT_LAYOUT (if provided). Avoid sudden unexplained left-right flips or major repositioning of characters between adjacent shots unless the ACTION/RESULT of the current shot explicitly requires it.
6. The description must be directly usable as the highest-priority contract for first-frame and last-frame image generation (for models like Seedance 1.5 Pro), and must embed both realistic scale anchors AND movement breathing room to prevent prop drift and motion suppression in AI image/video generation.

Style: Professional, film-precise, actionable for AI image generators. Use Chinese if the project is Chinese, otherwise English.`;
  }
  return `你是一位专业的电影连戏监督与分镜空间设计师。

任务：为**当前分镜**重新生成或优化一个精确、简洁的「layout_description」（空间布局锚点 / 画面布局与人物站位合同）。

核心要求（最高优先级）：
1. **只输出新的 layout_description 文本**（1-2 句短句，总字数建议控制在 120 字以内）。不要任何解释、不要 JSON、不要前缀后缀。
2. 必须极度具体描述画面站位：画面左/中/右三分、人物间相对距离、朝向、与道具/环境的关系、整体构图方式（三分法/中心/框架等）、机位距离感。
3. **真实物体尺度意识（强制）**：必须明确写出主要道具的真实物理尺度与相对比例，且**必须符合剧本时代背景**（仅写本分镜实际出现的道具；古代场景示例：“木质案几位于右下前景，高度约75cm，书卷平放为正常尺寸，铜灯与茶具均为次要环境小物件，绝不夸大”）。严禁写出任何会导致比例失真的表述，**严禁写入与时代不符的现代道具**。
4. **运镜呼吸空间（强制）**：必须为本分镜的 movement（推/拉/摇/跟/手持等）预留自然演化空间。说明首尾帧在核心站位和真实尺度一致的前提下，允许根据 movement 进行取景微调（缓推可稍紧、手持可轻微晃动偏移、横摇可有自然进入/退出）。目标是让首尾帧支持真正动态的视频，而不是几乎定格。
5. **跨镜连贯性（铁律）**：新布局必须与「上一分镜的布局描述」形成自然延续，同时能引向下一分镜。除非 action/result 明确要求，否则严禁突然左右互换或大幅跳跃。
6. 该描述将作为首帧/尾帧生成的最高优先级合同（尤其适配 Seedance 等模型），必须同时包含真实尺度锚点 + 运镜演化空间，防止AI生图时道具比例漂移或运镜被锁死。

语气：专业、电影化、精确、可直接喂给图像 AI 使用。必须用中文输出。`;
}

/**
 * 角色视觉锚点提取：从 appearance 文本中提炼 6层结构化锚点 JSON
 * 供 characterGenerationService 调用，生成结果存入 identity_anchors 字段
 */
function getIdentityAnchorsPrompt() {
  return `You are a character visual analyst. Extract precise visual identity anchors from character appearance descriptions.

Output ONLY a valid JSON object with these exact 6 keys:
{
  "face_shape": "precise description of face/skull shape, jawline, cheekbones (e.g. oval face, sharp jawline, high cheekbones)",
  "facial_features": "eye shape+color+Hex, nose bridge+tip, lip thickness+shape (e.g. almond eyes #3D2B1F, straight nose, thin lips)",
  "unique_marks": "scars, moles, tattoos, birthmarks, distinctive features — or 'none'",
  "color_anchors": {
    "hair": "#HexCode (e.g. #1A0A00 for black, #C8A96E for blonde)",
    "eyes": "#HexCode",
    "skin": "#HexCode (e.g. #F5DEB3 for wheat, #FDDBB4 for fair)",
    "primary_outfit": "#HexCode of dominant clothing color"
  },
  "skin_texture": "skin tone description + texture (e.g. fair porcelain smooth, tanned slightly weathered)",
  "hair_style": "length + style + texture (e.g. shoulder-length wavy black hair with loose strands, short crew cut)"
}

Rules:
- Use Hex color codes for ALL color values — never use color names like "black" or "brown"
- Extract ONLY what is explicitly stated; infer Hex values from color descriptions
- Keep each field concise (1-2 sentences max)
- If information is missing for a field, write "unspecified"
- Output ONLY the JSON object, no markdown, no explanation`;
}

/**
 * 道具单视图图片提示词润色器
 * 将道具描述转换为精准的 AI 绘图提示词（单图，突出道具本体）
 */
function getPropPolishPrompt(cfg) {
  const styleZh = styleTextZhForPolish(cfg);
  const styleEn = styleTextEnForImage(cfg);
  if (isEnglish(cfg)) {
    return `# 道具图片提示词生成器

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级**英文生图提示词（供剧组道具库 / AI 参考单图使用）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终英文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用 **generic role-neutral** 措辞改写或删除（例如仅保留 "small engraved lettering" 而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律】- 违反即严重失败）
- **唯一主体 + 零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射在表面、渐变、纹理、室内外元素**。背景必须是单一哑光纯色（推荐与道具形成高对比的中性浅灰或中性深灰，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：brushed / matte / polished / micro-scratches）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光（large softbox, even illumination），仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- 禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}

### 输出格式
直接输出**一段**英文 prompt（约 **45–90 词**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内显式包含短语或等价表达：**single prop only**, **seamless solid-color studio backdrop**, **no extra objects**, **no people**, **no hands**, **no environment**；末尾再接画风：${styleEn ? styleEn + ' render style' : 'photorealistic product hero shot'}`;
  }

  // 中文版：根据项目「语音」（专业影视中文提示词风格 + 真实尺度铁律 + 次要元素原则）输出中文图生提示词
  return `# 道具图片提示词生成器（中文版）

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级中文生图提示词**（供剧组道具库 / AI 参考单图使用，匹配项目中文影视提示词语音与真实尺度铁律）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终中文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用泛化中性描述改写或删除（例如仅保留"刻有细小铭文"而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律 - 违反即严重失败】）
- **唯一主体 + 纯色零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（单一哑光纯色 seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射、渐变、纹理、室内外元素**。背景必须是与道具形成高对比的中性纯色（浅灰或深灰最佳，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”“放在地板上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。
- **真实物理尺度铁律（最高优先级）**：道具必须严格遵循其所属时代的真实世界物理尺寸与相对比例；道具在画面中为**严格次要环境元素**，严禁夸大、立起、成为主导视觉或破坏透视。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：拉丝/哑光/抛光/微细划痕）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光，仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- 禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}

### 输出格式
直接输出**一段**中文提示词（约 **45–90 字**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内自然包含以下关键约束的中文表述（或等价流畅说法）：单一主体、纯色无缝棚拍背景、无多余物体、无人物、无手、无环境；并融入真实尺度与次要元素要求；末尾再接画风：${styleZh ? styleZh + ' 渲染质感' : '写实产品主图质感'}`;
}

module.exports = {
  getLanguage,
  isEnglish,
  getCharacterExtractionPrompt,
  getPropExtractionPrompt,
  formatUserPrompt,
  getFirstFramePrompt,
  getKeyFramePrompt,
  getLastFramePrompt,
  getSceneExtractionPrompt,
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardUserPromptSuffix,
  getStoryboardNarrationExtraInstructions,
  getStoryExpansionSystemPrompt,
  buildStoryExpansionUserPrompt,
  getRolePolishPrompt,
  getRoleAnatomyContract,
  getRoleGenerateImagePrompt,
  getScenePolishPrompt,
  getSceneGridContract,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
  getImagePolishPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt,
  getIdentityAnchorsPrompt,
  getPropPolishPrompt,
  loadOverridesIntoCache,
  setOverrideInMemory,
  clearOverrideInMemory,
  getDefaultPromptBody,
  getLockedSuffix,
  getRegenerateLayoutDescriptionPrompt,
  getRealisticPhysicalScaleContract,
};
