// Quick capture. Readover is read-first, so this stays small: a title and a body.
import * as store from '../store.js';
import { canWrite, displayName, writeNote, deviceSource, DEVICE_ID } from '../library.js';
import { openSheet, toast, el, closeTop } from './overlay.js';

const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|#^[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled';

export function initCompose(app) {
  const sheet = document.getElementById('compose-sheet');
  const form = document.getElementById('compose-form');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const src = f.source.value === DEVICE_ID ? deviceSource(true) : store.getSource(f.source.value);
    const title = f.title.value.trim();
    const folder = f.folder.value.trim().replace(/^\/|\/$/g, '');
    const path = `${folder ? `${folder}/` : ''}${slug(title)}.md`;
    const text = `# ${title}\n\n${f.body.value.trim()}\n`;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const existing = await store.items.get(store.keyOf(src.id, path));
      if (existing && !confirm(`"${path}" already exists. Replace it?`)) return;
      const item = await writeNote(src, path, text, { message: `Readover: add ${path}` });
      localStorage.removeItem('readover.draft');
      form.reset();
      closeTop();
      toast(src.type === 'device' ? 'Saved on this device' : `Saved to ${displayName(src)}`);
      if (src.type === 'device') navigator.storage?.persist?.().catch(() => {}); // ask the browser to keep it
      app.showFirst(item);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Keep an unsent draft per device.
  form.addEventListener('input', () => {
    try {
      localStorage.setItem('readover.draft', JSON.stringify({ title: form.elements.title.value, body: form.elements.body.value }));
    } catch {}
  });

  return {
    /** presets: { sourceId, folder, title } to start a note in a particular place. */
    async open(presets = {}) {
      // Repos and folders you can write to, then this device (always available).
      const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
      const prefs = store.getPrefs();
      const sel = form.elements.source;
      sel.replaceChildren(
        ...writable.map((s) => el('option', { value: s.id }, displayName(s))),
        el('option', { value: DEVICE_ID }, 'This device')
      );
      if (presets.sourceId && [...sel.options].some((o) => o.value === presets.sourceId)) sel.value = presets.sourceId;
      else if (writable.some((s) => s.id === prefs.scope)) sel.value = prefs.scope;
      form.elements.folder.value = presets.folder ?? prefs.folder ?? '';
      const allItems = await store.items.all();
      const fillFolders = () => {
        const folders = new Set(allItems.filter((i) => i.sourceId === sel.value && i.folder).map((i) => i.folder));
        document.getElementById('compose-folders').replaceChildren(...[...folders].sort().map((f) => el('option', { value: f })));
      };
      sel.onchange = fillFolders;
      const folders = new Set(allItems.filter((i) => i.sourceId === sel.value && i.folder).map((i) => i.folder));
      document.getElementById('compose-folders').replaceChildren(...[...folders].sort().map((f) => el('option', { value: f })));
      try {
        const draft = JSON.parse(localStorage.getItem('readover.draft') || 'null');
        if (presets.title) {
          form.elements.title.value = presets.title;
          form.elements.body.value = '';
        } else if (draft) {
          form.elements.title.value = draft.title || '';
          form.elements.body.value = draft.body || '';
        }
      } catch {}
      const done = openSheet(sheet);
      form.elements.title.focus();
      await done;
    },
  };
}
