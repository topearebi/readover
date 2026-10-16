// Continuous-scroll PDF reader. Pages render only near the viewport. Each page gets
// PDF.js's invisible text layer, so text can be selected and highlighted (only in
// PDFs that contain text: scanned pages without OCR have nothing to select).
import { loadPdfJs } from '../lib/vendor.js';
import { progress, saveProgress } from '../store.js';
import { pushOverlay, el, icon, toast } from '../ui/overlay.js';
import { askNote } from '../ui/highlight-note.js';

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * @param opts { at?: 'page=N', onHighlight?(h) → Promise<string|void> }
 */
export async function openPdf(item, blob, title, opts = {}) {
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back' }, icon('back'));
  const status = el('span', { class: 'status' }, 'Opening…');
  const zoomOut = el('button', { class: 'icon-btn', 'aria-label': 'Smaller' }, '−');
  const zoomIn = el('button', { class: 'icon-btn', 'aria-label': 'Larger' }, '+');
  const stage = el('div', { class: 'pdf-stage', tabindex: '-1' });
  const wrap = el('div', { class: 'pdf-wrap' }, stage);
  const root = el(
    'div',
    { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'reader-bar' }, back, el('span', { class: 'title' }, title), status, zoomOut, zoomIn),
    wrap
  );
  document.body.append(root);

  let doc = null;
  let observer = null;
  let saveTimer = null;
  let selTimer = null;
  const onSelection = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 250);
  };
  const close = pushOverlay(() => {
    observer?.disconnect();
    clearTimeout(saveTimer);
    document.removeEventListener('selectionchange', onSelection);
    doc?.destroy();
    root.remove();
  }, { element: root });
  back.onclick = close;

  let lib;
  try {
    lib = await loadPdfJs();
    doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  } catch (err) {
    status.textContent = '';
    stage.append(el('p', { class: 'reader-error' }, `This PDF could not be opened: ${err.message}`));
    return;
  }

  const total = doc.numPages;
  const saved = (await progress.get(item.key)) || {};
  const highlights = [...(saved.highlights || [])];
  const openAt = parseInt(/page=(\d+)/.exec(opts.at || '')?.[1], 10);
  let current = Math.min(Math.max(openAt || parseInt(saved.loc, 10) || 1, 1), total);
  let zoom = 1;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const rendered = new Map();

  const widthFor = () => Math.min(stage.clientWidth - 24, 860) * zoom;
  const slots = [];
  for (let n = 1; n <= total; n++) {
    const slot = el('div', { class: 'pdf-page', 'data-page': n });
    slots.push(slot);
    stage.append(slot);
  }
  const sizeSlots = () => {
    const w = widthFor();
    for (const s of slots) {
      const ratio = s._ratio || first.height / first.width;
      s.style.width = `${w}px`;
      s.style.height = `${w * ratio}px`;
    }
  };
  sizeSlots();

  async function render(slot) {
    const n = Number(slot.dataset.page);
    if (rendered.has(n)) return;
    rendered.set(n, true);
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    slot._ratio = v1.height / v1.width;
    const w = widthFor();
    slot.style.height = `${w * slot._ratio}px`;
    const cssViewport = page.getViewport({ scale: w / v1.width });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (w / v1.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    try {
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      if (!rendered.get(n)) return;
      const textLayer = el('div', { class: 'textLayer' });
      slot.style.setProperty('--scale-factor', String(cssViewport.scale));
      slot.replaceChildren(canvas, textLayer);
      await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport: cssViewport }).render();
      paintHighlights(slot);
    } catch (err) {
      console.warn('PDF page failed', n, err);
    }
  }

  function unload(slot) {
    const n = Number(slot.dataset.page);
    if (!rendered.has(n)) return;
    rendered.delete(n);
    const c = slot.querySelector('canvas');
    if (c) c.width = c.height = 0;
    slot.replaceChildren();
  }

  /** Mark the text-layer spans covered by each saved highlight on this page. */
  function paintHighlights(slot) {
    const n = Number(slot.dataset.page);
    const spans = [...slot.querySelectorAll('.textLayer span:not(.markedContent)')];
    if (!spans.length) return;
    let flat = '';
    const ranges = spans.map((s) => {
      const start = flat.length;
      flat += `${norm(s.textContent)} `;
      return [start, flat.length];
    });
    for (const h of highlights.filter((x) => x.page === n)) {
      const at = flat.indexOf(norm(h.text));
      if (at < 0) continue;
      const end = at + norm(h.text).length;
      spans.forEach((s, i) => {
        if (ranges[i][1] > at && ranges[i][0] < end) s.classList.add('ro-hl');
      });
    }
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) render(e.target);
        else unload(e.target);
      }
    },
    { root: stage, rootMargin: '150% 0px' }
  );
  slots.forEach((s) => observer.observe(s));

  const onScroll = () => {
    const mid = stage.scrollTop + stage.clientHeight / 3;
    const slot = slots.find((s) => s.offsetTop + s.offsetHeight > mid) || slots[slots.length - 1];
    const n = Number(slot.dataset.page);
    if (n !== current) {
      current = n;
      status.textContent = `${current} of ${total}`;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveProgress(item, { pct: current / total, loc: String(current) }), 500);
    }
  };
  stage.addEventListener('scroll', onScroll, { passive: true });
  status.textContent = `${current} of ${total}`;

  const rezoom = (z) => {
    const page = current;
    zoom = z;
    [...rendered.keys()].forEach((n) => unload(slots[n - 1]));
    sizeSlots();
    slots[page - 1].scrollIntoView({ block: 'start' });
    slots.forEach((s) => {
      observer.unobserve(s);
      observer.observe(s);
    });
  };
  zoomIn.onclick = () => zoom < 2.5 && rezoom(zoom + 0.25);
  zoomOut.onclick = () => zoom > 0.5 && rezoom(zoom - 0.25);

  /* ---------- Selecting and highlighting ---------- */

  let bar = null;
  let selection = null;
  const dropBar = () => {
    bar?.remove();
    bar = null;
  };
  function checkSelection() {
    const sel = document.getSelection();
    const node = sel && !sel.isCollapsed ? sel.anchorNode : null;
    const slot = node?.parentElement?.closest?.('.pdf-page');
    const text = slot ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!slot || text.length < 2 || !stage.contains(slot)) {
      selection = null;
      dropBar();
      return;
    }
    selection = { text, page: Number(slot.dataset.page) };
    if (bar || !opts.onHighlight) return;
    const keep = el('button', { class: 'btn btn-mark' }, icon('marker', 'i i-sm'), 'Highlight');
    const withNote = el('button', { class: 'btn btn-quiet' }, 'Add a note');
    const cancel = el('button', { class: 'btn btn-quiet', 'aria-label': 'Cancel' }, '✕');
    bar = el('div', { class: 'selection-bar' }, keep, withNote, cancel);
    wrap.append(bar);
    cancel.onclick = () => {
      document.getSelection().removeAllRanges();
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
  document.addEventListener('selectionchange', onSelection);

  async function save(comment, title = '', tags = '') {
    const sel = selection;
    if (!sel) return;
    document.getSelection().removeAllRanges();
    dropBar();
    const h = { page: sel.page, text: sel.text, comment: comment.trim(), at: Date.now(), cfi: `page=${sel.page}:${norm(sel.text).slice(0, 40)}` };
    highlights.push(h);
    await saveProgress(item, { highlights });
    const slot = slots[sel.page - 1];
    if (rendered.has(sel.page)) paintHighlights(slot);
    try {
      const saved = await opts.onHighlight({ text: h.text, comment: h.comment, chapter: '', page: String(sel.page), at: `page=${sel.page}`, title, tags, progress: (sel.page / total).toFixed(2) });
      if (saved?.file) {

        h.file = saved.file;
        await saveProgress(item, { highlights });
      }
      toast(saved?.where ? `Insight saved to ${saved.where}` : 'Insight saved on this device');
    } catch (err) {
      toast(`Kept in the PDF on this device. ${err.message}`);
    }
  }

  if (current > 1) requestAnimationFrame(() => slots[current - 1].scrollIntoView({ block: 'start' }));
  if (openAt) {
    // Opened from a highlight card: briefly mark the page.
    setTimeout(() => slots[current - 1].classList.add('flash-page'), 300);
  }
  stage.focus();
}
