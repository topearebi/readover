// src/parsers/pdf-cover.js
import { setCachedThumbnail, getCachedThumbnail } from '../db.js';

let pdfjsLib = null;

/**
 * Dynamically imports and initializes the PDF.js library and worker.
 */
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;

  // Use modern ESM build of pdfjs-dist
  pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

  return pdfjsLib;
}

/**
 * Extracts and caches the Page 1 cover thumbnail for a PDF document.
 * 
 * @param {string} path - Document relative path
 * @param {Blob|File|ArrayBuffer} pdfSource - Binary source of the PDF
 * @param {number} targetWidth - Target pixel width for the rendered cover (default: 600)
 * @returns {Promise<Blob>} The generated WebP image blob
 */
export async function extractPdfCover(path, pdfSource, targetWidth = 600) {
  // Check local cache first
  const existingBlob = await getCachedThumbnail(path);
  if (existingBlob) {
    return existingBlob;
  }

  const lib = await loadPdfJs();

  let arrayBuffer;
  if (pdfSource instanceof ArrayBuffer) {
    arrayBuffer = pdfSource;
  } else if (pdfSource instanceof Blob) {
    arrayBuffer = await pdfSource.arrayBuffer();
  } else {
    throw new Error('Unsupported PDF source. Expected Blob, File, or ArrayBuffer.');
  }

  // Load PDF task with minimal memory overhead
  const loadingTask = lib.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableAutoFetch: true,
    disableStream: true,
  });

  const pdfDoc = await loadingTask.promise;

  try {
    const page = await pdfDoc.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1.0 });

    // Calculate scale to match targetWidth
    const scale = targetWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    // Create offscreen rendering canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display',
    };

    await page.render(renderContext).promise;

    // Convert to compressed WebP blob
    const imageBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas export to WebP failed'));
        },
        'image/webp',
        0.82
      );
    });

    // Cache in IndexedDB
    await setCachedThumbnail(path, imageBlob);

    // Free canvas pixels
    canvas.width = 0;
    canvas.height = 0;

    return imageBlob;
  } finally {
    // Crucial memory cleanup
    try {
      await pdfDoc.cleanup();
      await pdfDoc.destroy();
    } catch (err) {
      console.warn('PDF cleanup warning:', err);
    }
  }
}
