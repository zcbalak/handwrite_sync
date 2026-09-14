// Vercel Serverless 中转函数（Edge Runtime）
// 作用：前端 -> /api/chat -> DeepSeek API
// DeepSeek API Key 只从服务端环境变量 DEEPSEEK_API_KEY 读取，永远不会暴露到浏览器。
export const config = { runtime: 'edge' };

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const ALLOWED_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);
const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 8000;

function json(headers, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(corsHeaders, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json(corsHeaders, 500, {
      error: '服务端未配置 DEEPSEEK_API_KEY，请到 Vercel 项目设置中配置环境变量。',
    });
  }

  let body;
  try {
    body = await req.json();
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
    .map((m) => ({
      role: m.role === 'system' || m.role === 'user' || m.role === 'assistant' ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, MAX_CONTENT_LENGTH) : '',
    }))
    .filter((m) => m.content.length > 0);

  if (sanitized.length === 0) {
    return json(corsHeaders, 400, { error: '消息内容为空' });
  }

  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'deepseek-chat';
  const temperature =
    typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 2) : 0.7;

  const payload = {
    model,
    messages: sanitized,
    stream: true,
    temperature,
  };

  try {
    const upstream = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return json(corsHeaders, upstream.status, {
        error: `DeepSeek 接口错误(${upstream.status}): ${errText.slice(0, 500)}`,
      });
    }

    // 把 DeepSeek 的 SSE 流原样透传给前端
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
