// src/viewers/epub-viewer.js
import { saveReadingProgress, getReadingProgress } from '../db.js';

let ePubEngine = null;

async function getEpubEngine() {
  if (ePubEngine) return ePubEngine;

  try {
    // esm.sh bundles jszip and transitive dependencies cleanly
    const module = await import('https://esm.sh/epubjs@0.3.93?bundle');
    ePubEngine = module.default || module;
    return ePubEngine;
  } catch (err) {
    console.error('Failed to import ePub engine:', err);
    throw new Error('Epub reader engine could not be loaded from network.');
  }
}

/**
 * Mounts and opens the full-screen paginated EPUB reader modal.
 * 
 * @param {string} path - Document relative path
 * @param {Blob|File|ArrayBuffer} epubSource - Binary source
 * @param {string} title - Document title
 */
export async function openEpubViewer(path, epubSource, title = 'Book') {
  let modal = document.getElementById('epub-viewer-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'epub-viewer-modal';
    modal.className = 'reader-modal epub-modal';
    modal.innerHTML = `
      <div class="reader-header">
        <div class="reader-header-left">
          <span class="format-badge epub">EPUB</span>
          <span id="epub-title" class="card-folder-badge" style="max-width: 200px;"></span>
          <span id="epub-progress-indicator" class="reader-status">Loading...</span>
        </div>
        <div class="reader-header-right">
          <button id="epub-font-decrease" class="reader-action-btn" title="Decrease Font">A−</button>
          <button id="epub-font-increase" class="reader-action-btn" title="Increase Font">A+</button>
          <button id="epub-close-btn" class="reader-close-btn">✕ Done</button>
        </div>
      </div>
      <div class="epub-viewport-container" style="flex: 1; position: relative; width: 100%; height: calc(100% - 56px); display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <button id="epub-prev-btn" class="epub-nav-zone left" aria-label="Previous Page" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); width: 44px; height: 64px; border-radius: 8px; border: none; background: rgba(0,0,0,0.18); color: var(--text-primary); font-size: 28px; cursor: pointer; z-index: 20; display: flex; align-items: center; justify-content: center;">‹</button>
        <div id="epub-render-area" class="epub-render-area" style="width: 100%; height: 100%; max-width: 760px; margin: 0 auto;"></div>
        <button id="epub-next-btn" class="epub-nav-zone right" aria-label="Next Page" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 44px; height: 64px; border-radius: 8px; border: none; background: rgba(0,0,0,0.18); color: var(--text-primary); font-size: 28px; cursor: pointer; z-index: 20; display: flex; align-items: center; justify-content: center;">›</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const titleEl = modal.querySelector('#epub-title');
  const indicatorEl = modal.querySelector('#epub-progress-indicator');
  const renderArea = modal.querySelector('#epub-render-area');
  const prevBtn = modal.querySelector('#epub-prev-btn');
  const nextBtn = modal.querySelector('#epub-next-btn');
  const fontDecBtn = modal.querySelector('#epub-font-decrease');
  const fontIncBtn = modal.querySelector('#epub-font-increase');
  const closeBtn = modal.querySelector('#epub-close-btn');

  titleEl.textContent = title;
  indicatorEl.textContent = 'Unpacking book...';
  renderArea.innerHTML = '';
  modal.classList.add('open');

  let book = null;
  let rendition = null;
  let currentFontSize = 105;

  const teardown = () => {
    window.removeEventListener('keydown', handleKeydown);
    modal.classList.remove('open');
    if (rendition) {
      try { rendition.destroy(); } catch (e) {}
    }
    if (book) {
      try { book.destroy(); } catch (e) {}
    }
    renderArea.innerHTML = '';
  };

  closeBtn.onclick = teardown;

  // Keyboard Navigation
  const handleKeydown = (e) => {
    if (!modal.classList.contains('open') || !rendition) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      rendition.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      rendition.prev();
    }
  };
  window.addEventListener('keydown', handleKeydown);

  try {
    const ePub = await getEpubEngine();

    let arrayBuffer;
    if (epubSource instanceof ArrayBuffer) {
      arrayBuffer = epubSource;
    } else if (epubSource instanceof Blob) {
      arrayBuffer = await epubSource.arrayBuffer();
    } else {
      throw new Error('Unsupported binary EPUB source');
    }

    book = ePub(arrayBuffer);
    rendition = book.renderTo(renderArea, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
    });

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    function applyReaderTheme() {
      const bgColor = isDark ? '#161321' : '#ffffff';
      const textColor = isDark ? '#f0f2f5' : '#1f2328';
      const linkColor = isDark ? '#8c7ae6' : '#6c5ce7';

      rendition.themes.default({
        body: {
          background: `${bgColor} !important`,
          color: `${textColor} !important`,
          'font-family': "'Literata', Georgia, serif !important",
          'line-height': '1.8 !important',
          padding: '0 20px !important',
          'font-size': `${currentFontSize}% !important`,
        },
        p: { 'margin-bottom': '1.4em !important' },
        a: { color: `${linkColor} !important`, 'text-decoration': 'none !important' },
        'img, svg': { 'max-width': '100% !important', height: 'auto !important' },
      });
    }

    applyReaderTheme();

    const savedRecord = await getReadingProgress(path);
    const initialLocation = savedRecord && savedRecord.location ? savedRecord.location : undefined;

    await rendition.display(initialLocation);

    // Continuous location tracking
    book.ready.then(() => book.locations.generate(1024)).then(() => {
      updateProgressIndicator(rendition.currentLocation());
    }).catch(console.warn);

    function updateProgressIndicator(location) {
      if (!location || !location.start) return;
      const cfi = location.start.cfi;
      let pct = 0;

      if (book.locations && book.locations.length() > 0) {
        pct = book.locations.percentageFromCfi(cfi);
        indicatorEl.textContent = `${Math.round(pct * 100)}% complete`;
      } else {
        indicatorEl.textContent = 'Reading';
      }

      saveReadingProgress(path, pct, cfi);
    }

    rendition.on('relocated', (location) => {
      updateProgressIndicator(location);
    });

    // Tap/Click Navigation
    nextBtn.onclick = () => rendition.next();
    prevBtn.onclick = () => rendition.prev();

    // Font Sizing
    fontIncBtn.onclick = () => {
      if (currentFontSize < 160) {
        currentFontSize += 10;
        rendition.themes.fontSize(`${currentFontSize}%`);
      }
    };

    fontDecBtn.onclick = () => {
      if (currentFontSize > 80) {
        currentFontSize -= 10;
        rendition.themes.fontSize(`${currentFontSize}%`);
      }
    };

  } catch (err) {
    indicatorEl.textContent = 'Failed to load EPUB';
    renderArea.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 20px;">
        <p style="color: #e11d48; font-weight: 700; margin-bottom: 8px;">Unable to render EPUB</p>
        <p style="font-size: 13px; color: var(--text-secondary); max-width: 320px;">${err.message}</p>
      </div>
    `;
    console.error('EPUB Viewer Error:', err);
  }
}
