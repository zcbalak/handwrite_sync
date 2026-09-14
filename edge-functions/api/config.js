// 配置状态：只返回是否已配置（不返回任何密钥值）
import { checkAccess, json } from '../_shared/kv.js';

export async function onRequestGet(context) {
  const denied = checkAccess(context.env, context.request);
  const env = context.env;
  return json(200, {
    feishuConfigured: !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
    deepseekConfigured: !!env.DEEPSEEK_API_KEY,
    // 存储始终可用：KV 已绑定用 KV，未绑定自动用 Blob 兜底（Blob 零配置）
    kvConfigured: true,
    storageMode: env.NOTES_KV ? 'kv' : 'blob-fallback',
    accessRequired: !!env.ACCESS_CODE,
    accessOk: !denied,
  });
}
