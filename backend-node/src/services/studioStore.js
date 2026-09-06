const { randomUUID, createHash } = require('crypto');
const now = () => new Date().toISOString();
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const json = (value) => JSON.parse(JSON.stringify(value));
function hash(value) { return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }
function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) fail('金额必须是有效的非负数字');
  return Math.ceil(value * 1000000);
}
function project(db, id) {
  const row = db.prepare('SELECT * FROM studio_projects WHERE drama_id = ?').get(Number(id));
  if (!row) fail('项目不存在', 404);
  return { ...row, document: JSON.parse(row.document), settings: JSON.parse(row.settings) };
}
function ledger(db, id) {
  const tasks = db.prepare('SELECT * FROM studio_tasks WHERE drama_id = ? ORDER BY created_at DESC').all(Number(id));
  const committed = tasks.reduce((sum, t) => sum + (t.actual_micros ?? t.reserved_micros), 0);
  return { committed_micros: committed, remaining_micros: project(db, id).budget_micros - committed,
    tasks: tasks.map(t => ({ ...t, input: JSON.parse(t.input), config_snapshot: JSON.parse(t.config_snapshot), result: t.result ? JSON.parse(t.result) : null, usage: t.usage ? JSON.parse(t.usage) : null })) };
}
function emptyDocument(title = '我的第一部短片') {
  return { title, story: '', script: '', characters: [], scenes: [], shots: [], preview_approved: false, export_url: '' };
}
function validate(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('作品内容必须是对象');
  for (const k of ['title', 'story', 'script']) if (typeof doc[k] !== 'string' || doc[k].length > 24000) fail(`${k} 必须是文本且不超过24000字`);
  if (!doc.title.trim()) fail('请输入片名');
  for (const [key, max] of [['characters', 2], ['scenes', 2], ['shots', 6]]) {
    if (!Array.isArray(doc[key]) || doc[key].length > max) fail(`${key} 最多${max}项`);
    const ids = new Set();
    for (const item of doc[key]) {
      if (!item || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id)) fail(`${key} 的标识无效或重复`);
      ids.add(item.id);
      for (const [field, value] of Object.entries(item)) {
        if (typeof value === 'string' && value.length > 12000) fail(`${field} 文本过长`);
      }
    }
  }
  const characterIds = new Set(doc.characters.map(c => c.id));
  const sceneIds = new Set(doc.scenes.map(s => s.id));
  for (const c of doc.characters) if (typeof c.name !== 'string' || typeof c.appearance !== 'string' || typeof c.voice !== 'string') fail('角色需要姓名、外观服装和声音设定');
  for (const s of doc.scenes) if (typeof s.name !== 'string' || typeof s.description !== 'string') fail('场景需要名称与描述');
  let duration = 0;
  for (const s of doc.shots) {
    if (!Number.isFinite(s.duration) || s.duration < 4 || s.duration > 10) fail('单镜时长须为4–10秒');
    if (!sceneIds.has(s.scene) || !Array.isArray(s.characters) || s.characters.some(c => !characterIds.has(c))) fail('分镜引用了不存在的角色或场景');
    for (const key of ['description', 'dialogue', 'camera', 'image_prompt', 'video_prompt']) if (typeof s[key] !== 'string') fail(`分镜缺少${key}`);
    if (s.trim_in != null && (!Number.isFinite(s.trim_in) || s.trim_in < 0 || s.trim_in >= s.duration)) fail('入点超出镜头时长');
    if (s.trim_out != null && (!Number.isFinite(s.trim_out) || s.trim_out > s.duration || s.trim_out <= (s.trim_in || 0))) fail('出点超出镜头时长');
    if (s.volume != null && (!Number.isFinite(s.volume) || s.volume < 0 || s.volume > 2)) fail('音量须在0–2之间');
    duration += s.duration;
  }
  if (duration > 30) fail('首版短片总时长不能超过30秒');
  return doc;
}
function target(doc, key) {
  if (key === 'story') return { story: doc.story, script: doc.script };
  const [group, id] = String(key).split(':');
  if (!['characters', 'scenes', 'shots'].includes(group)) fail('请选择故事、角色、场景或单个分镜');
  const item = doc[group].find(x => x.id === id);
  if (!item) fail('修改对象不存在', 404);
  return item;
}
const editable = {
  story: ['story', 'script'], characters: ['name', 'appearance', 'voice', 'motivation'],
  scenes: ['name', 'description'], shots: ['description', 'dialogue', 'camera', 'image_prompt', 'video_prompt', 'duration', 'characters', 'scene', 'trim_in', 'trim_out', 'volume', 'enabled'],
};
function patchTarget(doc, key, changes) {
  const copy = json(doc), item = target(copy, key), group = key.split(':')[0];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('修改必须是对象');
  for (const [k, v] of Object.entries(changes)) {
    if (!editable[group].includes(k)) fail(`不能通过内容修改操作改动 ${k}`);
    item[k] = v;
  }
  if (key === 'story') Object.assign(copy, item);
  return validate(copy);
}
function impact(before, after) {
  const changed = (a, b, keys) => keys.some(k => hash(a?.[k] ?? null) !== hash(b?.[k] ?? null));
  const chars = before.characters.filter(c => changed(c, after.characters.find(x => x.id === c.id), ['name', 'appearance', 'voice', 'image'])).map(c => c.id);
  const scenes = before.scenes.filter(s => changed(s, after.scenes.find(x => x.id === s.id), ['name', 'description', 'image'])).map(s => s.id);
  const storyChanged = before.story !== after.story || before.script !== after.script;
  return after.shots.filter(s => storyChanged || chars.some(c => s.characters.includes(c)) || scenes.includes(s.scene) ||
    changed(before.shots.find(x => x.id === s.id), s, ['description', 'dialogue', 'camera', 'image_prompt', 'video_prompt', 'duration', 'characters', 'scene', 'image'])).map(s => s.id);
}
function save(db, id, revision, doc, reason, generatedTarget = null) {
  validate(doc);
  return db.transaction(() => {
    const p = project(db, id);
    if (p.revision !== revision) fail('内容已变化，请刷新后重新预览修改', 409);
    const next = json(doc);
    for (const shot of next.shots) {
      const old = p.document.shots.find(s => s.id === shot.id);
      if (old && shot.description !== old.description && shot.video_prompt === old.video_prompt) shot.video_prompt_needs_review = true;
      if (old && shot.video_prompt !== old.video_prompt) shot.video_prompt_needs_review = false;
    }
    const affected = impact(p.document, next);
    for (const s of next.shots) if (affected.includes(s.id)) s.stale = true;
    if (generatedTarget) {
      const item = target(next, generatedTarget);
      item.stale = false;
    }
    if (affected.length) next.preview_approved = false;
    if (hash(next.shots) !== hash(p.document.shots)) next.export_url = '';
    db.prepare('INSERT INTO studio_versions (drama_id, revision, document, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(Number(id), revision, JSON.stringify(p.document), reason, now());
    db.prepare('UPDATE studio_projects SET document = ?, revision = revision + 1 WHERE drama_id = ?').run(JSON.stringify(next), Number(id));
    sync(db, id, next);
    return { ...project(db, id), affected };
  })();
}
// Preserve the upstream project/asset tables: the classic workspace can inspect the same project.
function sync(db, id, doc) {
  const stamp = now();
  db.prepare('UPDATE dramas SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(doc.title, doc.story, stamp, Number(id));
  let ep = db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL LIMIT 1').get(Number(id));
  if (!ep) ep = { id: db.prepare("INSERT INTO episodes (drama_id, episode_number, title, created_at) VALUES (?, 1, ?, ?)").run(Number(id), doc.title, stamp).lastInsertRowid };
  db.prepare('UPDATE episodes SET script_content = ?, updated_at = ? WHERE id = ?').run(doc.script, stamp, ep.id);
  const mapping = { characters: {}, scenes: {} };
  // Stable IDs are kept separately from editable model content.
  const stored = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(Number(id));
  const meta = JSON.parse(stored.metadata || '{}');
  const map = meta.studio_ids || { characters: {}, scenes: {}, shots: {} };
  for (const c of doc.characters) {
    let cid = map.characters[c.id];
    if (!cid) cid = Number(db.prepare('INSERT INTO characters (drama_id, name, created_at) VALUES (?, ?, ?)').run(Number(id), c.name, stamp).lastInsertRowid);
    db.prepare('UPDATE characters SET name = ?, appearance = ?, voice_style = ?, local_path = ?, updated_at = ? WHERE id = ?').run(c.name, c.appearance, c.voice, c.image || null, stamp, cid);
    db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)').run(ep.id, cid);
    mapping.characters[c.id] = cid;
  }
  for (const s of doc.scenes) {
    let sid = map.scenes[s.id];
    if (!sid) sid = Number(db.prepare('INSERT INTO scenes (drama_id, episode_id, location, created_at) VALUES (?, ?, ?, ?)').run(Number(id), ep.id, s.name, stamp).lastInsertRowid);
    db.prepare('UPDATE scenes SET location = ?, prompt = ?, local_path = ?, updated_at = ? WHERE id = ?').run(s.name, s.description, s.image || null, stamp, sid);
    mapping.scenes[s.id] = sid;
  }
  const shots = {};
  for (const [index, s] of doc.shots.entries()) {
    let sid = map.shots[s.id];
    if (!sid) sid = Number(db.prepare('INSERT INTO storyboards (episode_id, storyboard_number, created_at) VALUES (?, ?, ?)').run(ep.id, index + 1, stamp).lastInsertRowid);
    db.prepare('UPDATE storyboards SET storyboard_number=?, scene_id=?, description=?, dialogue=?, movement=?, duration=?, image_prompt=?, video_prompt=?, characters=?, local_path=?, video_url=?, updated_at=? WHERE id=?').run(index+1, mapping.scenes[s.scene], s.description, s.dialogue, s.camera, s.duration, s.image_prompt, s.video_prompt, JSON.stringify(s.characters.map(c => mapping.characters[c])), s.image || null, s.video ? '/static/' + s.video : null, stamp, sid);
    shots[s.id] = sid;
  }
  for (const group of ['characters', 'scenes', 'shots']) for (const [key, rowId] of Object.entries(map[group])) {
    if (!(group === 'shots' ? shots : mapping[group])[key]) db.prepare(`UPDATE ${group === 'shots' ? 'storyboards' : group} SET deleted_at=? WHERE id=?`).run(stamp, rowId);
  }
  meta.studio_ids = { ...mapping, shots };
  db.prepare('UPDATE dramas SET metadata=? WHERE id=?').run(JSON.stringify(meta), Number(id));
}
function reserve(db, id, key, kind, targetKey, input, snapshot, amount) {
  if (!/^[\w-]{8,100}$/.test(key || '')) fail('缺少有效的请求标识');
  if (!Number.isSafeInteger(amount) || amount < 0) fail('预算估算无效');
  const fingerprint = hash({ kind, targetKey, input, snapshot });
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM studio_tasks WHERE drama_id=? AND request_key=?').get(Number(id), key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('请求标识已用于其他参数，请刷新后重试', 409);
      return { ...previous, duplicate: true };
    }
    const pending = db.prepare("SELECT id FROM studio_tasks WHERE drama_id=? AND kind=? AND target=? AND state IN ('reserved','running','unknown','polling')").get(Number(id), kind, targetKey);
    if (pending) fail('该对象有未结束的任务，请查询原任务或对账，不要重复提交', 409);
    if (ledger(db, id).remaining_micros < amount) fail('预算不足：已停止提交，请缩短作品或减少重生成', 402);
    const taskId = randomUUID(), stamp = now();
    db.prepare(`INSERT INTO studio_tasks (id,drama_id,request_key,fingerprint,kind,target,state,reserved_micros,config_snapshot,input,created_at,updated_at) VALUES (?,?,?,?,?,?,'reserved',?,?,?,?,?)`).run(taskId,Number(id),key,fingerprint,kind,targetKey,amount,JSON.stringify(snapshot),JSON.stringify(input),stamp,stamp);
    return db.prepare('SELECT * FROM studio_tasks WHERE id=?').get(taskId);
  })();
}
function updateTask(db, id, values) {
  const allowed = ['state','provider_task_id','result','usage','actual_micros','error','reconciliation_note'];
  for (const k of Object.keys(values)) if (!allowed.includes(k)) fail('无效任务字段');
  db.prepare(`UPDATE studio_tasks SET ${Object.keys(values).map(k => k+'=?').join(',')}, updated_at=? WHERE id=?`).run(...Object.values(values).map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v), now(), id);
}
module.exports = { now, fail, hash, money, json, project, ledger, emptyDocument, validate, target, patchTarget, impact, save, sync, reserve, updateTask };
