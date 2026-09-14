# 手写笔记 · DeepSeek + 飞书

拍照 / 上传手写笔记 → 原图保存 → DeepSeek 视觉模型识别生成标题与 Markdown → 写入飞书知识库文档（含原图与表格）→ 笔记详情中通过对话修改排版（自动同步回飞书）。

部署在**腾讯云 EdgeOne Pages**：前端 + 边缘函数 + Edge KV 存储，API Key 全部保存在服务端环境变量，不暴露。手机和电脑浏览器均可使用。

## 架构

```
手机/电脑浏览器 (index.html)
        │ 拍照/上传（前端压缩到 ≤1600px JPEG）
        ▼
EdgeOne Pages 边缘函数 (edge-functions/)
 ├─ api/notes         笔记列表 / 上传
 ├─ api/notes/[id]    详情
 ├─ api/notes/[id]/image   原图（KV 读取）
 ├─ api/notes/[id]/retry   重新同步到飞书
 ├─ api/notes/[id]/revise  对话修改排版（DeepSeek 重排 + 回写飞书）
 ├─ api/chat          通用 DeepSeek 代理
 └─ api/config        配置状态
        │
        ├─ Edge KV（NOTES_KV）：笔记元数据 + 原图二进制
        ├─ DeepSeek API（deepseek-flash：图文识别 + 排版，思考模式可开关）
        └─ 飞书开放平台：知识库建文档 + 写块/表格 + 上传原图
```

## 需要的环境变量（项目设置 → 环境变量）

| 变量 | 说明 | 必填 |
|---|---|---|
| `FEISHU_APP_ID` | 飞书自建应用 App ID | 是 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret | 是 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（platform.deepseek.com） | 是 |
| `FEISHU_WIKI_NODE` | 飞书知识库节点 token（文档创建的位置），不填用默认值 | 否 |
| `DEEPSEEK_THINKING` | 思考模式开关：`enabled` 打开，不填默认 `disabled`（更快更省） | 否 |
| `ACCESS_CODE` | 可选。设置后访问需要口令（防止别人用你的额度） | 否 |

## 部署步骤

1. 推送代码到 GitHub 仓库。
2. EdgeOne Pages 控制台 → 创建项目 → 连接 Git 仓库 → 选择本仓库。
3. 构建设置：**构建命令留空**，**输出目录 `/`**。
4. **KV 存储**：开通 KV 账户 → 创建命名空间 → 进入项目「KV 存储」→ 绑定命名空间，**变量名称填 `NOTES_KV`**。
5. 添加上述环境变量（飞书两个你已经加过）。
6. 部署。之后每次推送代码自动重新部署。

### 飞书应用需要开通的权限（发布版本后生效）

- `docx:document`（创建和编辑新版文档）
- `wiki:wiki`（知识库读写）
- `drive:drive`（上传图片到文档）
- 应用需要能访问目标知识库（把应用加为知识库成员，或确认应用有对应 wiki 空间权限）

## 本地开发

```bash
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx DEEPSEEK_API_KEY=sk-xxx node scripts/dev-server.mjs
# 打开 http://localhost:3000
```

本地用内存 Map 模拟 KV，功能与线上一致；不带密钥也能验证页面和接口路由。
