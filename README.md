# 手写笔记 · DeepSeek + 飞书（EdgeOne Pages 版）

拍照 / 上传手写笔记 → 原图保存 → DeepSeek 视觉模型（deepseek-flash）识别生成标题与 Markdown → 写入飞书知识库文档（含原图与表格）→ 笔记详情中通过对话修改排版（自动同步回飞书）。

部署在**腾讯云 EdgeOne Pages**：静态页面（`index.html`）+ Pages Functions 边缘函数（中转层，密钥只存环境变量，不暴露）+ KV / Blob 存储。**国内可直接访问**，手机和电脑浏览器均可使用。

## 架构

```
手机/电脑浏览器 (index.html, 静态页面)
        │ 拍照/上传（前端压缩到 ≤1400px JPEG，以 JSON+base64 提交）
        ▼
EdgeOne Pages 同域路由: /api/* → 边缘函数 (edge-functions/)
        ▼
边缘函数 (edge-functions/api/)
 ├─ GET  /api/notes                   笔记列表
 ├─ POST /api/notes                   上传（保存原图 + 触发识别同步）
 ├─ GET  /api/notes/{id}              详情
 ├─ GET  /api/notes/{id}/image        原图（Blob 读取，二进制返回）
 ├─ POST /api/notes/{id}/retry        重新同步到飞书
 ├─ POST /api/notes/{id}/revise       对话修改排版（DeepSeek 重排 + 回写飞书）
 ├─ DELETE /api/notes/{id}?sync=1|0   删除笔记（sync=1 时同时删除飞书文档）
 ├─ GET  /api/config                  配置状态（免口令）
 └─ POST /api/chat                    通用 DeepSeek 代理（应用未使用）
        │
        ├─ 元数据 → KV（命名空间绑定，变量名 NOTES_KV；未绑定时自动用 Blob 兜底）
        ├─ 原图   → Blob（默认存储 notes-blob，单值上限 25MB）
        ├─ DeepSeek API（deepseek-flash：图文识别 + 排版，思考模式可开关）
        └─ 飞书开放平台：知识库建文档 + 写块/表格 + 上传原图
```

> 浏览器 → EdgeOne 网关 → 边缘函数 →（DeepSeek / 飞书 / KV / Blob）。浏览器只请求自己的站点，**DeepSeek Key 和飞书 App Secret 都只存在边缘函数环境变量里**，前端拿不到。

## 需要的环境变量（EdgeOne Pages 项目设置中配置）

| 变量 | 说明 | 必填 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（platform.deepseek.com） | 是 |
| `FEISHU_APP_ID` | 飞书自建应用 App ID | 是 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret | 是 |
| `FEISHU_WIKI_NODE` | 飞书知识库节点 token（文档创建的位置），不填用默认值 | 否 |
| `DEEPSEEK_THINKING` | 思考模式开关：`enabled` 打开，不填默认 `disabled`（更快更省） | 否 |
| `BLOB_STORE` | Blob 存储名称，不填默认 `notes-blob` | 否 |

另外在控制台为项目**绑定 KV 命名空间**，绑定时的变量名固定为 `NOTES_KV`（KV 未绑定时元数据自动落到 Blob 兜底，应用仍可正常使用）。

密钥通过 EdgeOne 控制台的项目环境变量配置，不会进 Git、不会暴露给前端。

## 部署步骤（EdgeOne Pages）

前置：一个腾讯云账号，已开通 EdgeOne Pages（控制台 https://console.cloud.tencent.com/edgeone/pages）。

```bash
# 1. 项目代码推送到 GitHub 仓库（本仓库：zcbalak/handwrite_sync）
git push origin main

# 2. 控制台：EdgeOne Pages → 创建项目 → 选择 GitHub 仓库 → 自动拉取构建

# 3. 项目设置 → 环境变量：填上面的 DEEPSEEK_API_KEY / FEISHU_APP_ID / FEISHU_APP_SECRET

# 4. 绑定 KV 命名空间（如已开通），变量名 NOTES_KV

# 5. 点击「预览」生成访问链接，部署完成
```

### 预览链接与正式域名（重要）

- 项目加速区域为**中国大陆可用区**时，平台强制使用**预览链接**访问：**有效期 3 小时**，超时后访问返回 401，需在控制台重新点「预览」生成新链接。
- 预览链接带访问控制，发给别人会 401（3 小时内有效）。
- 需要**永久公开网址**（如分享给朋友）：购买域名 → ICP 备案 → 控制台「域名管理」→「添加自定义域名」→ 按提示添加 CNAME 解析。之后通过自定义域名访问，永久有效、不再有 401。

### 部署输出/排错

- 页面能开但 `/api/*` 404：确认边缘函数目录为 `edge-functions/`，或直接访问 `<域名>/api/config` 验证。
- 上传报「无法读取上传的图片」：EdgeOne 函数请求体上限 1MB，前端已压缩到 ≤1400px/JPEG q0.72 并二次降级，一般不会超限；若复现，请检查网络与预览链接是否过期。
- 笔记状态：识别/同步任一步失败会保留为「待同步」；飞书文档已创建但后续失败显示「已同步 · 部分未同步」，可点「重新同步到飞书」从断点续传（不会重复建文档或重复写文字块）。

### 飞书应用需要开通的权限（发布版本后生效）

- `docx:document`（创建和编辑新版文档）
- `wiki:wiki`（知识库读写）
- `drive:drive`（上传图片到文档、删除文档）
- 应用需要能访问目标知识库（把应用加为知识库成员，或确认应用有对应 wiki 空间权限）

## 功能说明

- 手机端点「＋ 拍照 / 上传」可选择相册上传或拍照；桌面端为普通文件选择。
- 所有标题统一追加年月日后缀，如「凸函数与次模性 · 2026-09-14」。
- 列表与详情均可删除：确认弹窗可选「同时删除飞书文档」（调用飞书云空间删除文件接口，知识库节点一并移除）或「仅删除本地」。
- 访问口令已彻底移除，打开即用。

## 本地开发与测试

```bash
# 本地起服务（内存 mock KV/Blob，可连真实 DeepSeek/飞书）
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx DEEPSEEK_API_KEY=sk-xxx node scripts/dev-server.mjs
# 打开 http://localhost:3000
```

## 目录结构

```
index.html                前端单页应用（无构建步骤，直接部署）
edge-functions/
  api/                    边缘函数路由（notes / config / chat）
  _shared/                共享模块（kv / blob / deepseek / feishu / core / body）
scripts/dev-server.mjs    本地开发服务器
cloud-functions/          CloudBase 迁移代码（备选，未启用）
cloudbaserc.json          CloudBase 声明式配置（备选，未启用）
tests/cloudbase-local.cjs CloudBase 本地测试（备选，未启用）
```

## 历史

- **CloudBase 迁移（已完成但未启用）**：曾将 EdgeOne 版迁移到腾讯云 CloudBase（静态托管 + 云函数 + 云数据库 + 云存储），代码保留在 `cloud-functions/`、`cloudbaserc.json`。后确认 EdgeOne 可正常使用，最终选择留在 EdgeOne，CloudBase 方向搁置。
- **EdgeOne 演进**：访问口令已彻底移除；上传从 multipart 改为 JSON+base64；请求体读取改为 `text()` + 手动解析（规避运行时缺失的 `json()`/`formData()`/`atob`/`File`）；同步过程分阶段标记，失败可安全续传。
