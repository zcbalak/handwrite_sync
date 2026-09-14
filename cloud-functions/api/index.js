// CloudBase 云函数入口：HTTP 事件路由（统一处理 /api/* 请求）
// 部署后网关将 /api 前缀转发到本函数，静态页面与 API 同域，密钥只在本函数环境变量中。

const { listNotes, getNote, createNote, processNote, reviseNote, saveNote, titleWithDate } = require('./_shared/core');
const { transcribe, reviseMarkdown } = require('./_shared/deepseek');

const env = () => process.env;

function json(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

// 访问口令：设置了 ACCESS_CODE 后，所有请求必须带 X-Access-Code 请求头
function checkAccess(headers) {
  const code = env().ACCESS_CODE;
  if (!code) return null;
  const given = headers['x-access-code'] || headers['X-Access-Code'] || headers['x_access_code'];
  if (!given || given !== code) return { error: '访问口令不正确' };
  return null;
}

function parseBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) return JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'));
  return JSON.parse(event.body);
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
}

// ---- 各路由处理 ----

function apiConfig() {
  const e = env();
  return json(200, {
    feishuConfigured: !!(e.FEISHU_APP_ID && e.FEISHU_APP_SECRET),
    deepseekConfigured: !!e.DEEPSEEK_API_KEY,
    // 存储始终可用：云数据库（元数据）+ 云存储（原图）
    kvConfigured: true,
    storageMode: 'cloudbase',
    accessRequired: !!e.ACCESS_CODE,
    accessOk: !e.ACCESS_CODE,
  });
}

async function listNotesHandler() {
  try {
    const notes = await listNotes(env());
    return json(200, { notes });
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '笔记暂时无法读取' });
  }
}

async function createNoteHandler(event) {
  let payload;
  try {
    payload = parseBody(event);
  } catch {
    return json(400, { error: '请求体不是有效的 JSON' });
  }
  const parsed = parseDataUrl(payload.image);
  if (!parsed) return json(400, { error: '无法读取上传的图片' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(parsed.mime)) {
    return json(400, { error: '请上传 JPG、PNG 或 WebP 图片' });
  }
  if (parsed.bytes.length === 0 || parsed.bytes.length > 10 * 1024 * 1024) {
    return json(400, { error: '图片需要小于 10 MB' });
  }
  const filename = (payload.filename || 'note.jpg').replace(/[^a-zA-Z0-9._-]/g, '_') || 'note.jpg';
  try {
    const note = await createNote(env(), parsed.bytes, parsed.mime, filename);
    try {
      const result = await processNote(env(), note.id);
      return json(200, { id: note.id, ...result });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '同步失败';
      note.status = 'pending';
      note.error = detail;
      await saveNote(env(), note);
      return json(200, { id: note.id, status: 'pending', error: detail });
    }
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '照片保存失败，请重试' });
  }
}

async function getNoteHandler(id) {
  try {
    const note = await getNote(env(), id);
    if (!note) return json(404, { error: '笔记不存在' });
    return json(200, { note });
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '笔记暂时无法读取' });
  }
}

async function imageHandler(id) {
  try {
    const note = await getNote(env(), id);
    if (!note) return json(404, { error: '笔记不存在' });
    const app = require('./_shared/core').__getApp();
    const result = await app.downloadFile({ fileID: note.image_file_id });
    const bytes = result.fileContent;
    if (!bytes || !bytes.length) return json(404, { error: '原图不存在' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': note.mime || 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(bytes).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '原图暂时无法读取' });
  }
}

async function retryHandler(id) {
  try {
    const result = await processNote(env(), id);
    return json(200, result);
  } catch (error) {
    return json(200, { status: 'pending', error: error instanceof Error ? error.message : '同步失败' });
  }
}

async function reviseHandler(id, event) {
  let instruction = '';
  try {
    instruction = (parseBody(event).instruction || '').trim();
  } catch {
    return json(400, { error: '请求体不是有效的 JSON' });
  }
  if (!instruction) return json(400, { error: '请填写修改要求' });
  try {
    const result = await reviseNote(env(), id, instruction);
    return { statusCode: result.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, body: result.body };
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '修改失败，请重试' });
  }
}

// 通用 DeepSeek 对话代理（返回完整文本，不做流式）
async function chatHandler(event) {
  const apiKey = env().DEEPSEEK_API_KEY;
  if (!apiKey) return json(400, { error: '请先配置 DeepSeek API Key' });
  let payload;
  try {
    payload = parseBody(event);
  } catch {
    return json(400, { error: '请求体不是有效的 JSON' });
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return json(400, { error: '缺少 messages' });
  try {
    const thinking = { type: env().DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled' };
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-flash', messages, max_tokens: 4096, thinking }),
    });
    const result = await response.json();
    if (!response.ok) {
      return json(response.status === 401 ? 401 : 502, {
        error: response.status === 401 ? 'DeepSeek API Key 无效' : (result?.error?.message || `DeepSeek 请求失败：${response.status}`),
      });
    }
    return json(200, { content: result.choices?.[0]?.message?.content || '' });
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : '对话失败，请重试' });
  }
}

// ---- 入口 ----
exports.main = async function main(event) {
  const path = event.path || '';
  const method = event.httpMethod || 'GET';
  const headers = event.headers || {};

  // 路由：按前缀分派，与 EdgeOne 版 /api/... 保持同一契约
  // /api/config 免口令（前端靠它判断是否弹出口令框）
  if (path === '/api/config') return apiConfig();

  const denied = checkAccess(headers);
  if (denied) return json(401, denied);

  if (path === '/api/chat' && method === 'POST') return chatHandler(event);

  if (path === '/api/notes' && method === 'GET') return listNotesHandler();
  if (path === '/api/notes' && method === 'POST') return createNoteHandler(event);

  if (path.startsWith('/api/notes/')) {
    const rest = path.slice('/api/notes/'.length).split('/').filter(Boolean);
    if (!rest.length) return json(404, { error: 'Not Found' });
    const id = decodeURIComponent(rest[0]);
    if (rest.length === 1 && method === 'GET') return getNoteHandler(id);
    if (rest.length === 2 && rest[1] === 'image') return imageHandler(id);
    if (rest.length === 2 && rest[1] === 'retry' && method === 'POST') return retryHandler(id);
    if (rest.length === 2 && rest[1] === 'revise' && method === 'POST') return reviseHandler(id, event);
  }

  return json(404, { error: 'Not Found' });
};
