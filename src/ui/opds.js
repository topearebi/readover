// OPDS Catalog Browser ("Browse Remote, Stash Local")
// On-demand catalog browser and book acquirer for Standard Ebooks, Project Gutenberg,
// Calibre, Kavita, Komga, and custom self-hosted OPDS servers.

import * as store from '../store.js';
import * as library from '../library.js';
import { loadCatalogFeed, makeSafeFilename, opdsFetch, proxyUrl, PRESET_CATALOGS } from '../sources/opds.js';
import { getCover } from '../covers.js';
import { el, icon, openSheet, toast, pushOverlay } from './overlay.js';

// Safe catalog helpers
export function fetchCatalogs() {
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

export function openOpdsBrowser(app, options = {}) {
  const dialog = el('dialog', { class: 'sheet sheet-tall opds-browser-sheet', 'aria-label': 'OPDS Book Catalogs' });
  
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
  const errorPanel = el('div', { class: 'opds-error-panel', hidden: true });
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
    errorPanel,
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

  const handleCatalogAdded = (newCat) => {
    updateCatalogOptions();
    activeCatalog = newCat;
    catalogSelect.value = newCat.id;
    history = [];
    loadUrl(newCat.url, newCat.name);
  };

  addCatalogBtn.onclick = () => openAddCatalogModal(handleCatalogAdded);

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
    errorPanel.hidden = true;
    errorPanel.replaceChildren();
    statusLine.hidden = false;
    statusLine.textContent = `Connecting to ${title}…`;
    subsectionsGrid.replaceChildren();
    subsectionsGrid.hidden = true;
    booksGrid.replaceChildren();
    booksGrid.hidden = true;
    paginationBar.hidden = true;
    updateBreadcrumbs();

    try {
      await checkAcquiredBooks();
      currentFeed = await loadCatalogFeed(activeCatalog, url);
      statusLine.hidden = false;
      statusLine.textContent = currentFeed.books.length
        ? `${currentFeed.books.length} publications found`
        : currentFeed.subsections.length
        ? `${currentFeed.subsections.length} sections`
        : 'No publications found in this section.';
      renderFeed(currentFeed);
    } catch (err) {
      statusLine.hidden = true;
      showErrorState(err, url, title);
    }
  }

  function showErrorState(err, url, title) {
    errorPanel.hidden = false;
    subsectionsGrid.hidden = true;
    booksGrid.hidden = true;
    paginationBar.hidden = true;

    const errMsg = err?.message || String(err);
    const isCorsOrNetwork = /cors|failed to fetch|network|load failed|offline/i.test(errMsg);
    const isNotFound = /404|not found/i.test(errMsg);
    const isAuth = /401|403|unauthorized|forbidden|credentials/i.test(errMsg);
    const isHtmlOrParse = /html|parse|xml|syntax/i.test(errMsg);
    const isSelfHosted = /topearebi\.xyz|localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\.local/i.test(url);

    let errorHeading = 'Connection Failed';
    let errorExplanation = errMsg;
    let adviceText = 'Please check your internet connection and the catalog URL.';

    if (isCorsOrNetwork) {
      if (isSelfHosted) {
        errorHeading = 'CORS Blocked on Self-Hosted Server';
        errorExplanation = `The browser was prevented from directly accessing "${url}" because the server did not return "Access-Control-Allow-Origin" CORS headers.`;
        adviceText = 'Self-hosted servers should allow CORS in their reverse proxy (Caddy / Nginx) to connect directly with zero proxy latency and secure credential handling.';
      } else {
        errorHeading = 'CORS or Network Restriction';
        errorExplanation = 'This public catalog does not provide browser CORS headers and public gateways could not process the feed.';
        adviceText = 'Configure a personal CORS proxy (such as a free Cloudflare Worker) in Settings to access this feed reliably.';
      }
    } else if (isNotFound) {
      errorHeading = 'Catalog Endpoint Not Found (404)';
      errorExplanation = `The feed URL returned a 404 response: ${url}`;
      adviceText = 'Check the catalog URL path. OPDS endpoints typically end in /opds/, /opds/all, or /catalog.atom.';
    } else if (isAuth) {
      errorHeading = 'Authentication Required';
      errorExplanation = 'This catalog requires valid login credentials.';
      adviceText = 'Update your username and password by editing the catalog settings.';
    } else if (isHtmlOrParse) {
      errorHeading = 'Invalid OPDS Feed';
      errorExplanation = errMsg;
      adviceText = 'The server returned an HTML web page rather than an Atom XML or JSON-LD OPDS catalog feed.';
    }

    const titleEl = el('h3', { class: 'opds-error-title' }, errorHeading);
    const msgEl = el('p', { class: 'opds-error-msg' }, errorExplanation);
    const adviceEl = el('p', { class: 'opds-error-advice' }, adviceText);

    // Interactive Action Controls
    const actions = [];

    // 1. Retry Connection
    const retryBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Retry Connection');
    retryBtn.onclick = () => loadUrl(url, title);
    actions.push(retryBtn);

    // 2. Self-Hosted: View Caddy Config
    if (isCorsOrNetwork && isSelfHosted) {
      const caddyBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, '📋 View Caddy CORS Config');
      caddyBtn.onclick = () => showCaddyConfigModal();
      actions.push(caddyBtn);
    }

    // 3. Configure Proxy in Settings
    if (isCorsOrNetwork) {
      const settingsBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, '⚙ Configure Proxy in Settings');
      settingsBtn.onclick = () => {
        closeDialog();
        if (typeof app?.openSettings === 'function') {
          app.openSettings('tab-sources');
        } else {
          document.getElementById('settings-btn')?.click();
        }
      };
      actions.push(settingsBtn);
    }

    // 4. Retry with Forced CORS Proxy (only if not forcing and no credentials)
    if (!activeCatalog.useProxy && !activeCatalog.username) {
      const forceProxyBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Force CORS Proxy');
      forceProxyBtn.onclick = () => {
        activeCatalog.useProxy = true;
        if (typeof store.saveOpdsCatalog === 'function') {
          store.saveOpdsCatalog(activeCatalog);
        }
        loadUrl(url, title);
      };
      actions.push(forceProxyBtn);
    }

    // 5. Back to Previous View (if history > 0)
    if (history.length > 0) {
      const prev = history[history.length - 1];
      const backBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, `‹ Back to ${prev.title || 'Previous'}`);
      backBtn.onclick = () => {
        history.pop();
        loadUrl(prev.url, prev.title);
      };
      actions.push(backBtn);
    }

    // 6. Return to Catalog Root (if not at root)
    if (url !== activeCatalog.url) {
      const rootBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, `Return to ${activeCatalog.name}`);
      rootBtn.onclick = () => {
        history = [];
        loadUrl(activeCatalog.url, activeCatalog.name);
      };
      actions.push(rootBtn);
    }

    // 7. Edit Catalog Settings
    const editBtn = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Edit Catalog Details');
    editBtn.onclick = () => openAddCatalogModal(handleCatalogAdded, activeCatalog);
    actions.push(editBtn);

    const actionsRow = el('div', { class: 'opds-error-actions' }, ...actions);

    errorPanel.replaceChildren(
      el('div', { class: 'opds-error-icon' }, '⚠️'),
      titleEl,
      msgEl,
      adviceEl,
      actionsRow
    );
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
    setTimeout(() => openAddCatalogModal(handleCatalogAdded), 100);
  }
}

export function showCaddyConfigModal() {
  const caddySnippet = `books.topearebi.xyz {
    # CORS preflight handler
    @cors_preflight method OPTIONS
    handle @cors_preflight {
        header Access-Control-Allow-Origin "*"
        header Access-Control-Allow-Methods "GET, POST, OPTIONS, HEAD"
        header Access-Control-Allow-Headers "Authorization, Content-Type, Accept, Range, X-Requested-With"
        header Access-Control-Max-Age "86400"
        respond 204
    }

    # CORS headers for actual requests
    header Access-Control-Allow-Origin "*"
    header Access-Control-Allow-Methods "GET, POST, OPTIONS, HEAD"
    header Access-Control-Allow-Headers "Authorization, Content-Type, Accept, Range, X-Requested-With"
    header Access-Control-Expose-Headers "Content-Length, Content-Range"

    reverse_proxy localhost:8083 # Adjust port to your Calibre/Kavita backend
}`;

  const preEl = el('pre', { style: 'background: var(--bg-card); padding: 0.75rem; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; user-select: all; border: 1px solid var(--border); max-height: 240px;' }, caddySnippet);
  const copyBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Copy Caddyfile Block');
  copyBtn.onclick = () => {
    navigator.clipboard?.writeText?.(caddySnippet);
    toast('✓ Caddy configuration copied to clipboard!');
  };

  const caddyDialog = el('dialog', { class: 'sheet' },
    el('div', { class: 'sheet-inner' },
      el('div', { class: 'sheet-head' },
        el('h2', {}, 'Caddy CORS Configuration'),
        el('button', { class: 'icon-btn', 'aria-label': 'Close' }, icon('close'))
      ),
      el('p', { class: 'hint' }, 'Add these CORS directives to your Caddyfile for books.topearebi.xyz. This allows Readover on GitHub Pages or localhost to connect directly with zero proxy hops and full credential support.'),
      preEl,
      el('div', { class: 'row-actions', style: 'margin-top: 1rem;' }, copyBtn)
    )
  );
  document.body.append(caddyDialog);
  const closeBtn = caddyDialog.querySelector('.icon-btn');
  closeBtn.onclick = () => caddyDialog.remove();
  openSheet(caddyDialog).then(() => caddyDialog.remove());
}

export function openAddCatalogModal(onAdded, existingCat = null) {
  const nameInput = el('input', { name: 'name', placeholder: 'My Calibre Server', value: existingCat?.name || '', required: true });
  const urlInput = el('input', { name: 'url', placeholder: 'http://192.168.1.50:8083/opds', value: existingCat?.url || '', required: true, autocapitalize: 'off', spellcheck: 'false' });
  const userInput = el('input', { name: 'username', placeholder: 'Optional', value: existingCat?.username || '', autocapitalize: 'off', spellcheck: 'false' });
  const passInput = el('input', { name: 'password', type: 'password', placeholder: 'Optional', value: existingCat?.password || '', autocomplete: 'off' });
  const proxyCheck = el('input', { type: 'checkbox', name: 'useProxy', checked: existingCat ? Boolean(existingCat.useProxy) : false });
  const customProxyInput = el('input', { name: 'corsProxy', placeholder: 'Optional catalog-specific proxy override', value: existingCat?.corsProxy || '', autocapitalize: 'off', spellcheck: 'false' });

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
    urlInput.value = 'https://standardebooks.org/opds/';
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
    proxyCheck.checked = false;
  };
  presetChips[3].onclick = () => {
    nameInput.value = 'Kavita OPDS';
    urlInput.value = 'http://192.168.1.100:5000/api/opds';
    proxyCheck.checked = false;
  };

  const addForm = el(
    'form',
    { class: 'sheet-inner', method: 'dialog' },
    el('div', { class: 'sheet-head' },
      el('h2', {}, existingCat ? 'Edit OPDS Catalog' : 'Connect OPDS Catalog'),
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
    el('label', { class: 'field' }, 'Custom CORS Proxy (optional override)', customProxyInput),
    el('label', { class: 'checkbox-field' },
      proxyCheck,
      el('span', {}, ' Force route through CORS proxy (Settings proxy or public fallback)')
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-primary', value: 'save' }, existingCat ? 'Save Changes' : 'Save Catalog')
    )
  );

  const addDialog = el('dialog', { class: 'sheet' }, addForm);
  document.body.append(addDialog);
  return openSheet(addDialog).then(async (val) => {
    if (val === 'save' && urlInput.value.trim()) {
      const newCat = {
        id: existingCat?.id || `opds-${Date.now().toString(36)}`,
        name: nameInput.value.trim() || 'Book Catalog',
        url: urlInput.value.trim(),
        username: userInput.value.trim(),
        password: passInput.value.trim(),
        corsProxy: customProxyInput.value.trim(),
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
      toast(existingCat ? `Updated ${newCat.name}` : `Connected ${newCat.name}`);
      if (typeof onAdded === 'function') {
        onAdded(newCat);
      }
      window.dispatchEvent(new CustomEvent('readover:shelf-refresh'));
      addDialog.remove();
      return newCat;
    }
    addDialog.remove();
    return null;
  });
}

export const showAddCatalogSheet = openAddCatalogModal;
