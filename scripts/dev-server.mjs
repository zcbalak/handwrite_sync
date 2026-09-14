// 本地开发服务器（用于验证，非部署依赖）
//
// 用法：
//   DEEPSEEK_API_KEY=sk-xxx FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node scripts/dev-server.mjs
// 然后浏览器打开 http://localhost:3000
//
// 说明：本地用内存 Map 模拟 EdgeOne KV（globalThis.NOTES_KV），
// 边缘函数代码与线上完全一致。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FUNCS = path.join(ROOT, 'edge-functions');
const PORT = process.env.PORT || 3000;

// ---- 模拟 KV ----
function makeKV() {
  const map = new Map();
  return {
    async put(key, value) {
      map.set(key, value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value);
    },
    async get(key, opts) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      if (opts && opts.type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      if (opts && opts.type === 'arrayBuffer') {
        return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
      }
      return v;
    },
    async delete(key) { map.delete(key); },
    async list() { return { keys: [...map.keys()].map((k) => ({ key: k })), complete: true }; },
  };
}
globalThis.NOTES_KV = makeKV();

// Blob 内存模拟（API 形状对齐 @edgeone/pages-blob：set/get/setJSON/delete/list）
function makeBlob() {
  const map = new Map();
  return {
    async set(key, value) {
      map.set(key, value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value);
    },
    async setJSON(key, value) { map.set(key, JSON.stringify(value)); },
    async get(key, opts) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      if (opts && opts.type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      if (opts && opts.type === 'arrayBuffer') {
        return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
      }
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async delete(key) { map.delete(key); },
    async list() {
      return { blobs: [...map.keys()].map((key) => ({ key, etag: '' })), directories: [] };
    },
  };
}
globalThis.NOTES_BLOB = makeBlob(); // 原图 Blob 的内存模拟

// ---- 动态路由表 ----
const ROUTES = [
  { pattern: ['api', 'chat'], file: 'api/chat.js', params: [] },
  { pattern: ['api', 'config'], file: 'api/config.js', params: [] },
  { pattern: ['api', 'notes'], file: 'api/notes.js', params: [] },
  { pattern: ['api', 'notes', '[id]'], file: 'api/notes/[id].js', params: ['id'] },
  { pattern: ['api', 'notes', '[id]', 'image'], file: 'api/notes/[id]/image.js', params: ['id'] },
  { pattern: ['api', 'notes', '[id]', 'retry'], file: 'api/notes/[id]/retry.js', params: ['id'] },
  { pattern: ['api', 'notes', '[id]', 'revise'], file: 'api/notes/[id]/revise.js', params: ['id'] },
];

function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of ROUTES) {
    if (route.pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (route.pattern[i] === '[id]') params[route.params[0]] = parts[i];
      else if (route.pattern[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function callHandler(mod, method, context) {
  const fn = mod[`onRequest${method.charAt(0) + method.slice(1).toLowerCase()}`] || mod[`onRequest${method}`] || mod['onRequest'];
  if (!fn) return new Response('Not Found', { status: 404 });
  return fn(context);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const matched = matchRoute(url.pathname);
    if (matched) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'POST' && body.length ? body : undefined,
      });
      const mod = await import(path.join(FUNCS, matched.route.file) + '?t=' + Date.now());
      const response = await callHandler(mod, req.method, {
        request,
        params: matched.params,
        env: process.env,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value)); // 原始字节透传，不做文本解码
        }
      }
      res.end();
      return;
    }

    // 静态文件（只允许项目内文件）
    let filePath = path.normalize(path.join(ROOT, url.pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (url.pathname === '/') filePath = path.join(ROOT, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error: ' + (err instanceof Error ? err.message : String(err)));
  }
});

server.listen(PORT, () => {
  console.log(`手写笔记 本地开发服务器已启动: http://localhost:${PORT}`);
  console.log('KV: 已启用内存模拟（NOTES_KV）');
  console.log('DEEPSEEK_API_KEY: ' + (process.env.DEEPSEEK_API_KEY ? '已设置' : '未设置'));
  console.log('飞书凭证: ' + (process.env.FEISHU_APP_ID ? '已设置' : '未设置'));
});
