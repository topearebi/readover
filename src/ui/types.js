// The type checklist (types are top-level folders), used by "What to show" and the
// Notes filter: one toggle per folder, plus Unsorted, each with how many notes it has.
// None ticked means all types. Hidden when the library has no folders.
import { el } from './overlay.js';

/**
 * Fill a `<fieldset class="type-checks">` with toggles for `options` ([{ id, label, count }]
 * from filters.typeOptions). `chosen` is the list ticked; `onChange()` runs on each toggle.
 */
export function renderTypeChecks(box, options, chosen = [], onChange = () => {}) {
  const list = box.querySelector('.type-list');
  const ticked = new Set(chosen.map((t) => String(t).toLowerCase()));
  // Only Unsorted means there are no folders: no types to pick from.
  box.hidden = !options.some((o) => o.id !== '');
  list.replaceChildren(
    ...options.map((o) => {
      const input = el('input', { type: 'checkbox', value: o.id });
      input.checked = ticked.has(o.id.toLowerCase());
      input.onchange = onChange;
      return el('label', { class: 'type-check' }, input, el('span', {}, o.label, el('small', {}, String(o.count))));
    })
  );
}

/** The types ticked, as a list of folder names ('' = Unsorted). */
export const readTypeChecks = (box) => (box.hidden ? [] : [...box.querySelectorAll('input:checked')].map((i) => i.value));

/** A library's types: its top-level folders (not Archive, not hidden ones), A–Z. */
export function libraryTypes(items, src) {
  if (!src) return [];
  const root = String(src.root || '').replace(/^\/+|\/+$/g, '');
  const names = new Set();
  for (const i of items) {
    if (i.sourceId !== src.id || i.kind !== 'note') continue; // a folder of books isn't a type of note
    const rel = root ? (i.path.startsWith(`${root}/`) ? i.path.slice(root.length + 1) : null) : i.path;
    const cut = rel ? rel.indexOf('/') : -1;
    if (cut <= 0) continue;
    const name = rel.slice(0, cut);
    if (!name.startsWith('.') && name.toLowerCase() !== 'archive') names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
