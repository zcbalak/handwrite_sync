// 本地功能测试：内存 mock 云数据库 + 云存储，验证 CloudBase 云函数路由与核心流程
// 运行：node tests/cloudbase-local.cjs
'use strict';
const assert = require('assert');

// ---- 内存 mock：云数据库 + 云存储 ----
const collections = new Map(); // name -> Map(_id -> doc)
const storage = new Map();     // cloudPath -> Buffer

function collection(name) {
  if (!collections.has(name)) collections.set(name, new Map());
  const store = collections.get(name);
  return {
    doc(id) {
      return {
        async get() {
          const doc = store.get(id);
          return { data: doc ? [{ ...doc, _id: id }] : [] };
        },
        async set(data) { store.set(id, { ...data }); return { id }; },
        async update(partial) { store.set(id, { ...(store.get(id) || {}), ...partial }); return { updated: 1 }; },
      };
    },
    orderBy(field, dir) {
      const items = [...store.entries()].map(([k, v]) => ({ ...v, _id: k }));
      const order = dir === 'desc' ? -1 : 1;
      items.sort((a, b) => (a[field] < b[field] ? order : a[field] > b[field] ? -order : 0));
      return { limit(n) { return { async get() { return { data: items.slice(0, n) }; } }; } };
    },
  };
}

globalThis.__TCB_APP__ = {
  database() { return { collection }; },
  async uploadFile({ cloudPath, fileContent }) {
    storage.set(cloudPath, Buffer.from(fileContent));
    return { fileID: `cloud://test-env.test-bucket/${cloudPath}` };
  },
  async downloadFile({ fileID }) {
    const cloudPath = fileID.replace(/^cloud:\/\/[^/]+\//, '');
    const buf = storage.get(cloudPath);
    return { fileContent: buf };
  },
};

// ---- 加载云函数 ----
const { main } = require('../cloud-functions/api/index.js');

function ev(path, method = 'GET', headers = {}, body = null) {
  return { path, httpMethod: method, headers, body: body === null ? null : JSON.stringify(body) };
}
function jsonOf(res) { return JSON.parse(res.body); }

// 1x1 透明 PNG（70B）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

async function run() {
  // 环境：无密钥（验证 pending 错误路径）
  process.env.DEEPSEEK_API_KEY = '';
  process.env.FEISHU_APP_ID = '';
  process.env.FEISHU_APP_SECRET = '';
  process.env.ACCESS_CODE = '';

  // 1. 配置端点
  let res = await main(ev('/api/config'));
  assert.strictEqual(res.statusCode, 200);
  let c = jsonOf(res);
  assert.strictEqual(c.storageMode, 'cloudbase');
  assert.strictEqual(c.accessRequired, false);
  assert.strictEqual(c.deepseekConfigured, false);
  console.log('✓ /api/config 返回正确（storageMode=cloudbase, 无密钥）');

  // 2. 上传笔记（无 DeepSeek Key → pending + error）
  res = await main(ev('/api/notes', 'POST', { 'Content-Type': 'application/json' }, { image: 'data:image/png;base64,' + PNG_B64, filename: 'a.png' }));
  assert.strictEqual(res.statusCode, 200);
  let up = jsonOf(res);
  assert.strictEqual(up.status, 'pending');
  assert.ok(/DeepSeek/.test(up.error), '错误应提示 DeepSeek 未配置，实际: ' + up.error);
  const id = up.id;
  assert.ok(/^[0-9a-f]{32}$/.test(id), 'id 应为 32 位 hex');
  console.log('✓ 上传成功，状态 pending（未配 Key 时的预期错误路径）');

  // 3. 列表
  res = await main(ev('/api/notes'));
  assert.strictEqual(res.statusCode, 200);
  let list = jsonOf(res);
  assert.strictEqual(list.notes.length, 1);
  assert.strictEqual(list.notes[0].id, id);
  assert.strictEqual(list.notes[0].status, 'pending');
  console.log('✓ 列表返回 1 条 pending 笔记');

  // 4. 详情
  res = await main(ev(`/api/notes/${id}`));
  assert.strictEqual(res.statusCode, 200);
  let note = jsonOf(res).note;
  assert.ok(note.image_file_id.includes('notes/' + id + '.jpg'), '应存有云存储 fileID');
  console.log('✓ 详情返回原图 fileID');

  // 5. 取原图（二进制，isBase64Encoded）
  res = await main(ev(`/api/notes/${id}/image`));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.isBase64Encoded, true);
  assert.strictEqual(res.headers['Content-Type'], 'image/png');
  assert.ok(Buffer.from(res.body, 'base64').equals(PNG_BYTES), '原图字节应与上传一致');
  console.log('✓ 原图接口字节级一致（sha256 校验通过）');

  // 6. 未同步时 revise → 409
  res = await main(ev(`/api/notes/${id}/revise`, 'POST', {}, { instruction: '加粗标题' }));
  assert.strictEqual(res.statusCode, 409);
  console.log('✓ 未同步时 revise 返回 409');

  // 7. 口令：设置 ACCESS_CODE 后，未带头 → 401，带头 → 200
  process.env.ACCESS_CODE = '12345';
  res = await main(ev('/api/config'));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(jsonOf(res).accessRequired, true);
  res = await main(ev('/api/notes'));
  assert.strictEqual(res.statusCode, 401);
  res = await main(ev('/api/notes', 'GET', { 'X-Access-Code': '12345' }));
  assert.strictEqual(res.statusCode, 200);
  res = await main(ev('/api/notes', 'GET', { 'X-Access-Code': 'wrong' }));
  assert.strictEqual(res.statusCode, 401);
  console.log('✓ 口令门：config 免口令、错误口令 401、正确口令放行');
  process.env.ACCESS_CODE = '';

  // 8. 404
  res = await main(ev('/api/whatever'));
  assert.strictEqual(res.statusCode, 404);
  console.log('✓ 未知路径 404');

  console.log('\n全部通过 ✅');
}

run().catch((e) => { console.error('测试失败 ❌', e); process.exit(1); });
