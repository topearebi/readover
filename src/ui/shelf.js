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

  function getCatalogsList() {
    if (typeof store.getOpdsCatalogs === 'function') {
      try {
        const res = store.getOpdsCatalogs();
        if (Array.isArray(res) && res.length) return res;
      } catch {}
    }
    try {
      const raw = localStorage.getItem('readover.opdsCatalogs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
    return [
      {
        id: 'opds-gutenberg',
        name: 'Project Gutenberg',
        url: 'https://m.gutenberg.org/ebooks.opds/',
        description: 'Over 70,000 free public domain ebooks',
        useProxy: false,
      },
      {
        id: 'opds-standard-ebooks',
        name: 'Standard Ebooks (Donor Login)',
        url: 'https://standardebooks.org/opds',
        description: 'Free public domain ebooks in high-quality EPUB format',
        useProxy: false,
      },
    ];
  }

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

    const opdsBtn = el('button', { type: 'button', class: 'btn btn-quiet shelf-opds-btn', title: 'Browse remote OPDS catalogs (Standard Ebooks, Calibre, Kavita)' },
      el('span', {}, '🌐 Browse OPDS Catalogs')
    );
    opdsBtn.onclick = async () => {
      const { openOpdsBrowser } = await import('./opds.js');
      openOpdsBrowser(app);
    };

    const shelfBar = el('div', { class: 'shelf-bar' },
      el('div', { class: 'shelf-bar-left' },
        el('h1', { class: 'shelf-heading-main' }, 'Your Books')
      ),
      el('div', { class: 'shelf-bar-actions' }, opdsBtn)
    );

    const sections = [shelfBar];
    if (reading.length) sections.push(el('h2', { class: 'shelf-heading' }, 'Reading'), el('div', { class: 'shelf-grid' }, ...reading.map(tile)));
    if (rest.length) sections.push(el('h2', { class: 'shelf-heading' }, reading.length ? 'Not started' : 'All books'), el('div', { class: 'shelf-grid' }, ...rest.map(tile)));
    // Dedicated Catalogs Section in Shelves ("Browse Remote, Stash Local")
    const catalogs = getCatalogsList();
    const catalogCards = catalogs.map((cat) => {
      const card = el(
        'button',
        { type: 'button', class: 'shelf-catalog-card', title: `Browse ${cat.name}` },
        el('span', { class: 'shelf-catalog-icon' }, '🌐'),
        el('div', { class: 'shelf-catalog-info' },
          el('b', {}, cat.name),
          el('small', {}, cat.description || cat.url)
        )
      );
      card.onclick = async () => {
        const { openOpdsBrowser } = await import('./opds.js');
        openOpdsBrowser(app, { initialCatalogId: cat.id });
      };
      return card;
    });

    const addCatBtn = el(
      'button',
      { type: 'button', class: 'shelf-catalog-card shelf-catalog-add', title: 'Add custom OPDS catalog' },
      el('span', { class: 'shelf-catalog-icon' }, '+'),
      el('div', { class: 'shelf-catalog-info' },
        el('b', {}, 'Add Catalog…'),
        el('small', {}, 'Connect Calibre, Kavita, or Komga')
      )
    );
    addCatBtn.onclick = async () => {
      const { openOpdsBrowser } = await import('./opds.js');
      openOpdsBrowser(app, { openAdd: true });
    };
    catalogCards.push(addCatBtn);

    sections.push(
      el('h2', { class: 'shelf-heading' }, 'Catalogs ("Browse Remote, Stash Local")'),
      el('div', { class: 'shelf-catalogs-grid' }, ...catalogCards)
    );

    if (!books.length) {
      const connect = el('button', { class: 'btn btn-primary' }, 'Add your books');
      connect.onclick = () => app.connect();
      const browseOpds = el('button', { class: 'btn btn-quiet' }, 'Browse OPDS Catalogs');
      browseOpds.onclick = async () => {
        const { openOpdsBrowser } = await import('./opds.js');
        openOpdsBrowser(app);
      };
      sections.push(
        el(
          'div',
          { class: 'shelf-empty' },
          el('h2', {}, 'No local books downloaded yet.'),
          el('p', {}, 'Browse catalogs above to acquire open-access books, or connect a storage folder from Settings.'),
          el('div', { class: 'row-actions' }, connect, browseOpds)
        )
      );
    }
    root.replaceChildren(el('div', { class: 'shelf-inner' }, ...sections));
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
