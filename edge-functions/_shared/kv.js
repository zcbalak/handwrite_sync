// EdgeOne Pages 共享模块：KV 绑定访问
// 控制台绑定命名空间到项目时，变量名称固定使用 NOTES_KV。
// KV 未绑定（审批中）时自动降级到 Blob 兜底，应用照样能用；KV 绑定后自动切换回 KV。

import { blob } from './blob.js';

export function kv(env) {
  const binding = globalThis.NOTES_KV || (env && env.NOTES_KV);
  if (binding) return binding;
  return blobKV(env); // KV 未绑定 → Blob 兜底
}

let blobKVInstance = null;

function blobKV(env) {
  if (!blobKVInstance) {
    blobKVInstance = {
      async put(key, value) {
        await blob(env).set(key, value instanceof ArrayBuffer ? value : String(value));
      },
      async get(key, opts) {
        if (opts && opts.type === 'arrayBuffer') {
          const v = await blob(env).get(key, { type: 'arrayBuffer' });
          return v ?? null;
        }
        if (opts && opts.type === 'json') {
          const v = await blob(env).get(key, { type: 'json' });
          return v ?? null;
        }
        const v = await blob(env).get(key); // 默认 text
        return v ?? null;
      },
      async delete(key) {
        await blob(env).delete(key);
      },
      async list() {
        const { blobs } = await blob(env).list({});
        return { keys: blobs.map((b) => ({ key: b.key })), complete: true };
      },
    };
  }
  return blobKVInstance;
}

// 访问口令已完全移除：所有请求直接放行（用户要求）

export function json(status, obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
