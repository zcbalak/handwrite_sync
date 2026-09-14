// 配置状态：只返回是否已配置（不返回任何密钥值）
import { checkAccess, json } from '../_shared/kv.js';

export async function onRequestGet(context) {
  const denied = checkAccess(context.env, context.request);
  const env = context.env;
  return json(200, {
    feishuConfigured: !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
    deepseekConfigured: !!env.DEEPSEEK_API_KEY,
    kvConfigured: !!(globalThis.NOTES_KV || env.NOTES_KV),
    accessRequired: !!env.ACCESS_CODE,
    accessOk: !denied,
  });
}
