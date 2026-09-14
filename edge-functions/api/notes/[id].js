// 笔记详情 / 删除
import { json } from '../../_shared/kv.js';
import { getNote, deleteNote } from '../../_shared/core.js';

export async function onRequestGet(context) {
  const note = await getNote(context.env, context.params.id);
  if (!note) return json(404, { error: '笔记不存在' });
  return json(200, { note });
}

// 删除笔记；?sync=1 时同时删除飞书文档（先删飞书，成功后再删本地）
export async function onRequestDelete(context) {
  const url = new URL(context.request.url);
  const sync = url.searchParams.get('sync') === '1';
  try {
    const result = await deleteNote(context.env, context.params.id, sync);
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败，请重试';
    return json(message === '笔记不存在' ? 404 : 502, { error: message });
  }
}
