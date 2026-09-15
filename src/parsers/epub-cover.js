// src/parsers/epub-cover.js
import { unzipSync, strFromU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';
import { setCachedThumbnail, getCachedThumbnail } from '../db.js';

/**
 * Extracts and caches the cover image thumbnail and metadata for an EPUB file.
 * 
 * @param {string} path - Relative document path
 * @param {Blob|File|ArrayBuffer} epubSource - Binary source of the EPUB file
 * @returns {Promise<{ blob: Blob, title: string, creator: string }>}
 */
export async function extractEpubCover(path, epubSource) {
  // Check local thumbnail cache first
  const existingBlob = await getCachedThumbnail(path);
  if (existingBlob) {
    return { blob: existingBlob, title: '', creator: '' };
  }

  let buffer;
  if (epubSource instanceof ArrayBuffer) {
    buffer = new Uint8Array(epubSource);
  } else if (epubSource instanceof Blob) {
    const ab = await epubSource.arrayBuffer();
    buffer = new Uint8Array(ab);
  } else {
    throw new Error('Unsupported EPUB source. Expected Blob, File, or ArrayBuffer.');
  }

  // Decompress ZIP archive into memory
  const unzipped = unzipSync(buffer);

  // 1. Locate root OPF file from META-INF/container.xml
  const containerXmlData = unzipped['META-INF/container.xml'];
  if (!containerXmlData) {
    throw new Error('Invalid EPUB: Missing META-INF/container.xml');
  }

  const containerXml = strFromU8(containerXmlData);
  const opfPathMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!opfPathMatch) {
    throw new Error('Invalid EPUB: Unable to find OPF path in container.xml');
  }

  const opfPath = opfPathMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfData = unzipped[opfPath];
  if (!opfData) {
    throw new Error(`Invalid EPUB: Root package file not found at ${opfPath}`);
  }

  const opfXml = strFromU8(opfData);
  const parser = new DOMParser();
  const opfDoc = parser.parseFromString(opfXml, 'application/xml');

  // Extract Metadata
  const titleEl = opfDoc.querySelector('title');
  const creatorEl = opfDoc.querySelector('creator');
  const title = titleEl ? titleEl.textContent.trim() : path.split('/').pop().replace(/\.epub$/i, '');
  const creator = creatorEl ? creatorEl.textContent.trim() : 'Unknown Author';

  // 2. Resolve Cover Image Path from OPF Manifest
  let coverHref = null;

  // EPUB 2 standard: <meta name="cover" content="item-id" />
  const metaCover = opfDoc.querySelector('meta[name="cover"]');
  if (metaCover) {
    const coverId = metaCover.getAttribute('content');
    const item = opfDoc.querySelector(`manifest > item[id="${coverId}"]`);
    if (item) coverHref = item.getAttribute('href');
  }

  // EPUB 3 standard: <item properties="cover-image" href="..." />
  if (!coverHref) {
    const epub3Cover = opfDoc.querySelector('manifest > item[properties~="cover-image"]');
    if (epub3Cover) coverHref = epub3Cover.getAttribute('href');
  }

  // Fallback heuristics: check for items with id or href matching "cover"
  if (!coverHref) {
    const manifestItems = Array.from(opfDoc.querySelectorAll('manifest > item'));
    const candidate = manifestItems.find((item) => {
      const href = (item.getAttribute('href') || '').toLowerCase();
      const id = (item.getAttribute('id') || '').toLowerCase();
      const type = (item.getAttribute('media-type') || '').toLowerCase();
      return type.startsWith('image/') && (id.includes('cover') || href.includes('cover'));
    });
    if (candidate) coverHref = candidate.getAttribute('href');
  }

  let finalBlob = null;

  if (coverHref) {
    // Resolve relative path against OPF directory
    const resolvedPath = normalizeZipPath(opfDir + coverHref);
    const coverData = unzipped[resolvedPath];

    if (coverData) {
      const mimeType = inferMimeType(resolvedPath);
      finalBlob = new Blob([coverData], { type: mimeType });
    }
  }

  // 3. If no image exists, generate a typographic fallback poster
  if (!finalBlob) {
    finalBlob = await generateTypographicPoster(title, creator);
  }

  // Cache generated/extracted thumbnail
  await setCachedThumbnail(path, finalBlob);

  return { blob: finalBlob, title, creator };
}

/**
 * Normalizes relative ZIP directory paths (resolves ../ and ./)
 */
function normalizeZipPath(path) {
  const segments = path.split('/');
  const stack = [];
  for (const part of segments) {
    if (part === '.' || !part) continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function inferMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

/**
 * Generates an SVG-rendered typographic book poster as a WebP Blob fallback.
 */
function generateTypographicPoster(title, author) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');

    // Rich gradient background matching ReadOver dark purple palette
    const grad = ctx.createLinearGradient(0, 0, 600, 900);
    grad.addColorStop(0, '#26203d');
    grad.addColorStop(1, '#110f17');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 900);

    // Subtle inner border
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 6;
    ctx.strokeRect(28, 28, 544, 844);

    // Title Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Literata, Georgia, serif';
    ctx.textAlign = 'center';

    const words = title.split(' ');
    let line = '';
    let y = 380;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > 480 && n > 0) {
        ctx.fillText(line, 300, y);
        line = words[n] + ' ';
        y += 50;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 300, y);

    // Author Text
    ctx.fillStyle = '#a4b0be';
    ctx.font = '600 22px Inter, sans-serif';
    ctx.fillText(author.toUpperCase(), 300, y + 80);

    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      'image/webp',
      0.85
    );
  });
}
