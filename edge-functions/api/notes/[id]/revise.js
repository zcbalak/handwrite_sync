// 对话修改排版
import { checkAccess, json } from '../../../_shared/kv.js';
import { reviseNote } from '../../../_shared/core.js';

export async function onRequestPost(context) {
  const denied = checkAccess(context.env, context.request);
  if (denied) return json(401, denied);
  const body = await context.request.json().catch(() => null);
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction || instruction.length > 1000) {
    return json(400, { error: '请输入 1–1000 字的修改要求' });
  }
  try {
    const result = await reviseNote(context.env, context.params.id, instruction);
    return result.body;
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : '修改失败，请重试' });
  }
}
