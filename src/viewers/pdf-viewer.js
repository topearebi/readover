// src/viewers/pdf-viewer.js
import { saveReadingProgress, getReadingProgress } from '../db.js';

let pdfjsLib = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  return pdfjsLib;
}

/**
 * Mounts and opens the full-screen continuous vertical PDF reader modal.
 * 
 * @param {string} path - Document relative path
 * @param {Blob|File|ArrayBuffer} pdfSource - Binary source
 * @param {string} title - Document title
 */
export async function openPdfViewer(path, pdfSource, title = 'Document') {
  let modal = document.getElementById('pdf-viewer-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pdf-viewer-modal';
    modal.className = 'reader-modal pdf-modal';
    modal.innerHTML = `
      <div class="reader-header">
        <div class="reader-header-left">
          <span class="format-badge pdf">PDF</span>
          <span id="pdf-title" class="card-folder-badge" style="max-width: 200px;"></span>
          <span id="pdf-page-indicator" class="reader-status">Loading...</span>
        </div>
        <div class="reader-header-right">
          <button id="pdf-zoom-out" class="reader-action-btn" title="Zoom Out">−</button>
          <span id="pdf-zoom-label" class="reader-status">Fit</span>
          <button id="pdf-zoom-in" class="reader-action-btn" title="Zoom In">+</button>
          <button id="pdf-close-btn" class="reader-close-btn">✕ Done</button>
        </div>
      </div>
      <div id="pdf-scroll-stage" class="pdf-scroll-stage">
        <!-- Virtual Page Shells -->
      </div>
    `;
    document.body.appendChild(modal);
  }

  const titleEl = modal.querySelector('#pdf-title');
  const indicatorEl = modal.querySelector('#pdf-page-indicator');
  const stageEl = modal.querySelector('#pdf-scroll-stage');
  const zoomInBtn = modal.querySelector('#pdf-zoom-in');
  const zoomOutBtn = modal.querySelector('#pdf-zoom-out');
  const zoomLabel = modal.querySelector('#pdf-zoom-label');
  const closeBtn = modal.querySelector('#pdf-close-btn');

  titleEl.textContent = title;
  stageEl.innerHTML = '<div class="pdf-loading-spinner">Rendering document pages...</div>';
  indicatorEl.textContent = 'Initializing...';
  modal.classList.add('open');

  const lib = await getPdfJs();

  let arrayBuffer;
  if (pdfSource instanceof ArrayBuffer) {
    arrayBuffer = pdfSource;
  } else if (pdfSource instanceof Blob) {
    arrayBuffer = await pdfSource.arrayBuffer();
  }

  const pdfDoc = await lib.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableAutoFetch: true,
  }).promise;

  const totalPages = pdfDoc.numPages;
  let currentZoom = 1.0; // Fit width baseline
  let activePageNum = 1;
  const renderedPages = new Set();
  const pageViewports = new Map();

  // Retrieve saved progress
  const savedRecord = await getReadingProgress(path);
  const initialPage = savedRecord && savedRecord.location ? parseInt(savedRecord.location, 10) : 1;

  stageEl.innerHTML = '';

  // 1. Build Virtual Page Skeletons
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'pdf-page-slot';
    pageWrapper.dataset.page = pageNum;
    pageWrapper.id = `pdf-slot-${pageNum}`;

    // Get unscaled aspect ratio using first page as prototype or individual page meta
    pageWrapper.style.minHeight = '800px';
    stageEl.appendChild(pageWrapper);
  }

  // 2. Page Intersection Observer for Virtual Lazy Rendering
  const renderObserver = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        const slot = entry.target;
        const pageNum = parseInt(slot.dataset.page, 10);

        if (entry.isIntersecting) {
          if (!renderedPages.has(pageNum)) {
            renderedPages.add(pageNum);
            await renderPageSlot(pageNum, slot);
          }
          activePageNum = pageNum;
          updateIndicator();
          persistProgress();
        } else {
          // Offload canvas when scrolled far away to protect RAM on mobile
          if (renderedPages.has(pageNum)) {
            const canvas = slot.querySelector('canvas');
            if (canvas) {
              canvas.width = 0;
              canvas.height = 0;
              canvas.remove();
            }
            renderedPages.delete(pageNum);
          }
        }
      }
    },
    {
      root: stageEl,
      rootMargin: '600px 0px', // Preload buffer
      threshold: 0.05,
    }
  );

  stageEl.querySelectorAll('.pdf-page-slot').forEach((slot) => {
    renderObserver.observe(slot);
  });

  async function renderPageSlot(pageNum, slot) {
    const page = await pdfDoc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });

    const containerWidth = stageEl.clientWidth - 32;
    const baseScale = containerWidth / unscaledViewport.width;
    const effectiveScale = baseScale * currentZoom;

    const viewport = page.getViewport({ scale: effectiveScale });
    pageViewports.set(pageNum, viewport);

    slot.style.minHeight = `${Math.floor(viewport.height)}px`;

    let canvas = slot.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      slot.appendChild(canvas);
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display',
    }).promise;
  }

  function updateIndicator() {
    indicatorEl.textContent = `Page ${activePageNum} of ${totalPages}`;
  }

  let saveTimeout = null;
  function persistProgress() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const pct = activePageNum / totalPages;
      saveReadingProgress(path, pct, activePageNum);
    }, 400);
  }

  // Jump to saved reading position
  if (initialPage > 1 && initialPage <= totalPages) {
    requestAnimationFrame(() => {
      const targetSlot = document.getElementById(`pdf-slot-${initialPage}`);
      if (targetSlot) {
        targetSlot.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    });
  }

  // Zoom Controls
  zoomInBtn.onclick = async () => {
    if (currentZoom < 2.5) {
      currentZoom = Math.min(currentZoom + 0.25, 2.5);
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
      renderedPages.clear();
      stageEl.querySelectorAll('.pdf-page-slot').forEach((s) => (s.innerHTML = ''));
      stageEl.querySelectorAll('.pdf-page-slot').forEach((slot) => renderObserver.observe(slot));
    }
  };

  zoomOutBtn.onclick = async () => {
    if (currentZoom > 0.75) {
      currentZoom = Math.max(currentZoom - 0.25, 0.75);
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
      renderedPages.clear();
      stageEl.querySelectorAll('.pdf-page-slot').forEach((s) => (s.innerHTML = ''));
      stageEl.querySelectorAll('.pdf-page-slot').forEach((slot) => renderObserver.observe(slot));
    }
  };

  // Teardown & Close
  closeBtn.onclick = () => {
    renderObserver.disconnect();
    modal.classList.remove('open');
    stageEl.innerHTML = '';
    renderedPages.clear();
    try {
      pdfDoc.destroy();
    } catch (e) {}
  };
}
