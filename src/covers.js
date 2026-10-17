import { thumbs } from './store.js';
import { readBlob } from './library.js';
import { loadPdfJs, loadFoliate } from './lib/vendor.js';
import { cloneBlob } from './utils/binary.js';

const inflight = new Map();

/** Returns { blob|null, title, author } for a pdf/epub item, using the cache when possible. */
export function getCover(item) {
  if (!inflight.has(item.key)) {
    inflight.set(
      item.key,
      (async () => {
        const cached = await thumbs.get(item.key);
        if (cached && cached.sha === item.sha) return cached;
        const file = await readBlob(item);
        const safeFile = cloneBlob(file);
        const meta = item.kind === 'pdf' ? await pdfCover(safeFile) : await ebookCover(safeFile, item.name);
        const rec = { key: item.key, sourceId: item.sourceId, sha: item.sha, ...meta };
        await thumbs.put(rec);
        return rec;
      })().finally(() => setTimeout(() => inflight.delete(item.key), 0))
    );
  }
  return inflight.get(item.key);
}

async function pdfCover(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    let title = '';
    let author = '';
    try {
      const { info } = await doc.getMetadata();
      title = (info?.Title || '').trim();
      author = (info?.Author || '').trim();
    } catch {}
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 480 / v1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    canvas.width = canvas.height = 0;
    return { blob, title, author, pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

/** EPUB, MOBI/AZW3, FB2, CBZ: foliate-js reads metadata and the cover for all of them. */
async function ebookCover(file, name) {
  const { makeBook } = await loadFoliate();
  const book = await makeBook(new File([file], name, { type: file.type }));
  const text = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x)[0] || '' : '');
  const people = (x) => (Array.isArray(x) ? x : x ? [x] : []).map((p) => text(p?.name ?? p)).filter(Boolean).join(', ');
  let blob = null;
  try {
    blob = (await book.getCover?.()) || null;
  } catch {}
  let title = text(book.metadata?.title).trim();
  if (!title || title === name) title = name.replace(/\.[^.]+$/, ''); // comics often have no title of their own
  const meta = { blob, title, author: people(book.metadata?.author).trim() };
  book.destroy?.();
  return meta;
}
