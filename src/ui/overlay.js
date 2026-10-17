// Overlays (sheets, readers) share one stack tied to browser history, so the
// Android back button, the Escape key and on-screen close buttons all behave the same.
const stack = [];

window.addEventListener('popstate', () => {
  const top = stack.pop();
  if (!top) return;
  top.close();
  // Give back the rest of the page, and focus to whatever opened this overlay.
  for (const el of top.inerted || []) el.inert = false;
  const prev = stack[stack.length - 1];
  if (prev?.element) {
    prev.element.inert = false;
  }
  setTimeout(() => {
    let back = top.opener;
    // A list redrawn meanwhile: find the same row again by its key.
    if (back && !back.isConnected && back.dataset?.key) back = document.querySelector(`[data-key="${CSS.escape(back.dataset.key)}"]`);
    if (back?.isConnected && !back.closest('[inert]')) back.focus({ preventScroll: true });
  }, 0);
  top.settled?.(); // anything waiting for this overlay to be fully gone can continue
});

function requestClose(entry) {
  if (!stack.includes(entry)) return Promise.resolve();
  if (!entry.closing) {
    entry.closing = true; // popstate is async; guard against double back()
    entry.gone = new Promise((r) => (entry.settled = r));
    history.back();
  }
  return entry.gone;
}

/**
 * Register an open overlay. `close` tears it down; `element`, for a full-screen
 * overlay, is kept interactive while the rest of the page is made inert. Returns a function that closes
 * it; that function's promise resolves once the browser has stepped back, so the
 * next overlay can safely be opened (otherwise the pending "back" would close it).
 */
export function pushOverlay(close, { element = null, opener = document.activeElement } = {}) {
  const entry = { close, opener, element };
  // A full-screen overlay (a reader) keeps keyboard focus inside it, like a dialog.
  if (element) {
    element.inert = false;
    entry.inerted = [...document.body.children].filter((el) => el !== element && !el.inert && el.tagName !== 'DIALOG' && el.id !== 'toast' && el.tagName !== 'SCRIPT');
    for (const el of entry.inerted) el.inert = true;
  }
  stack.push(entry);
  history.pushState({ readover: stack.length }, '');
  return () => requestClose(entry);
}

export const hasOverlay = () => stack.length > 0;

export function closeTop() {
  const top = stack[stack.length - 1];
  return top ? requestClose(top) : Promise.resolve();
}

export async function closeAll() {
  while (stack.length) {
    await closeTop();
  }
}

/** Open a <dialog> as a sheet, wired to the overlay stack. Resolves with returnValue on close. */
export function openSheet(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.showModal();
    let closing = false;
    const close = pushOverlay(() => {
      closing = true;
      if (dialog.open) dialog.close();
    });
    const onCancel = (e) => {
      e.preventDefault();
      close();
    };
    const onClick = (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) close();
    };
    const onClose = () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('close', onClose);
      const value = dialog.returnValue;
      // Closed by its own buttons: wait until history has stepped back before resolving.
      if (!closing) close().then(() => resolve(value));
      else resolve(value);
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
  });
}

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: message }));
  if (action) {
    const list = Array.isArray(action) ? action : [action];
    for (const act of list) {
      if (!act || !act.label) continue;
      const b = document.createElement('button');
      b.textContent = act.label;
      if (act.class) b.className = act.class;
      b.onclick = () => {
        el.classList.remove('show');
        act.run?.();
      };
      el.append(b);
    }
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? (Array.isArray(action) ? 8000 : 5000) : 2600);
}

export function haptic(ms = 8) {
  if ('vibrate' in navigator) navigator.vibrate(ms);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export function icon(name, cls = 'i') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
