// Book reader for EPUB, MOBI/AZW3, FB2 and CBZ, built on foliate-js.
// Select text to highlight it (optionally with a note). Highlights are drawn in the
// book, kept with your reading progress, and saved as Markdown (see app.js) so they
// come back in the feed.
import { loadFoliate } from '../lib/vendor.js';
import { progress, saveProgress } from '../store.js';
import { pushOverlay, closeAll, el, icon, toast, openSheet } from '../ui/overlay.js';
import { askNote } from '../ui/highlight-note.js';
import {
  getReaderAppearance,
  saveReaderAppearance,
  buildBookCSS,
  createAppearancePopover,
  THEMES,
} from '../ui/appearance.js';
import { showStagingBanner } from '../ui/staging-banner.js';
import { setReaderMounted } from '../utils/wakelock.js';

const fontUrl = new URL('../../vendor/literata-5.2.5/literata-latin-wght-normal.woff2', import.meta.url).href;
const fontItalicUrl = new URL('../../vendor/literata-5.2.5/literata-latin-wght-italic.woff2', import.meta.url).href;

/**
 * @param opts {
 *   at?: string                  open at this CFI (e.g. from a highlight card)
 *   onHighlight?(h) → Promise<{ where, file }>   h = { text, comment, chapter, page, at, title }  (saved as an insight)
 *   stagingBanner?: { file: File, type: 'book'|'note', onCommit: Function, onDismiss?: Function }
 * }
 */
export async function openBook(item, blob, title, opts = {}) {
  setReaderMounted(true).catch?.(() => {});
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back (Hold to return to Feed)', title: 'Back (Hold to return to Feed)' }, icon('back'));
  const status = el('span', { class: 'status' }, 'Opening…');
  const contentsBtn = el('button', { class: 'btn btn-quiet', hidden: true }, 'Contents');
  const aaBtn = el('button', { class: 'icon-btn appearance-btn', 'aria-label': 'Reading appearance', title: 'Appearance' }, el('span', { class: 'btn-aa' }, 'Aa'));
  const smaller = el('button', { class: 'icon-btn', 'aria-label': 'Smaller text' }, 'A−');
  const larger = el('button', { class: 'icon-btn', 'aria-label': 'Larger text' }, 'A+');
  const area = el('div', { class: 'epub-area' });
  const prev = el('button', { class: 'epub-nav prev', 'aria-label': 'Previous page' }, '‹');
  const next = el('button', { class: 'epub-nav next', 'aria-label': 'Next page' }, '›');
  const stage = el('div', { class: 'epub-stage' }, area, prev, next);
  const readerBar = el('div', { class: 'reader-bar' }, back, el('span', { class: 'title' }, title), status, contentsBtn, aaBtn, smaller, larger);
  const root = el(
    'div',
    { class: 'reader reader-book reader-doc chrome-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    readerBar,
    stage
  );
  document.body.append(root);
  document.body.classList.add('has-reader', 'has-book-reader');
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) tabbar.setAttribute('aria-hidden', 'true');

  if (opts.stagingBanner) {
    showStagingBanner({ ...opts.stagingBanner, container: root });
  }

  const appearance = getReaderAppearance();
  root.dataset.readerTheme = appearance.theme;

  let view = null;
  let popover = null;
  const onKey = (e) => {
    if (!view || e.target.closest?.('textarea, input')) return;
    if (['ArrowRight', 'PageDown'].includes(e.key)) view.goRight();
    if (['ArrowLeft', 'PageUp'].includes(e.key)) view.goLeft();
  };
  window.addEventListener('keydown', onKey);

  function toggleChrome(force) {
    const hidden = force !== undefined ? !force : !root.classList.contains('chrome-hidden');
    root.classList.toggle('chrome-hidden', hidden);
    if (hidden && popover) {
      popover.remove();
      popover = null;
    }
  }
  root.toggleChrome = toggleChrome;

  // Single tap in neutral center area toggles transient book controls
  stage.addEventListener('click', (evt) => {
    if (evt.target.closest?.('.epub-nav, button, a, .selection-bar, .popover, .staging-banner')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) return;
    const rect = stage.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const w = rect.width;
    if (x > w * 0.2 && x < w * 0.8) {
      toggleChrome();
    }
  });

  const close = pushOverlay(() => {
    setReaderMounted(false).catch?.(() => {});
    popover?.remove();
    window.removeEventListener('keydown', onKey);
    try {
      view?.close();
    } catch {}
    root.remove();
    if (!document.querySelector('.reader')) {
      document.body.classList.remove('has-reader', 'has-book-reader');
      const tabbar = document.querySelector('.tabbar');
      if (tabbar) tabbar.removeAttribute('aria-hidden');
    }
  }, { element: root });

  let holdTimer = null;
  let didHold = false;
  let pressTime = 0;

  const startHold = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    didHold = false;
    pressTime = Date.now();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      didHold = true;
      closeAll();
    }, 400);
  };

  const clearHold = () => {
    clearTimeout(holdTimer);
  };

  back.addEventListener('pointerdown', startHold);
  back.addEventListener('pointerup', clearHold);
  back.addEventListener('pointercancel', clearHold);
  back.addEventListener('pointerleave', clearHold);
  back.addEventListener('mousedown', startHold);
  back.addEventListener('mouseup', clearHold);
  back.addEventListener('touchstart', startHold, { passive: true });
  back.addEventListener('touchend', clearHold);

  back.onclick = (e) => {
    clearTimeout(holdTimer);
    if (didHold) {
      didHold = false;
      return;
    }
    if (pressTime && Date.now() - pressTime >= 400) {
      pressTime = 0;
      closeAll();
      return;
    }
    pressTime = 0;
    close();
  };

  root.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    }
  });

  const saved = (await progress.get(item.key)) || { pct: 0, loc: '', highlights: [] };
  const highlights = [...(saved.highlights || [])];

  let Overlayer;
  try {
    const foliate = await loadFoliate();
    Overlayer = foliate.Overlayer;
    view = document.createElement('foliate-view');
    area.append(view);
    await view.open(new File([blob], item.name, { type: blob.type }));
  } catch (err) {
    toggleChrome(true);
    status.textContent = '';
    stage.replaceChildren(el('p', { class: 'reader-error' }, `This book could not be opened: ${err.message}`));
    return;
  }

  const applyStyles = () => {
    root.dataset.readerTheme = appearance.theme;
    const styles = buildBookCSS({
      fontSize: appearance.fontSize,
      theme: appearance.theme,
      font: appearance.font,
      lineHeight: appearance.lineHeight,
      fontUrl,
      fontItalicUrl,
    });
    view.renderer.setStyles?.(styles);
  };

  view.renderer.setAttribute('flow', 'paginated');
  view.renderer.setAttribute('gap', '6%');
  view.renderer.setAttribute('max-inline-size', '44em');
  view.renderer.setAttribute('animated', '');
  applyStyles();

  smaller.onclick = () => {
    appearance.fontSize = Math.max(80, appearance.fontSize - 10);
    saveReaderAppearance({ readerFontSize: appearance.fontSize, fontSize: appearance.fontSize });
    applyStyles();
  };
  larger.onclick = () => {
    appearance.fontSize = Math.min(180, appearance.fontSize + 10);
    saveReaderAppearance({ readerFontSize: appearance.fontSize, fontSize: appearance.fontSize });
    applyStyles();
  };

  aaBtn.onclick = (e) => {
    e.stopPropagation();
    if (popover) {
      popover.remove();
      popover = null;
      return;
    }
    popover = createAppearancePopover({
      type: 'epub',
      anchor: aaBtn,
      state: appearance,
      onChange: (changes) => {
        Object.assign(appearance, changes);
        saveReaderAppearance({
          readerTheme: appearance.theme,
          readerFont: appearance.font,
          readerLineHeight: appearance.lineHeight,
          readerFontSize: appearance.fontSize,
          fontSize: appearance.fontSize,
        });
        applyStyles();
      },
      onClose: () => {
        popover = null;
      },
    });
    root.append(popover);
  };

  prev.onclick = () => view.goLeft();
  next.onclick = () => view.goRight();

  // Contents
  const toc = view.book.toc || [];
  if (toc.length) {
    contentsBtn.hidden = false;
    contentsBtn.onclick = () => showContents(toc, (href) => view.goTo(href));
  }

  // Highlights drawn in the book
  view.addEventListener('create-overlay', () => {
    for (const h of highlights) view.addAnnotation({ value: h.cfi }).catch(() => {});
  });
  view.addEventListener('draw-annotation', (e) => {
    const th = THEMES[appearance.theme] || THEMES.paper;
    e.detail.draw(Overlayer.highlight, { color: th.marker });
  });
  view.addEventListener('show-annotation', (e) => {
    const h = highlights.find((x) => x.cfi === e.detail.value);
    if (h) toast(h.comment ? `Your note: ${h.comment}` : 'Highlighted');
  });

  // Selection → highlight bar
  let selection = null;
  let bar = null;
  const dropBar = () => {
    bar?.remove();
    bar = null;
  };
  view.addEventListener('load', (e) => {
    const { doc, index } = e.detail;
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('click', (evt) => {
      if (evt.target.closest?.('a, button, [role=button]')) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) return;
      const x = evt.clientX;
      const w = doc.defaultView?.innerWidth || doc.documentElement?.clientWidth || window.innerWidth;
      if (x < w * 0.2) {
        view.goLeft();
      } else if (x > w * 0.8) {
        view.goRight();
      } else {
        toggleChrome();
      }
    });
    let t;
    doc.addEventListener('selectionchange', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = doc.getSelection();
        const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
        if (text.length < 2) {
          selection = null;
          dropBar();
          return;
        }
        selection = { index, range: sel.getRangeAt(0).cloneRange(), text, doc };
        showBar();
      }, 250);
    });
  });

  function showBar() {
    if (bar || !opts.onHighlight) return;
    const keep = el('button', { class: 'btn btn-mark' }, icon('marker', 'i i-sm'), 'Highlight');
    const withNote = el('button', { class: 'btn btn-quiet' }, 'Add a note');
    const cancel = el('button', { class: 'btn btn-quiet', 'aria-label': 'Cancel' }, '✕');
    bar = el('div', { class: 'selection-bar' }, keep, withNote, cancel);
    stage.append(bar);
    cancel.onclick = () => {
      selection?.doc.getSelection().removeAllRanges();
      dropBar();
    };
    keep.onclick = () => save('');
    withNote.onclick = async () => {
      const sel = selection;
      const asked = await askNote(sel?.text || '');
      if (asked) {
        selection = sel;
        save(asked.thought, asked.title, asked.tags);
      }
    };
  }

  async function save(comment, title = '', tags = '') {
    const sel = selection;
    if (!sel) return;
    sel.doc.getSelection().removeAllRanges();
    dropBar();
    const cfi = view.getCFI(sel.index, sel.range);
    const loc = view.lastLocation || {};
    const h = {
      cfi,
      text: sel.text,
      comment: comment.trim(),
      chapter: loc.tocItem?.label?.trim() || '',
      page: loc.pageItem?.label || '',
      at: Date.now(),
    };
    highlights.push(h);
    view.addAnnotation({ value: cfi }).catch(() => {});
    await saveProgress(item, { highlights });
    try {
      const saved = await opts.onHighlight({ text: h.text, comment: h.comment, chapter: h.chapter, page: h.page, at: cfi, title, tags, progress: loc.fraction != null ? Number(loc.fraction.toFixed(2)) : null });
      if (saved?.file) {

        h.file = saved.file;
        await saveProgress(item, { highlights });
      }
      toast(saved?.where ? `Insight saved to ${saved.where}` : 'Insight saved on this device');
    } catch (err) {
      toast(`Kept in the book on this device. ${err.message}`);
    }
  }

  // Progress: record it only once you actually move, so opening a book on a second
  // device can't overwrite the position synced from the first.
  let openedCfi = null;
  view.addEventListener('relocate', (e) => {
    const { fraction, cfi } = e.detail;
    status.textContent = typeof fraction === 'number' ? `${Math.round(fraction * 100)}%` : '';
    if (openedCfi === null) {
      openedCfi = cfi;
      return;
    }
    if (cfi === openedCfi) return;
    openedCfi = '';
    saveProgress(item, { pct: fraction || 0, loc: cfi });
  });

  try {
    await view.init({ lastLocation: opts.at || saved.loc || undefined, showTextStart: !opts.at && !saved.loc });
  } catch {
    await view.goToFraction(0);
  }
  if (!view.lastLocation) view.renderer.next?.();
}

function showContents(toc, go) {
  const dialog = el('dialog', { class: 'sheet sheet-tall' });
  const list = el('nav', { class: 'toc' });
  const add = (items, depth) => {
    for (const t of items) {
      const b = el('button', { class: 'toc-item', style: `padding-left:${12 + depth * 16}px` }, (t.label || '').trim());
      b.onclick = () => {
        dialog.close();
        go(t.href);
      };
      list.append(b);
      if (t.subitems?.length) add(t.subitems, depth + 1);
    }
  };
  add(toc, 0);
  dialog.append(
    el(
      'div',
      { class: 'sheet-inner' },
      el('div', { class: 'sheet-head' }, el('h2', {}, 'Contents'), el('button', { class: 'icon-btn', 'data-close': '', 'aria-label': 'Close' }, icon('close'))),
      list
    )
  );
  document.body.append(dialog);
  openSheet(dialog).then(() => dialog.remove());
}
