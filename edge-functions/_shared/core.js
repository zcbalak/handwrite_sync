// EdgeOne Pages 共享模块：笔记处理核心流程
// 存储：元数据 → KV（未绑定时 Blob 兜底）；原图 → Blob（单值上限 25MB）

import { kv, json } from './kv.js';
import { blob } from './blob.js';
import { transcribe, reviseMarkdown } from './deepseek.js';
import { syncToFeishu, reviseFeishu, titleWithDate, deleteFeishuDoc } from './feishu.js';

const cleanId = (uuid) => uuid.replace(/-/g, '');

export function newId() {
  return cleanId(crypto.randomUUID());
}

const listKey = 'list'; // 笔记 id 数组（最新在前），JSON 字符串

export async function listNotes(env) {
  const store = kv(env);
  const raw = await store.get(listKey);
  const ids = raw ? JSON.parse(raw) : [];
  const notes = [];
  for (const id of ids) {
    const value = await store.get(`note_${id}`, { type: 'json' });
    if (value) notes.push(value);
  }
  notes.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return notes;
}

async function pushId(env, id) {
  const store = kv(env);
  const raw = await store.get(listKey);
  const ids = raw ? JSON.parse(raw) : [];
  ids.unshift(id);
  await store.put(listKey, JSON.stringify(ids.slice(0, 200)));
}

export async function getNote(env, id) {
  const value = await kv(env).get(`note_${id}`, { type: 'json' });
  return value || null;
}

export async function saveNote(env, note) {
  await kv(env).put(`note_${note.id}`, JSON.stringify(note));
}

export async function createNote(env, bytes, mime, filename) {
  const id = newId();
  const created = new Date().toISOString();
  const note = {
    id,
    title: titleWithDate('笔记', created),
    text: '',
    mime,
    status: 'pending',
    wiki_url: null,
    doc_id: null,
    image_block_id: null,
    error: null,
    created_at: created,
  };
  const store = blob(env);
  await store.set(`img_${id}`, bytes); // 原图存 Blob（25MB 上限，无需压缩到 1MB 以内）
  await saveNote(env, note);
  await pushId(env, id);
  return note;
}

// 识别 + 同步到飞书；任何一步失败都保留笔记为 pending 并记录错误，可重试
export async function processNote(env, id) {
  const note = await getNote(env, id);
  if (!note) throw new Error('笔记不存在');
  if (note.status === 'synced' && note.wiki_url) return { status: 'synced', wiki_url: note.wiki_url };

  const stored = await blob(env).get(`img_${id}`, { type: 'arrayBuffer' });
  if (!stored) throw new Error('原图暂时无法读取');
  const bytes = stored;

  let result = null;
  if (!note.text?.trim()) {
    result = await transcribe(bytes, note.mime, env);
    note.text = result.markdown;
  }
  // 先用 DeepSeek 生成的标题（若有），再统一追加年月日后缀（幂等）
  note.title = titleWithDate(result?.title || note.title || '手写笔记', note.created_at || new Date().toISOString());

  const filename = `note_${id}.jpg`;
  try {
    const synced = await syncToFeishu(env, bytes, note.mime, filename, note.text, note.title, note);
    note.doc_id = synced.doc_id;
    note.wiki_url = synced.wiki_url;
    note.image_block_id = synced.image_block_id;
    note.status = 'synced';
    note.error = null;
    await saveNote(env, note);
    return { status: 'synced', wiki_url: note.wiki_url };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '同步失败';
    // 飞书文档已创建（即使后续步骤失败）→ partial「已同步，部分未同步」；否则 pending「待同步」
    note.status = note.doc_id ? 'partial' : 'pending';
    note.error = detail;
    await saveNote(env, note);
    return { status: note.status, error: detail, wiki_url: note.wiki_url || null };
  }
}

// 对话修改排版：DeepSeek 重排 Markdown -> 更新飞书（保留原图）-> 更新存储
export async function reviseNote(env, id, instruction) {
  const note = await getNote(env, id);
  if (!note) return { status: 404, body: json(404, { error: '笔记不存在' }) };
  if (note.status !== 'synced' || !note.doc_id || !note.image_block_id) {
    return { status: 409, body: json(409, { error: '请先将笔记同步到飞书' }) };
  }
  const edited = await reviseMarkdown(note.text, instruction, env);
  if (edited.markdown === note.text) {
    return { status: 200, body: json(200, { text: note.text, unchanged: true }) };
  }
  await reviseFeishu({ doc_id: note.doc_id, image_block_id: note.image_block_id }, edited.markdown, env);
  note.text = edited.markdown;
  await saveNote(env, note);
  return { status: 200, body: json(200, { text: edited.markdown }) };
}

// 删除笔记：syncFeishu=true 时先删飞书文档（失败则整体中止，本地不删）；
// 之后删除本地元数据与原图，并更新列表
export async function deleteNote(env, id, syncFeishu) {
  const note = await getNote(env, id);
  if (!note) throw new Error('笔记不存在');
  let feishuDeleted = false;
  if (syncFeishu) {
    feishuDeleted = await deleteFeishuDoc(note, env);
  }
  await kv(env).delete(`note_${id}`);
  await blob(env).delete(`img_${id}`);
  const store = kv(env);
  const raw = await store.get(listKey);
  const ids = raw ? JSON.parse(raw) : [];
  await store.put(listKey, JSON.stringify(ids.filter((x) => x !== id)));
  return { feishu_deleted: feishuDeleted };
}

export { titleWithDate };
