// EdgeOne Pages 共享模块：请求体读取与 base64 编解码
// 只依赖 TextEncoder/TextDecoder 等最基础 Web API，不依赖 request.json()/formData()/atob/btoa/Blob/File
// （实测 EdgeOne Pages 运行时这些方法不可用；请求体读取统一走 request.text()）

// 读取请求体为 UTF-8 文本；依次尝试 text / arrayBuffer，兼容不同运行时实现
export async function readBody(request) {
  if (request && typeof request.text === 'function') {
    try { return await request.text(); } catch (e) { /* fallthrough */ }
  }
  if (request && typeof request.arrayBuffer === 'function') {
    try {
      const buf = await request.arrayBuffer();
      return new TextDecoder().decode(buf);
    } catch (e) { /* fallthrough */ }
  }
  throw new Error('无法读取请求体');
}

// 解析 HTTP 响应为 JSON；失败时附带状态码与响应开头内容，便于定位是哪个接口
export async function parseResponseJson(response, label) {
  try {
    return await response.json();
  } catch (error) {
    const raw = await response.text().catch(() => '');
    throw new Error(`${label} 响应解析失败（HTTP ${response.status}）：${raw.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// base64 字符串 -> Uint8Array（不依赖 atob）
export function base64ToBytes(b64) {
  const clean = String(b64).replace(/[\s\r\n]/g, '');
  const out = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '=') break;
    const v = B64_CHARS.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// Uint8Array / ArrayBuffer -> base64 字符串（不依赖 btoa）
export function bytesToBase64(bytes) {
  const data = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = i + 1 < data.length ? data[i + 1] : 0;
    const c = i + 2 < data.length ? data[i + 2] : 0;
    out += B64_CHARS[a >> 2];
    out += B64_CHARS[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < data.length ? B64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < data.length ? B64_CHARS[c & 63] : '=';
  }
  return out;
}
