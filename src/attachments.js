// Storage-Agnostic Image & Attachment Compression and Routing
// Compresses client-side via Canvas (max 1600px, WebP @ 0.8 quality -> ~60-120 KB),
// routes to S3/R2 or the active note's library adapter, and inserts clean markdown.

import * as store from './store.js';
import * as library from './library.js';
import { toast } from './ui/overlay.js';
import { attachmentsFolder } from './insights.js';
import { validateBinaryPayload, cloneBlob } from './utils/binary.js';

const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.8;

/**
 * Client-Side Browser Canvas Compression
 * - Auto-resize max dimension to 1600px
 * - Convert to WebP (quality: 0.8) for optimal ~60-120 KB size
 */
export async function compressImage(fileOrBlob, maxDim = MAX_DIMENSION, quality = WEBP_QUALITY) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (e) => reject(new Error('Failed to decode image data'));
      image.src = url;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Try WebP first; check if browser generates valid WebP blob
    let blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
    let format = 'webp';
    if (!blob || blob.type !== 'image/webp') {
      // Fallback to JPEG if WebP export is unsupported
      blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      format = 'jpg';
    }

    canvas.width = canvas.height = 0; // memory cleanup
    return { blob, width, height, format, originalSize: fileOrBlob.size, size: blob.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Generate a clean, collision-free attachment filename */
export function generateAttachmentFilename(base = 'image', format = 'webp') {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 6);
  const cleanBase = String(base || 'image').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  return `${dateStr}-${cleanBase}-${rand}.${format}`;
}

/**
 * Constructs the clean relative storage path for an attachment.
 * Defensively cleans and normalizes folder paths against leading/trailing/duplicate slashes.
 */
export function buildAttachmentPath(filename, folder = attachmentsFolder()) {
  const cleanFolder = (folder || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  const cleanFile = (filename || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  return cleanFolder ? `${cleanFolder}/${cleanFile}` : cleanFile;
}

/**
 * Resolves the destination source for attachments based on user preferences.
 * Supports split storage: notes in one provider (e.g. GitHub), attachments in another (e.g. Dropbox or S3/R2).
 */
export function resolveAttachmentSource(noteSource = null) {
  const prefs = store.getPrefs();
  const rawDest = prefs.attachmentsVault || prefs.attachmentsDestination || 'same-as-note';
  const destType = String(rawDest).toLowerCase().trim();
  const sources = store.getSources();

  // 1. Direct match by source ID
  const idMatch = sources.find((s) => s.id === rawDest && library.canWrite(s));
  if (idMatch) return idMatch;

  // 2. If designated as dropbox (or legacy string containing dropbox)
  if (destType === 'dropbox' || destType.includes('dropbox')) {
    const dbx = sources.find((s) => s.type === 'dropbox' && library.canWrite(s));
    if (dbx) return dbx;
  }

  // 3. If designated as s3 or r2
  if (destType === 's3' || destType === 'r2' || destType.includes('s3') || destType.includes('r2')) {
    const s3Src = sources.find((s) => (s.type === 's3' || s.type === 'r2') && library.canWrite(s));
    if (s3Src) return s3Src;
  }

  // 4. If designated as device
  if (destType === 'device' || destType.includes('device')) {
    return library.deviceSource(true);
  }

  // 5. 'same-as-note' or 'note-provider': Use the active note's source if writable
  if (noteSource) {
    const sid = typeof noteSource === 'object' && noteSource?.sourceId ? noteSource.sourceId : noteSource;
    const src = typeof sid === 'string' ? store.getSource(sid) : sid;
    if (src && library.canWrite(src)) return src;
  }

  // 6. Fallback hierarchy: noteSource -> s3 -> dropbox -> any writable -> device
  return (
    sources.find((s) => (s.type === 's3' || s.type === 'r2') && library.canWrite(s)) ||
    sources.find((s) => s.type === 'dropbox' && library.canWrite(s)) ||
    sources.find((s) => library.canWrite(s)) ||
    library.deviceSource(true)
  );
}

/**
 * Route attachment to the appropriate storage adapter
 * Prefers configured attachment destination (Dropbox, S3/R2, or note provider)
 */
export async function saveAttachment(sourceOrId, relPath, blob) {
  const { body: validatedBlob } = await validateBinaryPayload(blob);
  const dest = resolveAttachmentSource(sourceOrId);
  const path = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  const itemKey = store.keyOf(dest.id, path);
  let sha = `att:${Date.now()}`;

  try {
    if (dest.type === 'dropbox') {
      const { putAttachment } = await import('./sources/dropbox.js');
      const res = await putAttachment(dest, path, cloneBlob(validatedBlob));
      sha = res?.rev || sha;
    } else if (dest.type === 'webdav') {
      const { putFile } = await import('./sources/webdav.js');
      await putFile(dest, path, cloneBlob(validatedBlob));
    } else if (dest.type === 's3' || dest.type === 'r2') {
      const { putFile } = await import('./sources/s3.js');
      await putFile(dest, path, cloneBlob(validatedBlob));
    } else if (dest.type === 'github') {
      // Small attachments can be committed via GitHub API if needed
      const { putFile } = await import('./sources/github.js');
      const reader = new FileReader();
      const base64 = await new Promise((res) => {
        reader.onloadend = () => res(reader.result.split(',')[1]);
        reader.readAsDataURL(cloneBlob(validatedBlob));
      });
      // GitHub API supports base64 encoding for binary
      await putFile(dest, path, atob(base64), null, `Readover: add attachment ${path}`);
    } else if (dest.type === 'local') {
      const { writeBlob } = await import('./sources/local.js');
      await writeBlob(dest, path, cloneBlob(validatedBlob));
    }
  } catch (err) {
    console.warn('Remote attachment upload failed, caching locally:', err);
  }

  // Always cache locally in IndexedDB blobs store for instant zero-latency preview
  await store.blobs.put({
    key: itemKey,
    sourceId: dest.id,
    sha,
    blob: cloneBlob(validatedBlob),
  });

  return { path, key: itemKey, sourceId: dest.id };
}

/** Insert text at textarea selection */
export function insertAtCursor(textarea, textToInsert) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${textToInsert}${after}`;
  const newPos = start + textToInsert.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Core image processing pipeline:
 * Compresses file via Canvas WebP, saves to resolved attachment destination,
 * and inserts clean markdown into textarea at cursor position.
 */
export async function processAndSaveImage(file, textarea, getSource = () => null) {
  if (!file) return null;
  toast('Compressing image…');
  try {
    const { blob, format, size, originalSize } = await compressImage(file);
    const filename = generateAttachmentFilename('diagram', format);
    const relPath = buildAttachmentPath(filename);

    toast('Saving attachment…');
    const src = typeof getSource === 'function' ? getSource() : getSource;
    await saveAttachment(src, relPath, blob);

    const markdown = `\n![${file.name.replace(/\.[^.]+$/, '') || 'Diagram'}](${relPath})\n`;
    if (textarea) {
      insertAtCursor(textarea, markdown);
    }

    const kb = Math.round(size / 1024);
    const origKb = Math.round(originalSize / 1024);
    toast(`Image compressed and attached (${origKb}KB → ${kb}KB)`);
    return { relPath, markdown, filename };
  } catch (err) {
    toast(`Attachment failed: ${err.message}`);
    throw err;
  }
}

/**
 * Attach clipboard paste and drag-drop handlers to a note textarea.
 * When an image is detected: compresses, stores, and inserts clean markdown `![](attachments/...)`.
 */
export function setupImageAttachments(textarea, { getSource = () => null, folder = '' } = {}) {
  if (!textarea) return;

  async function handleImageFile(file) {
    try {
      await processAndSaveImage(file, textarea, getSource);
    } catch (err) {
      console.warn('Image processing failed:', err);
    }
  }

  // 1. Paste listener
  textarea.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageFile(file);
        break;
      }
    }
  });

  // 2. Drag & Drop listeners
  textarea.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      textarea.classList.add('drag-active');
    }
  });

  textarea.addEventListener('dragleave', () => {
    textarea.classList.remove('drag-active');
  });

  textarea.addEventListener('drop', async (e) => {
    textarea.classList.remove('drag-active');
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        await handleImageFile(file);
        break;
      }
    }
  });
}

// Export both names to guarantee compatibility with all callers and cached modules
export { setupImageAttachments as setupAttachmentListeners };
