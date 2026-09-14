// EdgeOne Pages 共享模块：KV 绑定访问
// 控制台绑定命名空间到项目时，变量名称固定使用 NOTES_KV。

export function kv(env) {
  const binding = globalThis.NOTES_KV || (env && env.NOTES_KV);
  if (!binding) throw new Error('KV 存储未绑定（请在项目设置中绑定命名空间，变量名称填 NOTES_KV）');
  return binding;
}

// 访问口令（可选）：设置了 ACCESS_CODE 环境变量后，所有 API 需要携带 X-Access-Code 头。
export function checkAccess(env, request) {
  const code = env.ACCESS_CODE;
  if (!code) return null;
  const given = request.headers.get('x-access-code') || '';
  if (given !== code) return { error: '访问口令不正确' };
  return null;
}

export function json(status, obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
