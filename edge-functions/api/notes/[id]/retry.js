// 重新同步到飞书
import { json } from '../../../_shared/kv.js';
import { getNote, processNote } from '../../../_shared/core.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const note = await getNote(context.env, id);
  if (!note) return json(404, { error: '笔记不存在' });
  try {
    const result = await processNote(context.env, id);
    return json(200, result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '同步失败';
    note.error = detail;
    note.status = 'pending';
    await saveNote(context.env, note);
    return json(202, { status: 'pending', error: detail });
  }
}

import { saveNote } from '../../../_shared/core.js';
