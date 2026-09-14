# DeepSeek Web Chat

一个部署在**腾讯云 EdgeOne Pages** 上的 DeepSeek 网页聊天应用：

- 前端：`index.html`（移动端友好的聊天界面，流式输出）
- 中转：`edge-functions/api/chat.js`（EdgeOne Pages 边缘函数，转发请求到 DeepSeek API）
- **API Key 只保存在 EdgeOne Pages 环境变量 `DEEPSEEK_API_KEY` 中，不会出现在前端代码里，绝不暴露。**
- 部署在腾讯云 EdgeOne，国内手机浏览器可直接访问。

## 一键部署到 EdgeOne Pages

1. 把本仓库推到 GitHub（或 Gitee）。
2. 注册腾讯云账号（微信扫码即可）并完成**个人实名认证**。
3. 打开 EdgeOne Pages 控制台（edgeone.cloud.tencent.com/pages）→ **创建项目** → **连接 Git 仓库** → 选择 `deepseek-web`。
4. 构建设置：**构建命令留空**（纯静态，无需构建），**输出目录填 `/`**。
5. 点击部署，等待 1~3 分钟，得到 `https://xxx.edgeone.app` 访问域名。
6. 部署完成后进入 **项目设置 → 环境变量**，添加：
   - Name: `DEEPSEEK_API_KEY`
   - Value: 你的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 获取）
7. 保存后自动重新部署，之后访问生成的域名即可使用。以后每次推送到 GitHub，平台都会自动重新部署。

## 本地开发

```bash
npm install -g edgeone   # 安装 EdgeOne CLI（可选）
DEEPSEEK_API_KEY=sk-你的key node scripts/dev-server.mjs
# 打开 http://localhost:3000
```

不带 key 启动也可以验证页面和接口路由。

## 技术说明

- 前端通过 `POST /api/chat` 发送 `{ model, messages }`，后端（边缘函数）读取环境变量中的 Key 后代理请求 DeepSeek `/chat/completions`，以 SSE 流式透传回前端。
- 服务端对模型、消息数量、消息长度做了白名单和上限校验，防止滥用。
