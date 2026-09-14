// EdgeOne Pages 共享模块：DeepSeek API（视觉识别 + 排版修改）
// 统一使用 deepseek-flash（支持图文 / 1M 上下文 / 思考模式开关）。
// Key 只从环境变量 DEEPSEEK_API_KEY 读取。

import { bytesToBase64 } from './body.js';

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-flash'; // 识别与排版共用，性价比最高的图文模型

const transcription = '你是严谨的手写笔记转录助手。只保留照片中可辨认的内容，整理为清晰的 Markdown（标题、小节、段落、列表，确有需要时用 Markdown 表格）。保留原语言和推导顺序；数学表达用 $...$ 或 $$...$$ 的 LaTeX，绝不凭空补充证明，模糊内容标记 [字迹不清]。另根据内容概括一个不超过 24 字的简洁标题，不要包含日期。输出 JSON 对象，例如 {"title":"凸函数与次模性","markdown":"## 命题\\n..."}，不要代码围栏。';

const reviseSystem = '你是笔记排版编辑。只根据用户的要求重排已有内容，不要添加事实、删掉推导或擅自更改公式。用户要求表格时，输出标准 GFM Markdown 表格且保留必要上下文。数学用 $...$ 或 $$...$$。输出 JSON 对象，例如 {"title":"笔记主题","markdown":"## 标题\\n..."}，不要代码围栏。';

function extractJson(content) {
  let text = content.trim();
  text = text.replace(/^```(?:json|markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('DeepSeek 返回格式不正确，请重试');
  return JSON.parse(text.slice(start, end + 1));
}

async function call(apiKey, env, messages, extra = {}) {
  // 思考模式开关：DEEPSEEK_THINKING=enabled 打开，默认 disabled（更快更省）
  const thinking = { type: env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled' };
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, max_tokens: 8192, thinking, response_format: { type: 'json_object' }, messages, ...extra }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      response.status === 401 ? 'DeepSeek API Key 无效'
        : response.status === 429 ? 'DeepSeek 请求过于频繁，请稍后重试'
          : `DeepSeek 请求失败：${result?.error?.message || response.status}`
    );
  }
  const content = result.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('DeepSeek 未返回笔记内容，请重试');
  const value = extractJson(content);
  if (!value || typeof value !== 'object' || !('markdown' in value) || typeof value.markdown !== 'string' || !value.markdown.trim()) {
    throw new Error('DeepSeek 未返回有效 Markdown，请重试');
  }
  const title = 'title' in value && typeof value.title === 'string' ? value.title.trim() : '';
  return { title, markdown: value.markdown.trim().replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '') };
}

// 视觉识别：图片(base64) -> {title, markdown}
export async function transcribe(bytes, mime, env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('请先配置 DeepSeek API Key（环境变量 DEEPSEEK_API_KEY）');
  const base64 = bytesToBase64(bytes);
  return call(apiKey, env, [
    { role: 'system', content: transcription },
    {
      role: 'user',
      content: [
        { type: 'text', text: '识别图片笔记，输出含 title 和 markdown 字段的 JSON。' },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]);
}

// 排版修改：当前 Markdown + 用户要求 -> 新的 {title, markdown}
export async function reviseMarkdown(markdown, instruction, env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('请先配置 DeepSeek API Key（环境变量 DEEPSEEK_API_KEY）');
  return call(apiKey, env, [
    { role: 'system', content: reviseSystem },
    { role: 'user', content: `当前 Markdown 笔记：\n${markdown}\n\n修改要求：${instruction}\n\n请返回完整更新后的 JSON。` },
  ]);
}
