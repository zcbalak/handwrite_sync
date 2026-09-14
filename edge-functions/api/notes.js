// 笔记列表 / 上传新笔记
import { checkAccess, json } from '../_shared/kv.js';
import { createNote, listNotes, processNote } from '../_shared/core.js';

export async function onRequestGet(context) {
  const denied = checkAccess(context.env, context.request);
  if (denied) return json(401, denied);
  try {
    const notes = await listNotes(context.env);
    return json(200, { notes });
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '笔记暂时无法读取' });
  }
}

export async function onRequestPost(context) {
  const denied = checkAccess(context.env, context.request);
  if (denied) return json(401, denied);
  let file;
  try {
    const ct = context.request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const payload = await context.request.json();
      const match = /^data:([^;,]+);base64,(.+)$/.exec(payload.image || '');
      if (match) {
        const binary = atob(match[2]);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        file = new File([bytes], (payload.filename || 'note.jpg').replace(/[^a-zA-Z0-9._-]/g, '_') || 'note.jpg', { type: match[1] });
      }
    }
    if (!file) file = (await context.request.formData()).get('image');
  } catch {
    return json(400, { error: '无法读取上传的图片' });
  }
  if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return json(400, { error: '请上传 JPG、PNG 或 WebP 图片' });
  }
  if (file.size === 0 || file.size > 10 * 1024 * 1024) {
    return json(400, { error: '图片需要小于 10 MB' });
  }
  const bytes = await file.arrayBuffer();
  const filename = (file.name || 'note.jpg').replace(/[^a-zA-Z0-9._-]/g, '_') || 'note.jpg';
  try {
    const note = await createNote(context.env, bytes, file.type, filename);
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
