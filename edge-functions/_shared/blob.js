// EdgeOne Pages 共享模块：Blob 存储访问
// 用途：存原图（单值上限 25MB，免审批、零配置即用）。
// KV 未绑定时，kv() 也会用 Blob 兜底存元数据，保证应用在 KV 审批通过前就能跑。
// 本地开发：dev-server 设置 globalThis.NOTES_BLOB 内存模拟，优先使用。

import { getStore } from '@edgeone/pages-blob';

export function blob(env) {
  if (globalThis.NOTES_BLOB) return globalThis.NOTES_BLOB; // 本地 mock
  // strong 一致性：写入后立即可读，避免刚上传的原图/笔记读不到
  return getStore({ name: (env && env.BLOB_STORE) || 'notes-blob', consistency: 'strong' });
}
