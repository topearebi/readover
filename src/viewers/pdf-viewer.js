// src/viewers/pdf-viewer.js
import { saveReadingProgress, getReadingProgress } from '../db.js';

let pdfjsLib = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;

  // Use esm.sh bundle for pdfjs-dist
  pdfjsLib = await import('https://esm.sh/pdfjs-dist@4.0.379');

  // Load worker via Blob URL to eliminate cross-origin worker script blocking
  try {
    const workerUrl = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
    const workerResp = await fetch(workerUrl);
    const workerBlob = await workerResp.blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
  } catch (err) {
    // Fallback direct URL if blob generation fails
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  }

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
      <div id="pdf-scroll-stage" class="pdf-scroll-stage" style="flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 16px;"></div>
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
  stageEl.innerHTML = '<div style="margin-top: 40px; color: var(--text-muted); font-size: 14px;">Rendering document pages...</div>';
  indicatorEl.textContent = 'Initializing...';
  modal.classList.add('open');

  let pdfDoc = null;
  let renderObserver = null;
  let currentZoom = 1.0;
  let activePageNum = 1;
  const renderedPages = new Set();

  const teardown = () => {
    if (renderObserver) renderObserver.disconnect();
    modal.classList.remove('open');
    stageEl.innerHTML = '';
    renderedPages.clear();
    if (pdfDoc) {
      try { pdfDoc.destroy(); } catch (e) {}
    }
  };

  closeBtn.onclick = teardown;

  try {
    const lib = await getPdfJs();

    let arrayBuffer;
    if (pdfSource instanceof ArrayBuffer) {
      arrayBuffer = pdfSource;
    } else if (pdfSource instanceof Blob) {
      arrayBuffer = await pdfSource.arrayBuffer();
    } else {
      throw new Error('Unsupported binary PDF source');
    }

    const loadingTask = lib.getDocument({
      data: new Uint8Array(arrayBuffer),
      disableAutoFetch: true,
      disableStream: true,
    });

    pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;

    const savedRecord = await getReadingProgress(path);
    const initialPage = savedRecord && savedRecord.location ? parseInt(savedRecord.location, 10) : 1;

    stageEl.innerHTML = '';

    // Generate virtual page placeholders
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-slot';
      pageWrapper.dataset.page = pageNum;
      pageWrapper.id = `pdf-slot-${pageNum}`;
      pageWrapper.style.minHeight = '650px';
      pageWrapper.style.width = '100%';
      pageWrapper.style.maxWidth = '760px';
      pageWrapper.style.display = 'flex';
      pageWrapper.style.justifyContent = 'center';
      pageWrapper.style.backgroundColor = 'var(--card-bg)';
      pageWrapper.style.borderRadius = '8px';
      pageWrapper.style.overflow = 'hidden';
      stageEl.appendChild(pageWrapper);
    }

    renderObserver = new IntersectionObserver(
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
            // Unload distant offscreen canvases to maintain browser memory limits
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
        rootMargin: '500px 0px',
        threshold: 0.05,
      }
    );

    stageEl.querySelectorAll('.pdf-page-slot').forEach((slot) => {
      renderObserver.observe(slot);
    });

    async function renderPageSlot(pageNum, slot) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1.0 });

        const containerWidth = Math.min(stageEl.clientWidth - 32, 760);
        const baseScale = containerWidth / unscaledViewport.width;
        const effectiveScale = baseScale * currentZoom;

        const viewport = page.getViewport({ scale: effectiveScale });
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
      } catch (slotErr) {
        console.warn(`Error rendering page ${pageNum}:`, slotErr);
      }
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

    // Restore saved reading position
    if (initialPage > 1 && initialPage <= totalPages) {
      requestAnimationFrame(() => {
        const targetSlot = document.getElementById(`pdf-slot-${initialPage}`);
        if (targetSlot) {
          targetSlot.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      });
    }

    // Zoom Handlers
    zoomInBtn.onclick = () => {
      if (currentZoom < 2.25) {
        currentZoom += 0.25;
        zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
        renderedPages.clear();
        stageEl.querySelectorAll('.pdf-page-slot').forEach((s) => (s.innerHTML = ''));
      }
    };

    zoomOutBtn.onclick = () => {
      if (currentZoom > 0.75) {
        currentZoom -= 0.25;
        zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
        renderedPages.clear();
        stageEl.querySelectorAll('.pdf-page-slot').forEach((s) => (s.innerHTML = ''));
      }
    };

  } catch (err) {
    indicatorEl.textContent = 'PDF load failed';
    stageEl.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; text-align: center; padding: 20px;">
        <p style="color: #e11d48; font-weight: 700; margin-bottom: 8px;">Unable to render PDF</p>
        <p style="font-size: 13px; color: var(--text-secondary); max-width: 320px;">${err.message}</p>
      </div>
    `;
    console.error('PDF Viewer initialization failed:', err);
  }
}
