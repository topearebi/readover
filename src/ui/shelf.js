import * as store from '../store.js';
import {
  isBook,
  displayName,
  canWrite,
  evictBookCache,
  clearAllBookCaches,
  deleteBookPermanently,
  moveBookBetweenSources,
  moveBooksBetweenSources,
  getStorageBreakdown,
} from '../library.js';
import { getCover } from '../covers.js';
import { el, icon, toast } from './overlay.js';
import { saveBookToVault } from '../insights.js';
import { formatBytes } from '../utils/binary.js';
import { sheet, menu } from './sheet.js';

const tones = ['#2e5b4f', '#5a4632', '#3b4a63', '#6b3b3b', '#4a5530', '#40384f'];
const toneFor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
};
export const plainTitle = (item) => (item?.name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');

/** Opens the Book Management & Details Sheet with diagnostics and file mobility actions */
export async function openBookDetailsModal(item, app) {
  const src = store.getSource(item.sourceId);
  const thumb = await store.thumbs.get(item.key);
  const title = thumb?.title || plainTitle(item);
  const author = thumb?.author || '';
  const ext = (item.kind || (item.name && item.name.split('.').pop()) || 'epub').toUpperCase();

  const cached = await store.blobs.get(item.key);
  const isCached = Boolean(cached?.blob) || item.sourceId === 'device';
  const size = item.size != null ? item.size : (cached?.blob?.size || 0);
  const isCorrupted = size === 0;

  const libraryName = displayName(src) || src?.name || 'This device';
  const remotePath = item.path || item.name || '';

  const formatBadge = el('span', { class: 'badge badge-format' }, ext);
  const sizeBadge = el('span', { class: `badge badge-size${isCorrupted ? ' badge-warning' : ''}` }, formatBytes(size));
  const warningBadge = isCorrupted ? el('span', { class: 'badge badge-danger' }, '⚠️ 0 bytes (corrupted/empty)') : null;
  const cacheBadge = el('span', { class: `badge ${isCached ? 'badge-success' : 'badge-muted'}` },
    isCached ? 'Stored on this device' : 'Available in cloud (remote only)'
  );

  const diagBlock = el('div', { class: 'book-details-diag' },
    el('div', { class: 'book-details-badges' }, formatBadge, sizeBadge, warningBadge, cacheBadge),
    el('div', { class: 'book-details-meta-grid' },
      el('div', { class: 'book-meta-label' }, 'Library:'),
      el('div', { class: 'book-meta-val' }, libraryName),
      el('div', { class: 'book-meta-label' }, 'Path:'),
      el('div', { class: 'book-meta-val book-meta-path' }, remotePath),
      el('div', { class: 'book-meta-label' }, 'Cache State:'),
      el('div', { class: 'book-meta-val' }, isCached ? 'Stored on this device' : 'Available in cloud (remote only)')
    )
  );

  let activeDialog = null;
  const closeModal = () => {
    if (activeDialog) activeDialog.close();
  };

  const btnMove = el('button', { type: 'button', class: 'btn btn-quiet book-action-move' },
    icon('shuffle', 'i i-sm'),
    el('span', {}, 'Move to another library…')
  );
  btnMove.onclick = async () => {
    const writable = store.getSources().filter((s) => canWrite(s) && s.id !== item.sourceId);
    if (item.sourceId !== 'device' && !writable.some((s) => s.id === 'device')) {
      writable.push({ id: 'device', type: 'device', name: 'This device' });
    }
    if (!writable.length) {
      toast('Connect another writable storage library in Settings first.');
      return;
    }
    const actions = writable.map((s) => ({
      id: s.id,
      label: displayName(s) || s.name || s.id,
    }));
    const chosen = await menu('Move Book to Library', actions);
    if (!chosen) return;
    const dest = writable.find((s) => s.id === chosen);
    if (!dest) return;

    toast(`Moving "${title}" to ${displayName(dest)}…`);
    try {
      await moveBookBetweenSources(item.sourceId, dest.id, item.key, {
        onProgress: (m) => toast(m),
      });
      toast(`Moved "${title}" to ${displayName(dest)}`);
      closeModal();
    } catch (err) {
      console.error('Failed to move book:', err);
      toast(`Move failed: ${err.message}`);
    }
  };

  const btnEvict = el('button', {
    type: 'button',
    class: 'btn btn-quiet book-action-evict',
    disabled: !isCached || item.sourceId === 'device',
    title: item.sourceId === 'device' ? 'Cannot remove local download for on-device book' : (!isCached ? 'Not downloaded' : 'Remove local binary to free space'),
  },
    icon('drop', 'i i-sm'),
    el('span', {}, 'Remove local download')
  );
  btnEvict.onclick = async () => {
    try {
      const res = await evictBookCache(item.key);
      toast(`Removed local download for "${title}" (${formatBytes(res.freedBytes)} freed)`);
      closeModal();
    } catch (err) {
      toast(`Failed to remove local download: ${err.message}`);
    }
  };

  const btnDelete = el('button', { type: 'button', class: 'btn btn-danger book-action-delete' },
    icon('close', 'i i-sm'),
    el('span', {}, 'Delete permanently')
  );
  btnDelete.onclick = async () => {
    const ok = typeof confirm === 'function' ? confirm(`Permanently delete "${title}" from your library and storage? This cannot be undone.`) : true;
    if (!ok) return;
    try {
      await deleteBookPermanently(item);
      toast(`Deleted "${title}" permanently`);
      closeModal();
    } catch (err) {
      toast(`Failed to delete book: ${err.message}`);
    }
  };

  const actionsBlock = el('div', { class: 'book-details-actions' },
    btnMove,
    btnEvict,
    btnDelete
  );

  await sheet({
    title: `Manage “${title}”`,
    fields: [diagBlock, actionsBlock],
    onOpen: (_form, dialog) => {
      activeDialog = dialog;
      dialog.classList.add('book-details-sheet');
    },
  });
}

/** Opens the Storage Breakdown Summary Dialog */
export async function openStorageBreakdownSheet() {
  const breakdown = await getStorageBreakdown();
  let totalAllBooks = 0;
  let totalAllBytes = 0;
  let totalCachedBytes = 0;

  const rows = breakdown.map((b) => {
    totalAllBooks += b.bookCount;
    totalAllBytes += b.totalBytes;
    totalCachedBytes += b.cachedBytes;
    return el('div', { class: 'storage-breakdown-row' },
      el('div', { class: 'storage-row-header' },
        el('strong', {}, b.sourceName),
        el('span', { class: 'badge' }, `${b.bookCount} ${b.bookCount === 1 ? 'book' : 'books'}`)
      ),
      el('div', { class: 'storage-row-details hint' },
        `Total: ${formatBytes(b.totalBytes)} | Cached on device: ${b.cachedCount} (${formatBytes(b.cachedBytes)})`
      )
    );
  });

  const summary = el('div', { class: 'storage-breakdown-summary' },
    el('div', {}, el('strong', {}, 'Total across all libraries:'), ` ${totalAllBooks} books (${formatBytes(totalAllBytes)})`),
    el('div', { class: 'hint' }, `Total cached locally on this device: ${formatBytes(totalCachedBytes)}`)
  );

  await sheet({
    title: 'Storage Breakdown',
    fields: [summary, el('div', { class: 'storage-breakdown-list' }, ...rows)],
  });
}

/** Clears all downloaded remote book caches */
export async function confirmAndClearAllBookCaches() {
  const ok = typeof confirm === 'function'
    ? confirm('Clear all downloaded book caches from this device? Remote books will remain safely stored in the cloud and stream on demand.')
    : true;
  if (!ok) return;
  const res = await clearAllBookCaches();
  toast(`Cleared ${res.count} book cache${res.count === 1 ? '' : 's'} (${formatBytes(res.freedBytes)} freed)`);
}

/** Bulk book storage migration modal */
export async function openBulkBookMigrationSheet() {
  const sources = store.getSources();
  const allBooks = (await store.items.all()).filter(isBook);
  const bySource = new Map();
  for (const b of allBooks) {
    if (!bySource.has(b.sourceId)) bySource.set(b.sourceId, []);
    bySource.get(b.sourceId).push(b);
  }

  const sourcesWithBooks = [...bySource.entries()].filter(([_, bks]) => bks.length > 0);
  if (!sourcesWithBooks.length) {
    toast('No books found to migrate.');
    return;
  }

  const sourceChoices = sourcesWithBooks.map(([srcId, bks]) => {
    const s = store.getSource(srcId) || { id: srcId, name: srcId };
    return {
      id: srcId,
      label: `${displayName(s) || s.name} (${bks.length} books)`,
    };
  });

  const fromId = await menu('Select Source Library to Migrate From', sourceChoices);
  if (!fromId) return;

  const writableTargets = sources.filter((s) => canWrite(s) && s.id !== fromId);
  if (fromId !== 'device' && !writableTargets.some((s) => s.id === 'device')) {
    writableTargets.push({ id: 'device', type: 'device', name: 'This device' });
  }
  if (!writableTargets.length) {
    toast('No other writable libraries connected. Connect one in Settings first.');
    return;
  }

  const destChoices = writableTargets.map((s) => ({
    id: s.id,
    label: displayName(s) || s.name || s.id,
  }));

  const destId = await menu('Select Destination Library', destChoices);
  if (!destId) return;

  const booksToMove = bySource.get(fromId) || [];
  const ok = typeof confirm === 'function'
    ? confirm(`Migrate all ${booksToMove.length} books from ${displayName(store.getSource(fromId))} to ${displayName(store.getSource(destId))}?`)
    : true;
  if (!ok) return;

  toast(`Migrating ${booksToMove.length} books…`);
  try {
    const moved = await moveBooksBetweenSources(fromId, destId, booksToMove.map((b) => b.key), {
      onProgress: (m) => toast(m),
    });
    toast(`Successfully migrated ${moved} books`);
  } catch (err) {
    console.error('Bulk migration failed:', err);
    toast(`Migration error: ${err.message}`);
  }
}

/** Opens the Shelf header Actions ▾ menu */
export async function openShelfActionsMenu(app) {
  const actions = [
    { id: 'storage-breakdown', label: 'Storage breakdown summary', icon: 'observatory' },
    { id: 'migrate-books', label: 'Bulk storage migration…', icon: 'shuffle' },
    { id: 'clear-caches', label: 'Clear all downloaded book caches', icon: 'drop' },
  ];
  const chosen = await menu('Shelf & Book Actions', actions);
  if (chosen === 'storage-breakdown') {
    await openStorageBreakdownSheet();
  } else if (chosen === 'migrate-books') {
    await openBulkBookMigrationSheet();
  } else if (chosen === 'clear-caches') {
    await confirmAndClearAllBookCaches();
  }
}

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
    const allBlobs = new Set((await store.blobs.all()).map((b) => b.key));

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
      const isCached = allBlobs.has(item.key) || item.sourceId === 'device';
      const cover = el('div', { class: 'shelf-cover', style: `--tone:${toneFor(title)}` });
      if (m?.blob) cover.append(el('img', { alt: '', src: URL.createObjectURL(m.blob) }));
      else cover.append(el('span', {}, title));

      const btn = el(
        'button',
        { type: 'button', class: 'shelf-book', title: `Open ${title}` },
        cover,
        el('span', { class: 'shelf-title' }, title),
        el('span', { class: 'shelf-meta' }, m?.author || item.name.split('.').pop().toUpperCase()),
        p?.updatedAt ? el('span', { class: 'shelf-progress', 'aria-label': `${pct}% read` }, el('i', { style: `width:${Math.max(pct, 2)}%` })) : null
      );
      btn._item = item;
      btn.onclick = () => app.openBook(item);

      const menuBtn = el(
        'button',
        {
          type: 'button',
          class: 'shelf-book-menu-btn',
          'aria-label': `Manage ${title}`,
          title: `Manage ${title}`,
        },
        '···'
      );
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        openBookDetailsModal(item, app);
      };

      const card = el(
        'div',
        { class: 'shelf-book-card', 'data-key': item.key },
        btn,
        menuBtn,
        !isCached && item.sourceId !== 'device'
          ? el('span', { class: 'shelf-cloud-badge', title: 'Available in cloud (remote only)' }, '☁ Cloud')
          : null
      );
      card._item = item;

      if (!m) coverObserver.observe(btn);
      return card;
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

    const actionsBtn = el('button', {
      type: 'button',
      class: 'btn btn-quiet shelf-actions-btn',
      title: 'Shelf & Book Actions'
    }, 'Actions ▾');
    actionsBtn.onclick = () => openShelfActionsMenu(app);

    const shelfBar = el('div', { class: 'shelf-bar' },
      el('div', { class: 'shelf-bar-left' },
        el('h1', { class: 'shelf-heading-main' }, 'Your Books')
      ),
      el('div', { class: 'shelf-bar-actions' }, addBookBtn, observatoryBtn, actionsBtn)
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
