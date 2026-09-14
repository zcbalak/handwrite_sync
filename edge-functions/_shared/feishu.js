// EdgeOne Pages 共享模块：飞书 Open API 封装（由原 Next.js 版移植）
// 凭证来自环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET，不落地存储。

const API = 'https://open.feishu.cn/open-apis';

export function feishuCredentials(env) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('飞书凭证尚未配置（需要环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET）');
  return { appId, appSecret };
}

export async function tenantToken(env) {
  const { appId, appSecret } = feishuCredentials(env);
  const response = await fetch(API + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await response.json();
  if (data.code !== 0) throw new Error('飞书授权失败: ' + data.msg);
  return data.tenant_access_token;
}

export async function feishu(path, token, init = {}) {
  const hasForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(hasForm ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers || {}),
  };
  const response = await fetch(API + path, { ...init, headers });
  const value = await response.json();
  if (!response.ok || value.code !== 0) {
    throw new Error(`飞书 ${value.code}: ${value.msg}（${init.method || 'GET'} ${path.split('?')[0]}）`);
  }
  return value.data ?? {};
}

export const defaultWikiNode = () => 'Rccuw5qndim133kO2TQcvHvcnSf';

export function titleWithDate(title, created) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(created));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${title.replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || '手写笔记'} · ${part('year')}-${part('month')}-${part('day')}`;
}

// ---- Markdown -> 飞书文档块 ----
function inlineElements(source) {
  const elements = [];
  const pattern = /(\\\([\s\S]+?\\\)|\$(?!\$)(?:\\.|[^$\n])+\$|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let start = 0;
  const plain = (value) => { if (value) elements.push({ text_run: { content: value } }); };
  for (const match of source.matchAll(pattern)) {
    const at = match.index;
    plain(source.slice(start, at));
    const token = match[0];
    if (token.startsWith('$') || token.startsWith('\\(')) {
      elements.push({ equation: { content: token.startsWith('$') ? token.slice(1, -1) : token.slice(2, -2) } });
    } else if (token.startsWith('**')) {
      elements.push({ text_run: { content: token.slice(2, -2), text_element_style: { bold: true } } });
    } else if (token.startsWith('*')) {
      elements.push({ text_run: { content: token.slice(1, -1), text_element_style: { italic: true } } });
    } else {
      elements.push({ text_run: { content: token.slice(1, -1), text_element_style: { inline_code: true } } });
    }
    start = at + token.length;
  }
  plain(source.slice(start));
  return elements.length ? elements : [{ text_run: { content: '' } }];
}

export function markdownBlocks(markdown) {
  const blocks = [];
  let paragraph = [];
  let math = null;
  const emit = (type, key, value) => blocks.push({ block_type: type, [key]: { elements: inlineElements(value) } });
  const emitMath = (lines) => {
    const content = lines.join(' ').replace(/\\=/g, '=').trim();
    if (content) blocks.push({ block_type: 2, text: { elements: [{ equation: { content } }] } });
  };
  const flush = () => {
    if (paragraph.length) { emit(2, 'text', paragraph.join('\n')); paragraph = []; }
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (math) {
      if (trimmed.endsWith(math.close)) { math.lines.push(trimmed.slice(0, -2)); emitMath(math.lines); math = null; }
      else if (trimmed) math.lines.push(trimmed);
      continue;
    }
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      flush();
      const close = trimmed.startsWith('$$') ? '$$' : '\\]';
      const rest = trimmed.slice(2);
      if (rest.endsWith(close)) emitMath([rest.slice(0, -2)]);
      else math = { close, lines: rest ? [rest] : [] };
      continue;
    }
    if (!trimmed) { flush(); continue; }
    const heading = /^(#{1,9})\s+(.+)$/.exec(trimmed);
    if (heading) { flush(); const level = Math.min(heading[1].length, 9); emit(level + 2, `heading${level}`, heading[2]); continue; }
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (bullet) { flush(); emit(12, 'bullet', bullet[1]); continue; }
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) { flush(); emit(13, 'ordered', ordered[1]); continue; }
    paragraph.push(trimmed);
  }
  if (math) emitMath(math.lines);
  flush();
  return blocks.length ? blocks : [{ block_type: 2, text: { elements: [{ text_run: { content: '原图已保存；未识别出可辨认的文字。' } }] } }];
}

// ---- Markdown 表格 ----
export function segments(markdown) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, '|'));
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const result = [];
  let plain = [];
  const flush = () => {
    if (plain.some((x) => x.trim())) result.push({ blocks: markdownBlocks(plain.join('\n')) });
    plain = [];
  };
  for (let i = 0; i < lines.length;) {
    const header = cells(lines[i]);
    const divider = i + 1 < lines.length ? cells(lines[i + 1]) : [];
    if (lines[i].includes('|') && header.length >= 2 && divider.length === header.length && divider.every((x) => /^:?-{3,}:?$/.test(x))) {
      flush();
      const rows = [header];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const row = cells(lines[i]);
        if (row.length !== header.length) break;
        rows.push(row);
        i++;
      }
      if (rows.length > 16 || header.length > 6) throw new Error('表格最多支持 16 行、6 列，请让 DeepSeek 拆分表格');
      result.push({ rows });
    } else {
      plain.push(lines[i++]);
    }
  }
  flush();
  return result.length ? result : [{ blocks: markdownBlocks('') }];
}

async function insertTable(doc, auth, rows, added) {
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const tableId = `table_${tag}`;
  const cellIds = rows.flatMap((row, r) => row.map((_, c) => `cell_${tag}_${r}_${c}`));
  const descendants = [{
    block_id: tableId,
    block_type: 31,
    table: { property: { row_size: rows.length, column_size: rows[0].length } },
    children: cellIds,
  }];
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const cellId = `cell_${tag}_${row}_${col}`;
      const textId = `text_${tag}_${row}_${col}`;
      descendants.push({ block_id: cellId, block_type: 32, table_cell: {}, children: rows[row][col] ? [textId] : [] });
      if (rows[row][col]) descendants.push({ block_id: textId, block_type: 2, text: { elements: inlineElements(rows[row][col]) } });
    }
  }
  await feishu(`/docx/v1/documents/${doc}/blocks/${doc}/descendant`, auth, {
    method: 'POST',
    body: JSON.stringify({ children_id: [tableId], descendants }),
  });
  const current = await feishu(`/docx/v1/documents/${doc}/blocks/${doc}/children?page_size=500`, auth);
  const blocks = current.items;
  const actual = blocks && blocks.at(-1);
  if (!actual || actual.block_type !== 31) throw new Error('飞书已写入表格，但未能核实表格块');
  if (added) added.push(actual.block_id);
}

export async function appendBlocks(doc, auth, markdown, added) {
  for (const item of segments(markdown)) {
    if ('rows' in item) {
      await insertTable(doc, auth, item.rows, added).catch((error) => {
        throw new Error(`创建飞书表格失败：${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      for (let at = 0; at < item.blocks.length; at += 40) {
        const batch = item.blocks.slice(at, at + 40);
        await feishu(`/docx/v1/documents/${doc}/blocks/${doc}/children`, auth, {
          method: 'POST',
          body: JSON.stringify({ children: batch }),
        }).catch((error) => {
          throw new Error(`写入飞书文字块失败（类型 ${batch.map((b) => b.block_type).join(',')}）：${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }
}

// 同步到飞书知识库：建文档（或复用已有）→ 写入 Markdown 块 + 表格 → 插入原图
export async function syncToFeishu(env, bytes, mime, filename, text, title, note) {
  const auth = await tenantToken(env);
  const nodeToken = env.FEISHU_WIKI_NODE || defaultWikiNode();
  let doc = note.doc_id;
  let wikiUrl = note.wiki_url;
  let block = note.image_block_id;

  if (!doc) {
    const target = await feishu('/wiki/v2/spaces/get_node?' + new URLSearchParams({ token: nodeToken, obj_type: 'wiki' }), auth);
    const wiki = await feishu(`/wiki/v2/spaces/${target.node.space_id}/nodes`, auth, {
      method: 'POST',
      body: JSON.stringify({ obj_type: 'docx', node_type: 'origin', parent_node_token: nodeToken, title }),
    });
    const node = wiki.node;
    if (!node?.obj_token) throw new Error('飞书已建页面，但没有返回文档标识');
    doc = node.obj_token;
    wikiUrl = `https://my.feishu.cn/wiki/${node.node_token}`;
  }

  if (!block) {
    await appendBlocks(doc, auth, text, null);
    const inserted = await feishu(`/docx/v1/documents/${doc}/blocks/${doc}/children`, auth, {
      method: 'POST',
      body: JSON.stringify({ children: [{ block_type: 27, image: {} }] }),
    });
    block = inserted.children?.[0]?.block_id;
    if (!block) throw new Error('飞书图片块创建失败');
  }

  // 手动构造 multipart 上传原图（不依赖 FormData/Blob，兼容 EdgeOne Pages 运行时）
  const boundary = '----EO' + crypto.randomUUID().replace(/-/g, '');
  const enc = (s) => new TextEncoder().encode(s);
  const chunks = [
    enc(`--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${filename}\r\n`),
    enc(`--${boundary}\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\ndocx_image\r\n`),
    enc(`--${boundary}\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n${block}\r\n`),
    enc(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${bytes.byteLength}\r\n`),
    enc(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    new Uint8Array(bytes),
    enc(`\r\n--${boundary}--\r\n`),
  ];
  const total = chunks.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const p of chunks) { body.set(p, at); at += p.length; }
  const response = await fetch(API + '/drive/v1/medias/upload_all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const uploaded = await response.json();
  if (!response.ok || uploaded.code !== 0) {
    throw new Error(`飞书图片上传失败 ${uploaded.code}: ${uploaded.msg}`);
  }
  await feishu(`/docx/v1/documents/${doc}/blocks/${block}`, auth, {
    method: 'PATCH',
    body: JSON.stringify({ replace_image: { token: uploaded.data.file_token } }),
  });
  return { doc_id: doc, wiki_url: wikiUrl, image_block_id: block };
}

// 对话修改排版：在原图之后追加新内容，再删除旧文字块（原图始终保留）
export async function reviseFeishu(note, markdown, env) {
  const auth = await tenantToken(env);
  const doc = note.doc_id;
  const path = `/docx/v1/documents/${doc}/blocks/${doc}/children`;
  const old = await feishu(`${path}?page_size=500`, auth);
  const items = old.items;
  if (!items || old.has_more) throw new Error('飞书文档过长，暂时无法安全修改');
  const imageAt = items.findIndex((item) => item.block_id === note.image_block_id);
  if (imageAt < 0) throw new Error('未找到原图块，暂时无法安全修改');
  const oldIds = items.slice(0, imageAt).map((x) => x.block_id);
  const added = [];
  try {
    await appendBlocks(doc, auth, markdown, added);
  } catch (error) {
    if (added.length) {
      await feishu(`${path}/batch_delete`, auth, {
        method: 'DELETE',
        body: JSON.stringify({ start_index: items.length, end_index: items.length + added.length }),
      }).catch(() => {});
    }
    throw error;
  }
  if (oldIds.length) {
    await feishu(`${path}/batch_delete`, auth, {
      method: 'DELETE',
      body: JSON.stringify({ start_index: 0, end_index: oldIds.length }),
    });
  }
}
