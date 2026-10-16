// Storage-Agnostic Image & Attachment Pipeline.
// Client-side browser canvas compression (WebP ~80-150KB), deterministic naming,
// and portable relative path routing.
import * as store from './store.js';
import * as library from './library.js';
import { toast } from './ui/overlay.js';

const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.8;

/**
 * Compresses an image file/blob to WebP using client-side canvas.
 * Resizes max dimension to 1600px while maintaining aspect ratio.
 */
export async function compressImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to encode image to WebP'));
        },
        'image/webp',
        WEBP_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for compression'));
    };

    img.src = url;
  });
}

/**
 * Generates a deterministic attachment filename:
 * attachments/YYYY-MM-DD-slug-hash.webp
 */
export function generateAttachmentPath(slugHint = '') {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const cleanSlug = String(slugHint || 'img')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'diagram';
  const hash = Math.random().toString(36).slice(2, 8);
  return `attachments/${dateStr}-${cleanSlug}-${hash}.webp`;
}

/**
 * Determines target destination source (active note source or S3/R2 vault).
 */
export function resolveAttachmentSource(noteSrc) {
  const prefs = store.getPrefs();
  if (prefs.attachmentsDestination === 's3') {
    const s3Vault = store.getSources().find((s) => (s.type === 's3' || s.type === 'r2') && library.canWrite(s));
    if (s3Vault) return s3Vault;
  }
  if (noteSrc && library.canWrite(noteSrc)) return noteSrc;
  return library.deviceSource(true);
}

/**
 * Processes an image file: compresses to WebP, writes to storage adapter,
 * caches in IndexedDB, and returns portable Markdown.
 */
export async function processAndSaveImage(file, { noteSrc = null, slug = 'sketch' } = {}) {
  const compressedBlob = await compressImage(file);
  const targetSrc = resolveAttachmentSource(noteSrc);
  const relPath = generateAttachmentPath(slug);

  await library.putAttachment(targetSrc, relPath, compressedBlob);

  // Return clean, portable relative markdown path compatible with Obsidian & GitHub
  return {
    markdown: `![](${relPath})`,
    path: relPath,
    size: compressedBlob.size,
  };
}

/**
 * Attaches paste (Ctrl+V) and drag-and-drop listeners to an editor textarea.
 */
export function setupAttachmentListeners(textarea, { getContext = () => ({}) } = {}) {
  if (!textarea) return () => {};

  const handleFiles = async (files) => {
    const imageFiles = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    toast('Compressing image…');
    const ctx = getContext();
    const noteSrc = ctx.sourceId ? store.getSource(ctx.sourceId) : null;
    const slug = ctx.title || 'diagram';

    for (const file of imageFiles) {
      try {
        const { markdown } = await processAndSaveImage(file, { noteSrc, slug });
        insertAtCursor(textarea, `\n${markdown}\n`);
        toast('Image attached');
      } catch (err) {
        toast(`Image upload failed: ${err.message}`);
      }
    }
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  };

  const onDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      textarea.classList.add('is-drop-target');
    }
  };

  const onDragLeave = () => {
    textarea.classList.remove('is-drop-target');
  };

  const onDrop = (e) => {
    textarea.classList.remove('is-drop-target');
    const files = e.dataTransfer?.files;
    if (files?.length) {
      const hasImages = [...files].some((f) => f.type.startsWith('image/'));
      if (hasImages) {
        e.preventDefault();
        handleFiles(files);
      }
    }
  };

  textarea.addEventListener('paste', onPaste);
  textarea.addEventListener('dragover', onDragOver);
  textarea.addEventListener('dragleave', onDragLeave);
  textarea.addEventListener('drop', onDrop);

  return () => {
    textarea.removeEventListener('paste', onPaste);
    textarea.removeEventListener('dragover', onDragOver);
    textarea.removeEventListener('dragleave', onDragLeave);
    textarea.removeEventListener('drop', onDrop);
  };
}

function insertAtCursor(textarea, textToInsert) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const current = textarea.value;

  textarea.value = current.slice(0, start) + textToInsert + current.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}
