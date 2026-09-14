// 文件路径 ./edge-functions/api/chat.js
// 访问路径 example.com/api/chat
//
// DeepSeek 通用代理：转发到 DeepSeek API，Key 只从环境变量读取，绝不暴露。
// 支持纯文本与多模态（deepseek-v4-flash-vision-exp）消息。

import { readBody } from '../_shared/body.js';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash-vision-exp', 'deepseek-flash']);
const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 20000;

function json(headers, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const req = context.request;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(corsHeaders, 405, { error: 'Method not allowed' });

  const apiKey = context.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json(corsHeaders, 500, { error: '服务端未配置 DEEPSEEK_API_KEY，请到项目设置中添加环境变量。' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(corsHeaders, 400, { error: '请求体不是合法的 JSON' });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(corsHeaders, 400, { error: 'messages 不能为空' });
  }
  if (messages.length > MAX_MESSAGES) {
    return json(corsHeaders, 400, { error: `消息数量超限（最多 ${MAX_MESSAGES} 条）` });
  }

  const sanitized = messages
    .map((m) => {
      const role = m.role === 'system' || m.role === 'user' || m.role === 'assistant' ? m.role : 'user';
      let content = m.content;
      if (typeof content === 'string') content = content.slice(0, MAX_CONTENT_LENGTH);
      return { role, content };
    })
    .filter((m) => m.content !== undefined && m.content !== '');

  if (sanitized.length === 0) return json(corsHeaders, 400, { error: '消息内容为空' });

  let model = typeof body.model === 'string' && DEFAULT_MODELS.has(body.model) ? body.model : 'deepseek-chat';
  if (context.env.DEEPSEEK_CHAT_MODEL) model = context.env.DEEPSEEK_CHAT_MODEL;

  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 2) : 0.7;
  const payload = { model, messages: sanitized, stream: true, temperature };
  if (typeof body.max_tokens === 'number') payload.max_tokens = Math.min(Math.max(body.max_tokens, 1), 8192);

  try {
    const upstream = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return json(corsHeaders, upstream.status, { error: `DeepSeek 接口错误(${upstream.status}): ${errText.slice(0, 500)}` });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return json(corsHeaders, 500, { error: '代理请求失败: ' + err.message });
  }
}
