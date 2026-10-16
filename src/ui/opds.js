// OPDS Catalog Browser ("Browse Remote, Stash Local")
// On-demand catalog browser and book acquirer for Standard Ebooks, Project Gutenberg,
// Calibre, Kavita, Komga, and custom self-hosted OPDS servers.

import * as store from '../store.js';
import * as library from '../library.js';
import { loadCatalogFeed, makeSafeFilename, opdsFetch, proxyUrl, PRESET_CATALOGS } from '../sources/opds.js';
import { getCover } from '../covers.js';
import { el, icon, openSheet, toast, pushOverlay } from './overlay.js';

export function openOpdsBrowser(app, options = {}) {
  const dialog = el('dialog', { class: 'sheet sheet-tall opds-browser-sheet', 'aria-label': 'OPDS Book Catalogs' });
  
  // Safe catalog helpers
  function fetchCatalogs() {
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
    return PRESET_CATALOGS;
  }

  // State
  let catalogs = fetchCatalogs();
  let activeCatalog = catalogs[0];
  let currentFeed = null;
  let history = []; // Stack of { url, title }
  let downloading = new Set();
  let acquiredKeys = new Set();

  // Topbar
  const catalogSelect = el('select', { class: 'opds-catalog-select', 'aria-label': 'Select OPDS Catalog' });
  const addCatalogBtn = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', title: 'Add or manage catalogs' }, '+ Add');
  const closeBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close' }, icon('close'));
  
  // Breadcrumbs & Search
  const breadcrumbNav = el('nav', { class: 'opds-crumbs', 'aria-label': 'Catalog Path' });
  const searchInput = el('input', { type: 'search', class: 'opds-search-input', placeholder: 'Search in this catalog…', autocomplete: 'off' });
  
  // Content areas
  const statusLine = el('p', { class: 'hint opds-status' }, 'Loading catalog…');
  const subsectionsGrid = el('div', { class: 'opds-subsections-grid' });
  const booksGrid = el('div', { class: 'opds-books-grid' });
  const paginationBar = el('div', { class: 'opds-pagination-bar', hidden: true });
  
  const body = el(
    'div',
    { class: 'sheet-inner opds-browser-inner' },
    el('div', { class: 'sheet-head opds-head' },
      el('div', { class: 'opds-head-title' },
        el('h2', {}, 'Remote Catalogs'),
        el('div', { class: 'opds-catalog-picker' }, catalogSelect, addCatalogBtn)
      ),
      closeBtn
    ),
    el('div', { class: 'opds-toolbar' }, breadcrumbNav, searchInput),
    statusLine,
    subsectionsGrid,
    booksGrid,
    paginationBar
  );

  dialog.append(body);
  document.body.append(dialog);

  const closeDialog = pushOverlay(() => {
    dialog.remove();
  }, { element: dialog });
  closeBtn.onclick = closeDialog;

  function updateCatalogOptions() {
    catalogs = fetchCatalogs();
    catalogSelect.replaceChildren(
      ...catalogs.map((c) => el('option', { value: c.id }, c.name))
    );
    if (!catalogs.some((c) => c.id === activeCatalog.id)) {
      activeCatalog = catalogs[0];
    }
    catalogSelect.value = activeCatalog.id;
  }

  catalogSelect.onchange = () => {
    const found = catalogs.find((c) => c.id === catalogSelect.value);
    if (found) {
      activeCatalog = found;
      history = [];
      loadUrl(activeCatalog.url, activeCatalog.name);
    }
  };

  addCatalogBtn.onclick = () => openAddCatalogModal();

  async function checkAcquiredBooks() {
    const items = await store.items.all();
    acquiredKeys = new Set(items.filter((i) => i.kind !== 'note').map((i) => i.name.toLowerCase()));
  }

  function updateBreadcrumbs() {
    const parts = [
      el('button', { type: 'button', class: 'crumb-btn' }, activeCatalog.name),
      ...history.map((h, i) =>
        el('button', { type: 'button', class: 'crumb-btn' }, h.title)
      ),
    ];

    parts[0].onclick = () => {
      history = [];
      loadUrl(activeCatalog.url, activeCatalog.name);
    };

    history.forEach((h, i) => {
      parts[i + 1].onclick = () => {
        history = history.slice(0, i);
        loadUrl(h.url, h.title);
      };
    });

    const elements = [];
    parts.forEach((p, i) => {
      if (i > 0) elements.push(el('span', { class: 'crumb-sep' }, ' / '));
      elements.push(p);
    });

    breadcrumbNav.replaceChildren(...elements);
  }

  async function loadUrl(url, title = 'Catalog') {
    statusLine.hidden = false;
    statusLine.textContent = `Browsing ${title}…`;
    subsectionsGrid.replaceChildren();
    booksGrid.replaceChildren();
    paginationBar.hidden = true;
    updateBreadcrumbs();

    try {
      await checkAcquiredBooks();
      currentFeed = await loadCatalogFeed(activeCatalog, url);
      statusLine.textContent = currentFeed.books.length
        ? `${currentFeed.books.length} publications found`
        : currentFeed.subsections.length
        ? `${currentFeed.subsections.length} sections`
        : 'No publications found in this section.';
      renderFeed(currentFeed);
    } catch (err) {
      statusLine.textContent = `Could not load catalog: ${err.message}`;
      const retryBtn = el('button', { type: 'button', class: 'btn btn-quiet btn-sm' }, 'Retry with Proxy');
      retryBtn.onclick = () => {
        activeCatalog.useProxy = true;
        store.saveOpdsCatalog(activeCatalog);
        loadUrl(url, title);
      };
      statusLine.append(' ', retryBtn);
    }
  }

  function renderFeed(feed) {
    // 1. Subsections / Categories
    if (feed.subsections.length) {
      subsectionsGrid.hidden = false;
      subsectionsGrid.replaceChildren(
        ...feed.subsections.map((sub) => {
          const btn = el(
            'button',
            { type: 'button', class: 'opds-cat-card' },
            el('span', { class: 'opds-cat-icon' }, '📁'),
            el('div', { class: 'opds-cat-info' },
              el('b', {}, sub.title),
              sub.summary ? el('small', {}, sub.summary) : null
            )
          );
          btn.onclick = () => {
            history.push({ url: feed.url, title: feed.title });
            loadUrl(sub.url, sub.title);
          };
          return btn;
        })
      );
    } else {
      subsectionsGrid.hidden = true;
    }

    // 2. Books
    if (feed.books.length) {
      booksGrid.hidden = false;
      booksGrid.replaceChildren(...feed.books.map((b) => renderBookCard(b)));
    } else {
      booksGrid.hidden = true;
    }

    // 3. Pagination (Next / Prev)
    const paginationItems = [];
    if (feed.prevUrl) {
      const prevBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, '‹ Previous');
      prevBtn.onclick = () => loadUrl(feed.prevUrl, 'Previous page');
      paginationItems.push(prevBtn);
    }
    if (feed.nextUrl) {
      const nextBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Next page ›');
      nextBtn.onclick = () => loadUrl(feed.nextUrl, 'Next page');
      paginationItems.push(nextBtn);
    }
    if (paginationItems.length) {
      paginationBar.hidden = false;
      paginationBar.replaceChildren(...paginationItems);
    } else {
      paginationBar.hidden = true;
    }
  }

  function renderBookCard(book) {
    const isAcquiring = downloading.has(book.id);
    const primaryAcquisition = book.acquisitions.find((a) => a.format === 'epub') || book.acquisitions[0];
    const safeFilename = primaryAcquisition
      ? makeSafeFilename(book.author, book.title, primaryAcquisition.format)
      : '';
    const alreadyAcquired = safeFilename && acquiredKeys.has(safeFilename.toLowerCase());

    const coverContainer = el('div', { class: 'opds-book-cover' });
    if (book.thumbUrl || book.coverUrl) {
      const imgUrl = activeCatalog.useProxy ? proxyUrl(book.thumbUrl || book.coverUrl) : (book.thumbUrl || book.coverUrl);
      const img = el('img', { alt: book.title, loading: 'lazy' });
      img.src = imgUrl;
      img.onerror = () => {
        // Fallback to proxy if direct failed
        if (!activeCatalog.useProxy) {
          img.src = proxyUrl(book.thumbUrl || book.coverUrl);
        }
      };
      coverContainer.append(img);
    } else {
      coverContainer.append(el('span', { class: 'opds-book-fallback-cover' }, book.title));
    }

    const titleEl = el('h3', { class: 'opds-book-title' }, book.title);
    const authorEl = el('p', { class: 'opds-book-author' }, book.author || 'Unknown author');
    
    // Action button
    let actionBtn;
    if (alreadyAcquired) {
      actionBtn = el('button', { type: 'button', class: 'btn btn-sm btn-quiet opds-in-lib' }, '✓ In Library');
      actionBtn.onclick = async () => {
        const item = (await store.items.all()).find((i) => i.name.toLowerCase() === safeFilename.toLowerCase());
        if (item) {
          closeDialog();
          app.openBook(item);
        }
      };
    } else if (isAcquiring) {
      actionBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: true }, 'Downloading…');
    } else if (primaryAcquisition) {
      actionBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary' }, `Acquire ${primaryAcquisition.format.toUpperCase()}`);
      actionBtn.onclick = () => acquireBook(book, primaryAcquisition, actionBtn);
    } else {
      actionBtn = el('span', { class: 'hint' }, 'No download link');
    }

    return el(
      'div',
      { class: 'opds-book-card' },
      coverContainer,
      el('div', { class: 'opds-book-details' },
        titleEl,
        authorEl,
        book.summary ? el('p', { class: 'opds-book-summary' }, book.summary.replace(/<[^>]+>/g, '').slice(0, 140) + '…') : null,
        el('div', { class: 'opds-book-actions' }, actionBtn)
      )
    );
  }

  async function acquireBook(book, acquisition, button) {
    downloading.add(book.id);
    button.disabled = true;
    button.textContent = 'Acquiring…';
    toast(`Downloading “${book.title}”…`);

    try {
      // 1. Download book file
      const downloadRes = await opdsFetch(acquisition.url, activeCatalog);
      if (!downloadRes.ok) {
        throw new Error(`Download failed: HTTP ${downloadRes.status}`);
      }
      const arrayBuf = await downloadRes.arrayBuffer();
      const mime = acquisition.format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
      const blob = new Blob([arrayBuf], { type: mime });

      // 2. Identify destination source (dedicated Books library, S3 archive, Dropbox, or device)
      const sources = store.getSources();
      const prefs = store.getPrefs();
      let targetSource = sources.find((s) => s.id === prefs.booksHome && library.canWrite(s)) ||
                         sources.find((s) => (s.type === 's3' || s.type === 'r2') && library.canWrite(s)) ||
                         sources.find((s) => (s.type === 'dropbox' || s.type === 'webdav' || s.type === 'github') && library.canWrite(s)) ||
                         library.deviceSource(true);

      const filename = makeSafeFilename(book.author, book.title, acquisition.format);
      const root = String(targetSource.root || '').replace(/^\/+|\/+$/g, '');
      const path = [root, filename].filter(Boolean).join('/');
      const itemKey = store.keyOf(targetSource.id, path);

      // 3. Save binary blob into library
      const item = {
        key: itemKey,
        sourceId: targetSource.id,
        path,
        folder: root,
        name: filename,
        kind: acquisition.format === 'pdf' ? 'pdf' : 'epub',
        sha: `opds:${Date.now()}`,
        addedAt: Date.now(),
      };

      await store.items.put(item);
      await store.blobs.put({
        key: itemKey,
        sourceId: targetSource.id,
        sha: item.sha,
        blob,
      });

      // Try uploading to remote storage if connected
      try {
        if (targetSource.type === 'dropbox') {
          const { upload } = await import('../sources/dropbox.js');
          await upload(targetSource, path, blob);
        } else if (targetSource.type === 'webdav') {
          const { putBlob } = await import('../sources/webdav.js');
          await putBlob(targetSource, path, blob);
        } else if (targetSource.type === 's3' || targetSource.type === 'r2') {
          const { putBlob } = await import('../sources/s3.js');
          await putBlob(targetSource, path, blob);
        }
      } catch (uploadErr) {
        console.warn('Saved on device, cloud upload pending:', uploadErr);
      }

      // 4. Pre-generate cover thumbnail
      try {
        await getCover(item);
      } catch {}

      downloading.delete(book.id);
      acquiredKeys.add(filename.toLowerCase());
      button.textContent = '✓ In Library';
      button.className = 'btn btn-sm btn-quiet opds-in-lib';
      button.disabled = false;
      button.onclick = () => {
        closeDialog();
        app.openBook(item);
      };

      toast(`Acquired “${book.title}” to library!`, {
        label: 'Read now',
        run: () => {
          closeDialog();
          app.openBook(item);
        },
      });

      window.dispatchEvent(new CustomEvent('readover:shelf-refresh'));
    } catch (err) {
      downloading.delete(book.id);
      button.disabled = false;
      button.textContent = `Acquire ${acquisition.format.toUpperCase()}`;
      toast(`Failed to acquire book: ${err.message}`);
    }
  }

  // Search filter inside current feed
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = searchInput.value.trim().toLowerCase();
      if (!currentFeed) return;
      if (!q) {
        renderFeed(currentFeed);
        return;
      }
      const filteredBooks = currentFeed.books.filter(
        (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      );
      const filteredSub = currentFeed.subsections.filter((s) => s.title.toLowerCase().includes(q));
      renderFeed({
        ...currentFeed,
        books: filteredBooks,
        subsections: filteredSub,
      });
    }, 150);
  });

  function openAddCatalogModal() {
    const nameInput = el('input', { name: 'name', placeholder: 'My Calibre Server', required: true });
    const urlInput = el('input', { name: 'url', placeholder: 'http://192.168.1.50:8083/opds', required: true, autocapitalize: 'off', spellcheck: 'false' });
    const userInput = el('input', { name: 'username', placeholder: 'Optional', autocapitalize: 'off', spellcheck: 'false' });
    const passInput = el('input', { name: 'password', type: 'password', placeholder: 'Optional', autocomplete: 'off' });
    const proxyCheck = el('input', { type: 'checkbox', name: 'useProxy', checked: true });

    const presetsContainer = el(
      'div',
      { class: 'opds-presets-row' },
      el('button', { type: 'button', class: 'preset-chip' }, 'Standard Ebooks'),
      el('button', { type: 'button', class: 'preset-chip' }, 'Project Gutenberg'),
      el('button', { type: 'button', class: 'preset-chip' }, 'Calibre / Web'),
      el('button', { type: 'button', class: 'preset-chip' }, 'Kavita / Komga')
    );

    const presetChips = presetsContainer.querySelectorAll('.preset-chip');
    presetChips[0].onclick = () => {
      nameInput.value = 'Standard Ebooks';
      urlInput.value = 'https://standardebooks.org/opds/all';
      proxyCheck.checked = false;
    };
    presetChips[1].onclick = () => {
      nameInput.value = 'Project Gutenberg';
      urlInput.value = 'https://m.gutenberg.org/ebooks.opds/';
      proxyCheck.checked = false;
    };
    presetChips[2].onclick = () => {
      nameInput.value = 'Calibre Library';
      urlInput.value = 'http://192.168.1.100:8083/opds';
      proxyCheck.checked = true;
    };
    presetChips[3].onclick = () => {
      nameInput.value = 'Kavita OPDS';
      urlInput.value = 'http://192.168.1.100:5000/api/opds';
      proxyCheck.checked = true;
    };

    const addForm = el(
      'form',
      { class: 'sheet-inner', method: 'dialog' },
      el('div', { class: 'sheet-head' },
        el('h2', {}, 'Connect OPDS Catalog'),
        el('button', { class: 'icon-btn', value: 'cancel', formnovalidate: true, 'aria-label': 'Close' }, icon('close'))
      ),
      el('p', { class: 'hint' }, 'Connect open-access public domain catalogs or self-hosted Calibre, Kavita, or Komga book servers.'),
      presetsContainer,
      el('label', { class: 'field' }, 'Catalog Name', nameInput),
      el('label', { class: 'field' }, 'OPDS Feed URL', urlInput),
      el('div', { class: 'field-pair' },
        el('label', { class: 'field' }, 'Username (optional)', userInput),
        el('label', { class: 'field' }, 'Password (optional)', passInput)
      ),
      el('label', { class: 'checkbox-field' },
        proxyCheck,
        el('span', {}, ' Route through CORS proxy (recommended for local LAN / self-hosted servers)')
      ),
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-primary', value: 'save' }, 'Save Catalog')
      )
    );

    const addDialog = el('dialog', { class: 'sheet' }, addForm);
    document.body.append(addDialog);
    openSheet(addDialog).then(async (val) => {
      if (val === 'save' && urlInput.value.trim()) {
        const newCat = {
          id: `opds-${Date.now().toString(36)}`,
          name: nameInput.value.trim() || 'Book Catalog',
          url: urlInput.value.trim(),
          username: userInput.value.trim(),
          password: passInput.value.trim(),
          useProxy: proxyCheck.checked,
        };
        if (typeof store.saveOpdsCatalog === 'function') {
          store.saveOpdsCatalog(newCat);
        } else {
          const list = fetchCatalogs();
          const idx = list.findIndex((c) => c.id === newCat.id);
          if (idx >= 0) list[idx] = newCat;
          else list.push(newCat);
          localStorage.setItem('readover.opdsCatalogs', JSON.stringify(list));
        }
        updateCatalogOptions();
        activeCatalog = newCat;
        catalogSelect.value = newCat.id;
        history = [];
        loadUrl(newCat.url, newCat.name);
        toast(`Connected ${newCat.name}`);
      }
      addDialog.remove();
    });
  }

  // Initial load
  updateCatalogOptions();
  if (options.initialCatalogId) {
    const target = catalogs.find((c) => c.id === options.initialCatalogId);
    if (target) {
      activeCatalog = target;
      catalogSelect.value = target.id;
    }
  }
  loadUrl(activeCatalog.url, activeCatalog.name);
  if (options.openAdd) {
    setTimeout(() => openAddCatalogModal(), 100);
  }
}
