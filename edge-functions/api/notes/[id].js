// 笔记详情
import { checkAccess, json } from '../../_shared/kv.js';
import { getNote } from '../../_shared/core.js';

export async function onRequestGet(context) {
  const denied = checkAccess(context.env, context.request);
  if (denied) return json(401, denied);
  const note = await getNote(context.env, context.params.id);
  if (!note) return json(404, { error: '笔记不存在' });
  return json(200, { note });
}
