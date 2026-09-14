// EdgeOne Pages 共享模块：笔记处理核心流程
// 存储：KV（原 D1+R2 的替代），图片以二进制存 KV（前端已压缩，单值 < 1MB）

import { kv, json } from './kv.js';
import { transcribe, reviseMarkdown } from './deepseek.js';
import { syncToFeishu, reviseFeishu, titleWithDate } from './feishu.js';

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
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(created));
  const note = {
    id,
    title: `笔记 · ${day}`,
    text: '',
    mime,
    status: 'pending',
    wiki_url: null,
    doc_id: null,
    image_block_id: null,
    error: null,
    created_at: created,
  };
  const store = kv(env);
  await store.put(`img_${id}`, bytes); // 原图（前端已压缩的高清 JPG）
  await saveNote(env, note);
  await pushId(env, id);
  return note;
}

// 识别 + 同步到飞书；任何一步失败都保留笔记为 pending 并记录错误，可重试
export async function processNote(env, id) {
  const store = kv(env);
  const note = await getNote(env, id);
  if (!note) throw new Error('笔记不存在');
  if (note.status === 'synced' && note.wiki_url) return { status: 'synced', wiki_url: note.wiki_url };

  const stored = await store.get(`img_${id}`, { type: 'arrayBuffer' });
  if (!stored) throw new Error('原图暂时无法读取');
  const bytes = stored;

  let result = null;
  if (!note.text?.trim()) {
    result = await transcribe(bytes, note.mime, env);
    note.text = result.markdown;
    note.title = result.title || note.title;
  }

  const filename = `note_${id}.jpg`;
  const synced = await syncToFeishu(env, bytes, note.mime, filename, note.text, note.title, note);
  note.doc_id = synced.doc_id;
  note.wiki_url = synced.wiki_url;
  note.image_block_id = synced.image_block_id;
  note.status = 'synced';
  note.error = null;
  await saveNote(env, note);
  return { status: 'synced', wiki_url: note.wiki_url };
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

export { titleWithDate };
