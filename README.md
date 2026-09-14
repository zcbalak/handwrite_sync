# 手写笔记 · DeepSeek + 飞书（CloudBase 版）

拍照 / 上传手写笔记 → 原图保存 → DeepSeek 视觉模型识别生成标题与 Markdown → 写入飞书知识库文档（含原图与表格）→ 笔记详情中通过对话修改排版（自动同步回飞书）。

部署在**腾讯云 CloudBase**：静态托管（前端）+ HTTP 云函数（中转层，密钥只存环境变量，不暴露）+ 云数据库（元数据）+ 云存储（原图）。**国内可直接访问**，手机和电脑浏览器均可使用。

## 架构

```
手机/电脑浏览器 (index.html, 静态托管)
        │ 拍照/上传（前端压缩到 ≤1600px JPEG，以 JSON+base64 提交）
        ▼
CloudBase 网关（同一域名）: /api/* → 云函数 api
        ▼
云函数 api (cloud-functions/api/)
 ├─ GET  /api/notes         笔记列表
 ├─ POST /api/notes         上传（保存原图 + 触发识别同步）
 ├─ GET  /api/notes/{id}    详情
 ├─ GET  /api/notes/{id}/image   原图（云存储读取，二进制返回）
 ├─ POST /api/notes/{id}/retry   重新同步到飞书
 ├─ POST /api/notes/{id}/revise  对话修改排版（DeepSeek 重排 + 回写飞书）
 ├─ POST /api/chat          通用 DeepSeek 代理
 └─ GET  /api/config        配置状态（免口令）
        │
        ├─ 元数据 → 云数据库（集合 notes，doc._id = 笔记 id）
        ├─ 原图   → 云存储（对象 notes/<id>.jpg，fileID 存数据库）
        ├─ DeepSeek API（deepseek-flash：图文识别 + 排版，思考模式可开关）
        └─ 飞书开放平台：知识库建文档 + 写块/表格 + 上传原图
```

> 浏览器 → 网关 → 云函数 →（DeepSeek / 飞书 / 云存储）。浏览器只请求自己的站点，**DeepSeek Key 和飞书 App Secret 都只存在云函数环境变量里**，前端拿不到。

## 需要的环境变量（云函数 api 的环境变量）

| 变量 | 说明 | 必填 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（platform.deepseek.com） | 是 |
| `FEISHU_APP_ID` | 飞书自建应用 App ID | 是 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret | 是 |
| `FEISHU_WIKI_NODE` | 飞书知识库节点 token（文档创建的位置），不填用默认值 | 否 |
| `DEEPSEEK_THINKING` | 思考模式开关：`enabled` 打开，不填默认 `disabled`（更快更省） | 否 |
| `ACCESS_CODE` | 可选。设置后访问需要口令（防止别人用你的额度） | 否 |

密钥通过 `.env.local`（已 gitignore）配置，部署时由 CLI 注入云函数环境变量，不会进 Git。

## 部署步骤（CloudBase CLI）

前置：一个腾讯云账号，已开通 CloudBase 并创建**环境**（控制台 https://console.cloud.tencent.com/tcb → 创建环境，地域选上海；免费环境有 3000 资源点/月额度，个人使用足够）。记下环境 ID（形如 `xxx-1g2h3j4k`）。

```bash
# 1. 安装 CLI（一次即可）
npm install -g @cloudbase/cli

# 2. 登录（会打开浏览器扫码）
cloudbase login

# 3. 在项目根目录创建 .env.local（密钥只在这里，不会提交）
cat > .env.local <<'EOF'
TCB_ENV_ID=你的环境ID
DEEPSEEK_API_KEY=sk-xxxx
FEISHU_APP_ID=cli_xxxx
FEISHU_APP_SECRET=你的secret
ACCESS_CODE=12345            # 可选：访问口令
DEEPSEEK_THINKING=disabled   # 可选：enabled 打开思考模式
# FEISHU_WIKI_NODE=知识库节点token   # 可选，默认用代码内置节点
EOF

# 4. 声明式部署（静态托管 + 云函数 + 网关路由一次完成）
cloudbase deploy

# 5. 部署完成后 CLI 会打印访问地址，打开即可（通常 https://<环境ID>.tcloudbaseapp.com）
```

之后每次改代码 push 到 GitHub，或本地重新 `cloudbase deploy` 即可更新。

### 部署输出/排错

- 打开地址是静态托管默认域名；`/api/*` 请求由网关自动转发到云函数（同一域名，无跨域问题）。
- 如果页面能开但接口 404：打开 CloudBase 控制台 → 环境 → 「网关」→ 确认存在路由 `/api → function:api` 和 `/ → hosting:web`；或直接访问 `https://<环境ID>.tcloudbaseapp.com/api/config` 验证。
- 云函数超时默认 60 秒（`cloudbaserc.json` 已配置），识别+同步一般 10-30 秒。

### 飞书应用需要开通的权限（发布版本后生效）

- `docx:document`（创建和编辑新版文档）
- `wiki:wiki`（知识库读写）
- `drive:drive`（上传图片到文档）
- 应用需要能访问目标知识库（把应用加为知识库成员，或确认应用有对应 wiki 空间权限）

## 本地开发与测试

```bash
# 语法检查 + 本地功能测试（内存 mock 云数据库/云存储，不需要真实环境）
node tests/cloudbase-local.cjs

# 本地起服务（旧 EdgeOne 版 dev-server，内存 mock 存储，可连真实 DeepSeek/飞书）
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx DEEPSEEK_API_KEY=sk-xxx node scripts/dev-server.mjs
# 打开 http://localhost:3000
```

## 历史

- **EdgeOne Pages 版（已弃用）**：`edge-functions/` 保留在仓库中。免费预览域名在中国大陆网络返回平台级 401（加速区域不含中国大陆）、预览链接 3 小时过期，无法作为国内个人使用的稳定入口，已迁移到 CloudBase。
- **存储演进**：EdgeOne 版 KV(元数据)+Blob(原图) → CloudBase 版云数据库(元数据)+云存储(原图)，均免审批、免费额度内可用。
