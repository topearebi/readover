// Book covers + metadata, cached per file version.
import { thumbs } from './store.js';
import { readBlob } from './library.js';
import { loadPdfJs, loadJSZip } from './lib/vendor.js';

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
        const meta = item.kind === 'pdf' ? await pdfCover(file) : await epubCover(file);
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

async function epubCover(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container && /full-path=["']([^"']+)["']/i.exec(container)?.[1];
  if (!opfPath) return { blob: null, title: '', author: '' };
  const opfText = await zip.file(opfPath)?.async('string');
  if (!opfText) return { blob: null, title: '', author: '' };
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const byTag = (tag) => opf.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || '';
  const title = byTag('title');
  const author = byTag('creator');

  const items = [...opf.getElementsByTagNameNS('*', 'item')];
  const metaCover = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover');
  let href =
    (metaCover && items.find((i) => i.getAttribute('id') === metaCover.getAttribute('content'))?.getAttribute('href')) ||
    items.find((i) => /(^|\s)cover-image(\s|$)/.test(i.getAttribute('properties') || ''))?.getAttribute('href') ||
    items
      .find((i) => (i.getAttribute('media-type') || '').startsWith('image/') && /cover/i.test(`${i.getAttribute('id')} ${i.getAttribute('href')}`))
      ?.getAttribute('href');

  let blob = null;
  if (href) {
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const path = normalize(dir + decodeURIComponent(href));
    const entry = zip.file(path);
    if (entry) {
      const ext = path.split('.').pop().toLowerCase();
      const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
      blob = new Blob([await entry.async('uint8array')], { type });
    }
  }
  return { blob, title, author };
}

function normalize(path) {
  const out = [];
  for (const p of path.split('/')) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}
