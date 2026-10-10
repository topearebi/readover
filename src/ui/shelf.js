// The Shelf: every book across your libraries. Books you're reading come first,
// most recently read first, so switching between titles is one tap.
import * as store from '../store.js';
import { getCover } from '../covers.js';
import { el } from './overlay.js';

const tones = ['#2e5b4f', '#5a4632', '#3b4a63', '#6b3b3b', '#4a5530', '#40384f'];
const toneFor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
};
const plainTitle = (item) => item.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');

/** @param app { openBook(item), connect() } */
export function initShelf(app) {
  const root = document.getElementById('shelf');
  let coverObserver = null;

  async function render() {
    const hiddenOrGone = new Set((await store.state.all()).filter((s) => s.hidden).map((s) => s.key));
    const books = (await store.items.all()).filter((i) => i.kind !== 'note' && !hiddenOrGone.has(i.key) && store.getSource(i.sourceId));
    const prog = new Map((await store.progress.all()).map((p) => [p.key, p]));
    const meta = new Map((await store.thumbs.all()).map((t) => [t.key, t]));

    const reading = books
      .filter((b) => prog.get(b.key)?.updatedAt)
      .sort((a, b) => prog.get(b.key).updatedAt - prog.get(a.key).updatedAt);
    const rest = books
      .filter((b) => !prog.get(b.key)?.updatedAt)
      .sort((a, b) => (meta.get(a.key)?.title || plainTitle(a)).localeCompare(meta.get(b.key)?.title || plainTitle(b)));

    coverObserver?.disconnect();
    coverObserver = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          coverObserver.unobserve(e.target);
          loadCover(e.target);
        }),
      { root, rootMargin: '400px 0px' }
    );

    const tile = (item) => {
      const p = prog.get(item.key);
      const m = meta.get(item.key);
      const title = m?.title || plainTitle(item);
      const pct = Math.round((p?.pct || 0) * 100);
      const cover = el('div', { class: 'shelf-cover', style: `--tone:${toneFor(title)}` });
      if (m?.blob) cover.append(el('img', { alt: '', src: URL.createObjectURL(m.blob) }));
      else cover.append(el('span', {}, title));
      const btn = el(
        'button',
        { class: 'shelf-book', title: `Open ${title}` },
        cover,
        el('span', { class: 'shelf-title' }, title),
        el('span', { class: 'shelf-meta' }, m?.author || item.name.split('.').pop().toUpperCase()),
        p?.updatedAt ? el('span', { class: 'shelf-progress', 'aria-label': `${pct}% read` }, el('i', { style: `width:${Math.max(pct, 2)}%` })) : null
      );
      btn._item = item;
      btn.onclick = () => app.openBook(item);
      if (!m) coverObserver.observe(btn);
      return btn;
    };

    const sections = [];
    if (reading.length) sections.push(el('h2', { class: 'shelf-heading' }, 'Reading'), el('div', { class: 'shelf-grid' }, ...reading.map(tile)));
    if (rest.length) sections.push(el('h2', { class: 'shelf-heading' }, reading.length ? 'Not started' : 'Your books'), el('div', { class: 'shelf-grid' }, ...rest.map(tile)));
    if (!books.length) {
      const connect = el('button', { class: 'btn btn-primary' }, 'Add your books');
      connect.onclick = () => app.connect();
      sections.push(
        el(
          'div',
          { class: 'shelf-empty' },
          el('h2', {}, 'No books yet.'),
          el('p', {}, 'Connect a GitHub repo or open a folder with your books. Readover opens EPUB, PDF, MOBI, AZW3, FB2 and CBZ files.'),
          connect
        )
      );
    }
    root.replaceChildren(el('div', { class: 'shelf-inner' }, ...sections));
  }

  async function loadCover(btn) {
    try {
      const meta = await getCover(btn._item);
      const cover = btn.querySelector('.shelf-cover');
      if (meta.blob) cover.replaceChildren(el('img', { alt: '', src: URL.createObjectURL(meta.blob) }));
      if (meta.title) btn.querySelector('.shelf-title').textContent = meta.title;
      if (meta.author) btn.querySelector('.shelf-meta').textContent = meta.author;
    } catch {}
  }

  return { render };
}
