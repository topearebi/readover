// Quick capture. Readover is read-first, so this stays small: what you write, and where
// it goes. The type is a top-level folder of the library (none = the top level,
// Unsorted); the file is named from the date and the title, or the first words.
import * as store from '../store.js';
import { canWrite, displayName, writeNote, deviceSource, DEVICE_ID } from '../library.js';
import { openSheet, toast, el, closeTop } from './overlay.js';
import { newNotePath, newNoteText, titleFromText } from '../notefile.js';
import { newNotesHome } from '../insights.js';
import { libraryTypes } from './types.js';

const NEW_TYPE = '\u0000new';
const STATUS_KEY = 'readover.statusByFolder';
const clean = (f) => String(f || '').trim().replace(/^\/+|\/+$/g, '');
const lastStatus = (folder) => {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}')[folder.toLowerCase()] || '';
  } catch {
    return '';
  }
};
const rememberStatus = (folder, status) => {
  try {
    const all = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
    all[folder.toLowerCase()] = status;
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch {}
};

export function initCompose(app) {
  const sheet = document.getElementById('compose-sheet');
  const form = document.getElementById('compose-form');
  const f = form.elements;
  const typeField = document.getElementById('compose-type-field');
  const addType = document.getElementById('compose-add-type');
  const newType = document.getElementById('compose-new-type');
  let allItems = [];

  const srcOf = (id) => (id === DEVICE_ID ? deviceSource(false) || { id: DEVICE_ID, type: 'device', root: '' } : store.getSource(id));
  const rootOf = (src) => clean(src?.root);

  /** The folder chosen, relative to the repo (the library's top level when Unsorted). */
  function chosenFolder() {
    const root = rootOf(srcOf(f.source.value));
    const join = (name) => [root, clean(name)].filter(Boolean).join('/');
    if (!newType.hidden) return join(f.newType.value);
    return typeField.hidden ? root : f.folder.value;
  }

  function showNewType(on) {
    newType.hidden = !on;
    if (on) f.newType.focus();
  }

  /** Fill the type picker for the chosen library; `keep` is a folder to select. */
  function fillTypes(keep = null) {
    const src = srcOf(f.source.value);
    const root = rootOf(src);
    const types = libraryTypes(allItems, src);
    if (keep != null && keep !== root && !keep.startsWith(`${root}/`) && root) keep = root;
    const opts = [el('option', { value: root }, 'Unsorted'), ...types.map((t) => el('option', { value: [root, t].filter(Boolean).join('/') }, t))];
    // A deeper folder (a note started from inside it) stays as it is.
    if (keep && !opts.some((o) => o.value === keep)) opts.push(el('option', { value: keep }, keep.slice(root ? root.length + 1 : 0).split('/').join(' / ')));
    opts.push(el('option', { value: NEW_TYPE }, 'New type…'));
    f.folder.replaceChildren(...opts);
    f.folder.value = keep != null && opts.some((o) => o.value === keep) ? keep : root;
    // No folders in this library: no types to pick, just a quiet way to start one.
    const none = types.length === 0 && !(keep && keep !== root);
    typeField.hidden = none;
    addType.hidden = !none;
    showNewType(false);
    applyStatus();
  }

  function applyStatus() {
    const s = lastStatus(chosenFolder());
    form.querySelector(`input[name=status][value="${s}"]`).checked = true;
  }

  f.folder.onchange = () => {
    if (f.folder.value === NEW_TYPE) {
      showNewType(true);
      return;
    }
    showNewType(false);
    applyStatus();
  };
  addType.onclick = () => {
    addType.hidden = true;
    showNewType(true);
  };
  f.newType.addEventListener('change', applyStatus);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const src = f.source.value === DEVICE_ID ? deviceSource(true) : store.getSource(f.source.value);
    const title = f.title.value.trim();
    const body = f.body.value.trim();
    if (!title && !body) {
      toast('Write something first');
      f.body.focus();
      return;
    }
    if (!newType.hidden && !clean(f.newType.value)) {
      toast('Name the new type, or pick one');
      f.newType.focus();
      return;
    }
    const folder = chosenFolder();
    const status = form.querySelector('input[name=status]:checked')?.value || '';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      // YYYY-MM-DD-title-words.md; the name stays fixed from now on, the title can change.
      const name = title || titleFromText(body).replace(/…$/, '');
      const path = await newNotePath(folder, name, async (p) => Boolean(await store.items.get(store.keyOf(src.id, p))));
      const text = newNoteText({ title, body, status, tags: f.tags.value });
      const item = await writeNote(src, path, text, { message: `Readover: add ${path}` });
      rememberStatus(folder, status);
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

  // Ctrl/Cmd+Enter saves from anywhere in the form.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Keep an unsent draft per device.
  form.addEventListener('input', () => {
    try {
      localStorage.setItem('readover.draft', JSON.stringify({ title: f.title.value, body: f.body.value, tags: f.tags.value }));
    } catch {}
  });

  return {
    /** presets: { sourceId, folder, title } to start a note in a particular place. */
    async open(presets = {}) {
      // Repos and folders you can write to, then this device (always available).
      const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
      const sel = f.source;
      sel.replaceChildren(...writable.map((s) => el('option', { value: s.id }, displayName(s))), el('option', { value: DEVICE_ID }, 'This device'));
      // Unless asked for a particular place, new notes go where Settings says.
      if (presets.sourceId && [...sel.options].some((o) => o.value === presets.sourceId)) sel.value = presets.sourceId;
      else sel.value = newNotesHome().id;
      allItems = await store.items.all();
      fillTypes(presets.folder != null ? clean(presets.folder) : null);
      sel.onchange = () => fillTypes();
      try {
        const draft = JSON.parse(localStorage.getItem('readover.draft') || 'null');
        if (presets.title) {
          f.title.value = presets.title;
          f.body.value = '';
        } else if (draft) {
          f.title.value = draft.title || '';
          f.body.value = draft.body || '';
          f.tags.value = draft.tags || '';
        }
      } catch {}
      const done = openSheet(sheet);
      (presets.title ? f.body : f.title).focus();
      await done;
    },
  };
}
