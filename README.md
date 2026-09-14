# DeepSeek Web Chat

一个部署在 Vercel 上的 DeepSeek 网页聊天应用：

- 前端：`index.html`（移动端友好的聊天界面，流式输出）
- 中转：`api/chat.js`（Vercel Edge Function，转发请求到 DeepSeek API）
- **API Key 只保存在 Vercel 环境变量 `DEEPSEEK_API_KEY` 中，不会出现在前端代码里，绝不暴露。**

## 一键部署到 Vercel

1. 把本仓库推到 GitHub（或直接 Fork）。
2. 打开 [vercel.com/new](https://vercel.com/new)，用 GitHub 账号登录，导入本仓库，点击 Deploy。
3. 部署完成后，在 Vercel 项目 → **Settings → Environment Variables** 添加：
   - Name: `DEEPSEEK_API_KEY`
   - Value: 你的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 获取）
4. 添加后会自动重新部署，之后访问生成的 `https://xxx.vercel.app` 即可使用。

## 本地开发

```bash
DEEPSEEK_API_KEY=sk-你的key npm run dev
# 打开 http://localhost:3000
```

不带 key 启动也可以验证页面和接口路由。

## 技术说明

- 前端通过 `POST /api/chat` 发送 `{ model, messages }`，后端（Edge Function）读取环境变量中的 Key 后代理请求 DeepSeek `/chat/completions`，以 SSE 流式透传回前端。
- 服务端对模型、消息数量、消息长度做了白名单和上限校验，防止滥用。
