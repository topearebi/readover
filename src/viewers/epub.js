// Paginated EPUB reader with highlighting. Highlights are saved as markdown
// (see app.js saveBookHighlight) so they come back in the feed later.
import { loadEpubJs } from '../lib/vendor.js';
import { progress } from '../store.js';
import { pushOverlay, el, icon, toast } from '../ui/overlay.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * @param opts { onHighlight({ text, chapter, cfi }) → Promise<string|void> }
 */
export async function openEpub(item, blob, title, opts = {}) {
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back' }, icon('back'));
  const status = el('span', { class: 'status' }, 'Opening…');
  const smaller = el('button', { class: 'icon-btn', 'aria-label': 'Smaller text' }, 'A−');
  const larger = el('button', { class: 'icon-btn', 'aria-label': 'Larger text' }, 'A+');
  const area = el('div', { class: 'epub-area' });
  const prev = el('button', { class: 'epub-nav prev', 'aria-label': 'Previous page' }, '‹');
  const next = el('button', { class: 'epub-nav next', 'aria-label': 'Next page' }, '›');
  const stage = el('div', { class: 'epub-stage' }, area, prev, next);
  const root = el(
    'div',
    { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'reader-bar' }, back, el('span', { class: 'title' }, title), status, smaller, larger),
    stage
  );
  document.body.append(root);

  let book;
  let rendition;
  const onKey = (e) => {
    if (!rendition) return;
    if (['ArrowRight', 'PageDown'].includes(e.key)) rendition.next();
    if (['ArrowLeft', 'PageUp'].includes(e.key)) rendition.prev();
  };
  window.addEventListener('keydown', onKey);
  const close = pushOverlay(() => {
    window.removeEventListener('keydown', onKey);
    try {
      book?.destroy();
    } catch {}
    root.remove();
  });
  back.onclick = close;

  let saved = (await progress.get(item.key)) || { key: item.key, sourceId: item.sourceId, pct: 0, loc: '', highlights: [] };
  saved.highlights = saved.highlights || [];
  const persist = () => progress.put({ ...saved, updatedAt: Date.now() });

  try {
    const ePub = await loadEpubJs();
    book = ePub(await blob.arrayBuffer());
    rendition = book.renderTo(area, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false });
  } catch (err) {
    status.textContent = '';
    stage.replaceChildren(el('p', { class: 'reader-error' }, `This book could not be opened: ${err.message}`));
    return;
  }

  let fontSize = Number(localStorage.getItem('readover.epubFont')) || 105;
  const applyTheme = () => {
    rendition.themes.default({
      body: {
        color: `${css('--ink')} !important`,
        background: `${css('--paper')} !important`,
        'font-family': "'Literata', Georgia, serif !important",
        'line-height': '1.65 !important',
        padding: '0 12px !important',
      },
      'p, li, blockquote, span, div': { color: 'inherit !important', 'font-family': 'inherit !important' },
      a: { color: `${css('--action')} !important` },
      img: { 'max-width': '100% !important', height: 'auto !important' },
      '::selection': { background: `${css('--marker')}` },
    });
    rendition.themes.fontSize(`${fontSize}%`);
  };
  // Make the vendored font available inside the book iframe.
  rendition.hooks.content.register((contents) => {
    const style = contents.document.createElement('style');
    style.textContent = `@font-face{font-family:'Literata';src:url('${new URL('../../vendor/fonts/literata-latin-wght-normal.woff2', import.meta.url).href}') format('woff2');font-weight:200 900;}`;
    contents.document.head.append(style);
  });
  applyTheme();
  smaller.onclick = () => {
    fontSize = Math.max(80, fontSize - 10);
    localStorage.setItem('readover.epubFont', fontSize);
    applyTheme();
  };
  larger.onclick = () => {
    fontSize = Math.min(170, fontSize + 10);
    localStorage.setItem('readover.epubFont', fontSize);
    applyTheme();
  };
  prev.onclick = () => rendition.prev();
  next.onclick = () => rendition.next();

  const markStyle = { fill: css('--marker'), 'fill-opacity': '0.38' };
  try {
    await rendition.display(saved.loc || undefined);
  } catch {
    await rendition.display();
  }
  saved.highlights.forEach((h) => {
    try {
      rendition.annotations.highlight(h.cfi, {}, null, 'ro-hl', markStyle);
    } catch {}
  });

  // Swipe to turn pages on touch screens
  let touch = null;
  rendition.on('touchstart', (e) => {
    touch = { x: e.changedTouches[0].screenX, y: e.changedTouches[0].screenY, t: Date.now() };
  });
  rendition.on('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].screenX - touch.x;
    const dy = e.changedTouches[0].screenY - touch.y;
    const sel = e.view?.getSelection?.()?.toString();
    if (!sel && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - touch.t < 600) {
      dx < 0 ? rendition.next() : rendition.prev();
    }
    touch = null;
  });
  rendition.on('keydown', onKey);

  const chapterFor = (href) => {
    const flat = [];
    const walk = (list) => list.forEach((t) => (flat.push(t), t.subitems && walk(t.subitems)));
    walk(book.navigation?.toc || []);
    const base = (href || '').split('#')[0];
    return flat.find((t) => t.href.split('#')[0].endsWith(base) || base.endsWith(t.href.split('#')[0]))?.label?.trim() || '';
  };

  let locationsReady = false;
  book.ready
    .then(() => book.locations.generate(1200))
    .then(() => {
      locationsReady = true;
      update(rendition.currentLocation());
    })
    .catch(() => {});

  function update(loc) {
    if (!loc?.start) return;
    saved.loc = loc.start.cfi;
    if (locationsReady) {
      saved.pct = book.locations.percentageFromCfi(loc.start.cfi) || 0;
      status.textContent = `${Math.round(saved.pct * 100)}%`;
    } else status.textContent = '';
    persist();
  }
  rendition.on('relocated', update);

  // Highlighting
  let bar = null;
  const dropBar = () => {
    bar?.remove();
    bar = null;
  };
  rendition.on('selected', (cfi, contents) => {
    dropBar();
    if (!opts.onHighlight) return;
    const keep = el('button', { class: 'btn btn-mark' }, icon('marker', 'i i-sm'), 'Highlight');
    const cancel = el('button', { class: 'btn btn-quiet' }, 'Cancel');
    bar = el('div', { class: 'selection-bar' }, keep, cancel);
    stage.append(bar);
    cancel.onclick = () => {
      contents.window.getSelection().removeAllRanges();
      dropBar();
    };
    keep.onclick = async () => {
      keep.disabled = true;
      const range = await book.getRange(cfi);
      const text = range ? range.toString().replace(/\s+/g, ' ').trim() : '';
      contents.window.getSelection().removeAllRanges();
      dropBar();
      if (!text) return;
      rendition.annotations.highlight(cfi, {}, null, 'ro-hl', markStyle);
      const chapter = chapterFor(rendition.currentLocation()?.start?.href);
      saved.highlights.push({ cfi, text, chapter, at: Date.now() });
      persist();
      try {
        const where = await opts.onHighlight({ text, chapter, cfi });
        toast(where ? `Highlight saved to ${where}` : 'Highlight saved on this device');
      } catch (err) {
        toast(`Saved on this device. ${err.message}`);
      }
    };
  });
  rendition.on('click', () => setTimeout(() => {
    if (bar && !area.querySelector('iframe')?.contentWindow?.getSelection()?.toString()) dropBar();
  }, 50));
}
