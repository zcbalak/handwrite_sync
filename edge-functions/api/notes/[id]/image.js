// 原图（Blob 存储）
import { blob } from '../../../_shared/blob.js';
import { getNote } from '../../../_shared/core.js';

export async function onRequestGet(context) {
  const note = await getNote(context.env, context.params.id);
  if (!note) return new Response('Not found', { status: 404 });
  const image = await blob(context.env).get(`img_${note.id}`, { type: 'arrayBuffer' });
  if (!image) return new Response('Not found', { status: 404 });
  return new Response(image, {
    headers: {
      'Content-Type': note.mime,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
