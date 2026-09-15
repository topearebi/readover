// src/viewers/epub-viewer.js
import { saveReadingProgress, getReadingProgress } from '../db.js';

let ePubEngine = null;

async function getEpubEngine() {
  if (ePubEngine) return ePubEngine;
  // Dynamic import of ePub.js ESM build
  const module = await import('https://cdn.jsdelivr.net/npm/epubjs@0.3.93/+esm');
  ePubEngine = module.default || module;
  return ePubEngine;
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
      <div class="epub-viewport-container">
        <button id="epub-prev-btn" class="epub-nav-zone left" aria-label="Previous Page">‹</button>
        <div id="epub-render-area" class="epub-render-area"></div>
        <button id="epub-next-btn" class="epub-nav-zone right" aria-label="Next Page">›</button>
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

  const ePub = await getEpubEngine();

  let arrayBuffer;
  if (epubSource instanceof ArrayBuffer) {
    arrayBuffer = epubSource;
  } else if (epubSource instanceof Blob) {
    arrayBuffer = await epubSource.arrayBuffer();
  }

  const book = ePub(arrayBuffer);
  const rendition = book.renderTo(renderArea, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none',
  });

  // Theme & Typography Syncing
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  let currentFontSize = 105;

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
        padding: '0 16px !important',
        'font-size': `${currentFontSize}% !important`,
      },
      p: {
        'margin-bottom': '1.4em !important',
      },
      a: {
        color: `${linkColor} !important`,
        'text-decoration': 'none !important',
      },
      'img, svg': {
        'max-width': '100% !important',
        height: 'auto !important',
      },
    });
  }

  applyReaderTheme();

  // Load saved CFI location or start from beginning
  const savedRecord = await getReadingProgress(path);
  const initialLocation = savedRecord && savedRecord.location ? savedRecord.location : undefined;

  await rendition.display(initialLocation);

  // Generate continuous page/CFI locations for progress reporting
  book.ready.then(() => {
    return book.locations.generate(1024);
  }).then(() => {
    updateProgressIndicator(rendition.currentLocation());
  });

  function updateProgressIndicator(location) {
    if (!location || !location.start) return;
    const cfi = location.start.cfi;
    let pct = 0;

    if (book.locations.length() > 0) {
      pct = book.locations.percentageFromCfi(cfi);
      indicatorEl.textContent = `${Math.round(pct * 100)}% complete`;
    } else {
      indicatorEl.textContent = 'Reading';
    }

    saveReadingProgress(path, pct, cfi);
  }

  // Location Change Listener
  rendition.on('relocated', (location) => {
    updateProgressIndicator(location);
  });

  // Page Turn Controls
  const goNext = () => rendition.next();
  const goPrev = () => rendition.prev();

  nextBtn.onclick = goNext;
  prevBtn.onclick = goPrev;

  // Keyboard Navigation inside modal
  const handleKeydown = (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goPrev();
    }
  };
  window.addEventListener('keydown', handleKeydown);

  // Font Size Adjustments
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

  // Teardown & Dismiss
  closeBtn.onclick = () => {
    window.removeEventListener('keydown', handleKeydown);
    modal.classList.remove('open');
    try {
      rendition.destroy();
      book.destroy();
    } catch (err) {}
    renderArea.innerHTML = '';
  };
}
