// CloudBase 云函数：笔记处理核心流程
// 存储：元数据 → 云数据库（集合 notes，doc._id = 笔记 id）；原图 → 云存储（object notes/<id>.jpg）

const cloud = require('@cloudbase/node-sdk');
const { transcribe, reviseMarkdown } = require('./deepseek');
const { syncToFeishu, reviseFeishu, titleWithDate } = require('./feishu');

function getApp() {
  // 本地测试可注入 globalThis.__TCB_APP__（内存 mock）
  if (globalThis.__TCB_APP__) return globalThis.__TCB_APP__;
  if (!getApp._app) getApp._app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
  return getApp._app;
}

function db() {
  return getApp().database();
}

const cleanId = (uuid) => uuid.replace(/-/g, '');

function newId() {
  return cleanId(crypto.randomUUID());
}

function toNote(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: _id };
}

async function listNotes(env) {
  const result = await db().collection('notes').orderBy('created_at', 'desc').limit(200).get();
  return (result.data || []).map(toNote);
}

async function getNote(env, id) {
  const result = await db().collection('notes').doc(id).get().catch(() => null);
  const doc = result?.data?.[0];
  return toNote(doc);
}

async function saveNote(env, note) {
  const { id, ...data } = note;
  await db().collection('notes').doc(id).set(data);
}

async function createNote(env, bytes, mime, filename) {
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
    image_file_id: null,
    error: null,
    created_at: created,
  };
  const uploaded = await getApp().uploadFile({ cloudPath: `notes/${id}.jpg`, fileContent: Buffer.from(bytes) });
  note.image_file_id = uploaded.fileID;
  await saveNote(env, note);
  return note;
}

async function readImage(note) {
  if (note.image_file_id) {
    const result = await getApp().downloadFile({ fileID: note.image_file_id });
    return result.fileContent;
  }
  return null;
}

// 识别 + 同步到飞书；任何一步失败都保留笔记为 pending 并记录错误，可重试
async function processNote(env, id) {
  const note = await getNote(env, id);
  if (!note) throw new Error('笔记不存在');
  if (note.status === 'synced' && note.wiki_url) return { status: 'synced', wiki_url: note.wiki_url };

  const bytes = await readImage(note);
  if (!bytes) throw new Error('原图暂时无法读取');

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
async function reviseNote(env, id, instruction) {
  const note = await getNote(env, id);
  if (!note) return { status: 404, body: JSON.stringify({ error: '笔记不存在' }) };
  if (note.status !== 'synced' || !note.doc_id || !note.image_block_id) {
    return { status: 409, body: JSON.stringify({ error: '请先将笔记同步到飞书' }) };
  }
  const edited = await reviseMarkdown(note.text, instruction, env);
  if (edited.markdown === note.text) {
    return { status: 200, body: JSON.stringify({ text: note.text, unchanged: true }) };
  }
  await reviseFeishu({ doc_id: note.doc_id, image_block_id: note.image_block_id }, edited.markdown, env);
  note.text = edited.markdown;
  await saveNote(env, note);
  return { status: 200, body: JSON.stringify({ text: edited.markdown }) };
}

module.exports = { newId, listNotes, getNote, saveNote, createNote, processNote, reviseNote, titleWithDate, __getApp: getApp };
