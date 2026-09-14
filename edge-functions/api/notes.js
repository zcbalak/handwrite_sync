// 笔记列表 / 上传新笔记
import { json } from '../_shared/kv.js';
import { createNote, listNotes, processNote } from '../_shared/core.js';
import { readBody, base64ToBytes } from '../_shared/body.js';

export async function onRequestGet(context) {
  try {
    const notes = await listNotes(context.env);
    return json(200, { notes });
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '笔记暂时无法读取' });
  }
}

export async function onRequestPost(context) {
  // 请求体统一走 text() + 手动解析，规避运行时缺失的 json()/formData()/atob/File
  let payload;
  try {
    payload = JSON.parse(await readBody(context.request));
  } catch {
    return json(400, { error: '无法读取上传的图片' });
  }
  const match = /^data:([^;,]+);base64,(.+)$/.exec(payload.image || '');
  if (!match) return json(400, { error: '无法读取上传的图片' });
  const mime = match[1];
  const bytes = base64ToBytes(match[2]);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    return json(400, { error: '请上传 JPG、PNG 或 WebP 图片' });
  }
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
    return json(400, { error: '图片需要小于 10 MB' });
  }
  const filename = (payload.filename || 'note.jpg').replace(/[^a-zA-Z0-9._-]/g, '_') || 'note.jpg';
  try {
    const note = await createNote(context.env, bytes, mime, filename);
    try {
      const result = await processNote(context.env, note.id);
      return json(200, { id: note.id, ...result });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '同步失败';
      note.status = 'pending';
      note.error = detail;
      await saveNote(context.env, note);
      return json(200, { id: note.id, status: 'pending', error: detail });
    }
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '照片保存失败，请重试' });
  }
}

import { saveNote } from '../_shared/core.js';
