// OPDS Catalog Browser: "Browse Remote, Stash Local".
// Interactive feed navigation, book search, and smart acquisition.

import * as opds from '../sources/opds.js';
import * as store from '../store.js';
import * as library from '../library.js';
import { el, icon, toast, pushOverlay } from './overlay.js';
import { sheet, menu } from './sheet.js';

const tones = ['#2e5b4f', '#5a4632', '#3b4a63', '#6b3b3b', '#4a5530', '#40384f'];
function toneFor(str = '') {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
}

/**
 * Opens an on-demand OPDS catalog browser modal.
 */
export async function openCatalogBrowser(catalog, opts = {}) {
  const history = [catalog.url];
  let currentFeed = null;
  let loading = false;

  const backBtn = el('button', { class: 'icon-btn', 'aria-label': 'Back', title: 'Back', disabled: true }, icon('back'));
  const titleEl = el('span', { class: 'title' }, catalog.name);
  const searchBtn = el('button', { class: 'icon-btn', 'aria-label': 'Search catalog', title: 'Search' }, icon('search'));
  const closeBtn = el('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close' }, icon('close'));

  const header = el('div', { class: 'reader-bar opds-bar' }, backBtn, titleEl, searchBtn, closeBtn);
  const content = el('div', { class: 'opds-content' });
  const root = el('div', { class: 'reader opds-browser', role: 'dialog', 'aria-modal': 'true', 'aria-label': catalog.name }, header, content);

  const close = pushOverlay(() => {
    root.remove();
  }, { element: root });

  closeBtn.onclick = close;

  backBtn.onclick = () => {
    if (history.length > 1) {
      history.pop();
      navigateTo(history[history.length - 1], false);
    }
  };

  searchBtn.onclick = async () => {
    if (!currentFeed?.searchTemplate) {
      toast('This feed does not advertise a search template.');
      return;
    }
    const qInput = el('input', { type: 'search', placeholder: 'Search titles or authors…', required: true });
    const { value } = await sheet({
      title: `Search ${catalog.name}`,
      fields: [qInput],
      submit: 'Search',
      onOpen: () => setTimeout(() => qInput.focus(), 50),
    });
    if (value === 'ok' && qInput.value.trim()) {
      const template = currentFeed.searchTemplate.href;
      // Replace {searchTerms} or append query parameter
      let searchUrl = template;
      if (searchUrl.includes('{searchTerms}')) {
        searchUrl = searchUrl.replace('{searchTerms}', encodeURIComponent(qInput.value.trim()));
      } else {
        const sep = searchUrl.includes('?') ? '&' : '?';
        searchUrl = `${searchUrl}${sep}q=${encodeURIComponent(qInput.value.trim())}`;
      }
      navigateTo(searchUrl);
    }
  };

  async function navigateTo(url, push = true) {
    if (loading) return;
    loading = true;
    if (push && history[history.length - 1] !== url) history.push(url);
    backBtn.disabled = history.length <= 1;

    content.replaceChildren(
      el('div', { class: 'opds-loading' }, el('p', { class: 'hint' }, 'Loading catalog…'))
    );

    try {
      const feed = await opds.loadFeed(url, catalog);
      currentFeed = feed;
      titleEl.textContent = feed.title || catalog.name;
      renderFeed(feed);
    } catch (err) {
      console.warn('OPDS load error:', err);
      content.replaceChildren(
        el(
          'div',
          { class: 'opds-error' },
          el('h3', {}, 'Could not load feed'),
          el('p', { class: 'hint' }, err.message),
          el(
            'div',
            { class: 'row-actions' },
            el('button', { class: 'btn btn-primary', onclick: () => navigateTo(url, false) }, 'Retry'),
            el('button', { class: 'btn btn-quiet', onclick: () => opts.onOpenSettings?.() }, 'Check CORS / Settings')
          )
        )
      );
    } finally {
      loading = false;
    }
  }

  function renderFeed(feed) {
    const nodes = [];

    // Subtitle / description if present
    if (feed.subtitle) {
      nodes.push(el('p', { class: 'hint opds-subtitle' }, feed.subtitle));
    }

    // Navigation sections
    if (feed.navigation?.length) {
      const navButtons = feed.navigation.map((nav) => {
        const btn = el(
          'button',
          { type: 'button', class: 'opds-nav-item' },
          el('span', { class: 'opds-nav-title' }, nav.title),
          nav.count != null ? el('small', {}, `${nav.count}`) : el('span', { class: 'opds-nav-arrow' }, '→')
        );
        btn.onclick = () => navigateTo(nav.href);
        return btn;
      });
      nodes.push(el('div', { class: 'opds-nav-grid' }, ...navButtons));
    }

    // Book entries
    if (feed.books?.length) {
      const bookCards = feed.books.map((book) => {
        const coverEl = el('div', { class: 'shelf-cover', style: `--tone:${toneFor(book.title)}` });
        if (book.coverUrl) {
          const proxiedCover = opds.proxiedUrl(book.coverUrl, catalog.corsProxy);
          const img = el('img', { alt: '', src: proxiedCover, loading: 'lazy' });
          img.onerror = () => coverEl.replaceChildren(el('span', {}, book.title));
          coverEl.append(img);
        } else {
          coverEl.append(el('span', {}, book.title));
        }

        const btn = el(
          'button',
          { type: 'button', class: 'shelf-book opds-book-card', title: book.title },
          coverEl,
          el('span', { class: 'shelf-title' }, book.title),
          el('span', { class: 'shelf-meta' }, book.authors.join(', '))
        );

        btn.onclick = () => showBookDetails(book);
        return btn;
      });

      nodes.push(el('div', { class: 'shelf-grid opds-book-grid' }, ...bookCards));
    }

    // Pagination / Next page
    if (feed.nextPageUrl) {
      const nextBtn = el('button', { type: 'button', class: 'btn btn-quiet opds-next-btn' }, 'Load more books…');
      nextBtn.onclick = async () => {
        nextBtn.disabled = true;
        nextBtn.textContent = 'Loading…';
        try {
          const nextFeed = await opds.loadFeed(feed.nextPageUrl, catalog);
          feed.nextPageUrl = nextFeed.nextPageUrl;
          feed.books.push(...nextFeed.books);
          renderFeed(feed);
        } catch (err) {
          toast(`Could not load more: ${err.message}`);
          nextBtn.disabled = false;
          nextBtn.textContent = 'Load more books…';
        }
      };
      nodes.push(el('div', { class: 'opds-footer' }, nextBtn));
    }

    if (!feed.navigation?.length && !feed.books?.length) {
      nodes.push(el('p', { class: 'hint opds-empty' }, 'No books or sections found in this feed.'));
    }

    content.replaceChildren(...nodes);
  }

  /**
   * Book Detail Modal with Smart Default Destination and Inline Override.
   */
  async function showBookDetails(book) {
    const prefs = store.getPrefs();
    const sources = store.getSources();
    
    // Determine configured book destination
    let destSrc = null;
    if (prefs.acquiredBooksHome) {
      destSrc = sources.find((s) => s.id === prefs.acquiredBooksHome && library.canWrite(s));
    }
    if (!destSrc) {
      // Fallback priority: S3/R2 -> Dropbox -> WebDAV -> This Device
      destSrc = sources.find((s) => (s.type === 's3' || s.type === 'r2') && library.canWrite(s)) ||
        sources.find((s) => s.type === 'dropbox' && library.canWrite(s)) ||
        sources.find((s) => s.type === 'webdav' && library.canWrite(s)) ||
        library.deviceSource(true);
    }

    let activeTarget = destSrc;

    // Pick best acquisition link (prefer EPUB, then PDF, then first)
    const epubLink = book.acquisitions.find((a) => a.type.includes('epub')) || book.acquisitions[0];
    if (!epubLink) {
      toast('No direct download link available for this book.');
      return;
    }

    const coverBox = el('div', { class: 'shelf-cover opds-modal-cover', style: `--tone:${toneFor(book.title)}` });
    if (book.coverUrl) {
      const proxiedCover = opds.proxiedUrl(book.coverUrl, catalog.corsProxy);
      const img = el('img', { alt: book.title, src: proxiedCover });
      coverBox.append(img);
    } else {
      coverBox.append(el('span', {}, book.title));
    }

    const authorsEl = el('p', { class: 'book-author' }, book.authors.join(', '));
    const summaryEl = el('div', { class: 'opds-modal-summary' }, el('p', {}, book.summary || 'No description available.'));
    
    const targetLabel = el('span', { class: 'hint opds-dest-label' }, `Saving to: ${library.displayName(activeTarget)} `);
    const overrideBtn = el('button', { type: 'button', class: 'linklike opds-override-btn' }, '· Change to This Device');
    
    overrideBtn.onclick = () => {
      const dev = library.deviceSource(true);
      if (activeTarget.id === dev.id && destSrc.id !== dev.id) {
        activeTarget = destSrc;
        targetLabel.textContent = `Saving to: ${library.displayName(activeTarget)} `;
        overrideBtn.textContent = '· Change to This Device';
      } else {
        activeTarget = dev;
        targetLabel.textContent = `Saving to: This Device `;
        overrideBtn.textContent = `· Revert to ${library.displayName(destSrc)}`;
      }
    };

    const destRow = el('div', { class: 'opds-dest-row' }, targetLabel, overrideBtn);
    const progressEl = el('p', { class: 'hint opds-progress', hidden: true }, '');

    const formatTag = epubLink.title || 'EPUB';
    const acquireBtn = el('button', { type: 'button', class: 'btn btn-primary btn-acquire' }, `Acquire (${formatTag})`);

    const acquireWrap = el('div', { class: 'opds-acquire-wrap' }, acquireBtn, destRow, progressEl);

    let modalRef = null;
    acquireBtn.onclick = async () => {
      acquireBtn.disabled = true;
      progressEl.hidden = false;
      progressEl.textContent = 'Connecting to catalog…';

      try {
        const blob = await opds.downloadBook(epubLink.href, catalog, (msg) => {
          progressEl.textContent = `Downloading: ${msg}`;
        });

        progressEl.textContent = 'Stashing into your library…';
        const ext = epubLink.type.includes('pdf') ? 'pdf' : 'epub';
        const cleanTitle = book.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Book';
        const filename = `books/${cleanTitle}.${ext}`;

        let coverBlob = null;
        if (book.coverUrl) {
          try {
            const cRes = await opds.fetchWithFallback(book.coverUrl, {}, catalog.corsProxy);
            if (cRes.ok) coverBlob = await cRes.blob();
          } catch {}
        }

        const savedItem = await library.saveAcquiredBook(activeTarget, filename, blob, {
          title: book.title,
          authors: book.authors,
          coverBlob,
        });

        toast(`Acquired: “${book.title}” saved to ${library.displayName(activeTarget)}`);
        modalRef?.close();
        opts.onAcquire?.(savedItem);
      } catch (err) {
        progressEl.textContent = `Failed: ${err.message}`;
        acquireBtn.disabled = false;
        toast(`Acquisition failed: ${err.message}`);
      }
    };

    await sheet({
      title: book.title,
      fields: [coverBox, authorsEl, summaryEl, acquireWrap],
      tall: true,
      onOpen: (_f, dialog) => {
        modalRef = dialog;
      },
    });
  }

  document.body.append(root);
  navigateTo(catalog.url);
}
