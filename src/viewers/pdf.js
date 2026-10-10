// Continuous-scroll PDF reader. Pages render only near the viewport.
import { loadPdfJs } from '../lib/vendor.js';
import { progress } from '../store.js';
import { pushOverlay, el, icon } from '../ui/overlay.js';

export async function openPdf(item, blob, title) {
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back' }, icon('back'));
  const status = el('span', { class: 'status' }, 'Opening…');
  const zoomOut = el('button', { class: 'icon-btn', 'aria-label': 'Smaller' }, '−');
  const zoomIn = el('button', { class: 'icon-btn', 'aria-label': 'Larger' }, '+');
  const stage = el('div', { class: 'pdf-stage', tabindex: '-1' });
  const root = el(
    'div',
    { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'reader-bar' }, back, el('span', { class: 'title' }, title), status, zoomOut, zoomIn),
    stage
  );
  document.body.append(root);

  let doc = null;
  let observer = null;
  let saveTimer = null;
  const close = pushOverlay(() => {
    observer?.disconnect();
    clearTimeout(saveTimer);
    doc?.destroy();
    root.remove();
  });
  back.onclick = close;

  try {
    const lib = await loadPdfJs();
    doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  } catch (err) {
    status.textContent = '';
    stage.append(el('p', { class: 'reader-error' }, `This PDF could not be opened: ${err.message}`));
    return;
  }

  const total = doc.numPages;
  const saved = await progress.get(item.key);
  let current = Math.min(Math.max(parseInt(saved?.loc, 10) || 1, 1), total);
  let zoom = 1;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const rendered = new Map(); // page -> task

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (w / v1.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    try {
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      if (rendered.get(n)) slot.replaceChildren(canvas);
    } catch (err) {
      console.warn('PDF page failed', n, err);
    }
  }

  function unload(slot) {
    const n = Number(slot.dataset.page);
    if (!rendered.has(n)) return;
    rendered.delete(n);
    const c = slot.querySelector('canvas');
    if (c) {
      c.width = c.height = 0;
      c.remove();
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
      saveTimer = setTimeout(
        () =>
          progress.put({ ...(saved || {}), key: item.key, sourceId: item.sourceId, pct: current / total, loc: String(current), updatedAt: Date.now() }),
        500
      );
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

  if (current > 1) requestAnimationFrame(() => slots[current - 1].scrollIntoView({ block: 'start' }));
  stage.focus();
}
