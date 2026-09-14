// 本地开发服务器（用于验证，非部署依赖）
//
// 用法：
//   DEEPSEEK_API_KEY=sk-xxx npm run dev
// 然后浏览器打开 http://localhost:3000
//
// 不带 key 启动也能验证页面和接口路由（/api/chat 会返回"未配置 key"的 JSON）。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest } from '../edge-functions/api/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/chat') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'POST' && body.length ? body : undefined,
      });
      const response = await onRequest({ request, env: process.env });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      }
      res.end();
      return;
    }

    // 静态文件（只允许项目内文件）
    let filePath = path.normalize(path.join(ROOT, url.pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (url.pathname === '/') filePath = path.join(ROOT, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`DeepSeek Web 本地开发服务器已启动: http://localhost:${PORT}`);
  console.log('DeepSeek API Key 状态: ' + (process.env.DEEPSEEK_API_KEY ? '已设置' : '未设置（接口会提示未配置 key）'));
});
