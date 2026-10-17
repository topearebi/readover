import * as store from '../store.js';
import { isBook } from '../library.js';
import { getCover } from '../covers.js';
import { el, icon, toast } from './overlay.js';
import { saveBookToVault } from '../insights.js';

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

  const fileInput = el('input', {
    type: 'file',
    accept: '.epub,.pdf',
    multiple: true,
    style: 'display:none;',
  });

  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    let count = 0;
    for (const file of files) {
      try {
        toast(`Ingesting ${file.name}…`);
        await saveBookToVault({ file });
        count++;
      } catch (err) {
        console.error('Failed to ingest book', file.name, err);
        toast(`Failed to ingest ${file.name}: ${err.message || 'error'}`);
      }
    }
    fileInput.value = '';
    if (count > 0) {
      toast(`Added ${count} book${count === 1 ? '' : 's'} to library`);
      render();
    }
  };

  async function render() {
    const hiddenOrGone = new Set((await store.state.all()).filter((s) => s.hidden).map((s) => s.key));
    const books = (await store.items.all()).filter((i) => isBook(i) && !hiddenOrGone.has(i.key) && store.getSource(i.sourceId));
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

    const addBookBtn = el('button', { type: 'button', class: 'btn btn-primary shelf-add-book-btn', title: 'Add EPUB or PDF books' },
      icon('open', 'i i-sm'),
      el('span', {}, 'Add book')
    );
    addBookBtn.onclick = () => fileInput.click();

    const observatoryBtn = el('button', { type: 'button', class: 'btn btn-quiet shelf-observatory-btn', title: 'Open Knowledge Observatory' },
      icon('observatory', 'i i-sm'),
      el('span', {}, 'Observatory')
    );
    observatoryBtn.onclick = async () => {
      const { openObservatory } = await import('./observatory.js');
      openObservatory(app);
    };

    const shelfBar = el('div', { class: 'shelf-bar' },
      el('div', { class: 'shelf-bar-left' },
        el('h1', { class: 'shelf-heading-main' }, 'Your Books')
      ),
      el('div', { class: 'shelf-bar-actions' }, addBookBtn, observatoryBtn)
    );

    const sections = [shelfBar];
    if (reading.length) sections.push(el('h2', { class: 'shelf-heading' }, 'Reading'), el('div', { class: 'shelf-grid' }, ...reading.map(tile)));

    // Categorize remaining books by immediate subfolder / shelf category
    const categories = new Map();
    for (const b of rest) {
      let cat = '';
      if (b.folder) {
        const parts = b.folder.split('/').filter(Boolean);
        cat = parts[parts.length - 1] || '';
      }
      const catKey = cat || (reading.length ? 'Not started' : 'All books');
      if (!categories.has(catKey)) categories.set(catKey, []);
      categories.get(catKey).push(b);
    }

    if (categories.size === 1 && (categories.has('Not started') || categories.has('All books'))) {
      sections.push(
        el('h2', { class: 'shelf-heading' }, reading.length ? 'Not started' : 'All books'),
        el('div', { class: 'shelf-grid' }, ...rest.map(tile))
      );
    } else {
      for (const [catName, catBooks] of categories) {
        sections.push(
          el('h2', { class: 'shelf-heading' }, catName),
          el('div', { class: 'shelf-grid' }, ...catBooks.map(tile))
        );
      }
    }

    if (!books.length) {
      const addBtn = el('button', { type: 'button', class: 'btn btn-primary' },
        icon('open', 'i i-sm'),
        el('span', {}, 'Add book')
      );
      addBtn.onclick = () => fileInput.click();
      const connect = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Connect storage');
      connect.onclick = () => app.connect();
      sections.push(
        el(
          'div',
          { class: 'shelf-empty' },
          el('h2', {}, 'No books in your library yet.'),
          el('p', {}, 'Ingest an EPUB or PDF directly, or connect a storage folder from Settings.'),
          el('div', { class: 'row-actions' }, addBtn, connect)
        )
      );
    }

    root.replaceChildren(el('div', { class: 'shelf-inner' }, fileInput, ...sections));
  }

  window.addEventListener('readover:shelf-refresh', () => render());

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
