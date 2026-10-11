// Notes: the place to work on notes, separate from reading. Browse by library and
// folder, search everything, open a note to edit it, link it, move it or delete it.
import * as store from '../store.js';
import { displayName, canWrite } from '../library.js';
import { entries, search, coverage, downloadAll } from '../notes-index.js';
import { dataHome } from '../sync.js';
import { el, icon, toast } from './overlay.js';
import { garden } from '../garden.js';
import { fromPath } from '../dates.js';
import { changedAt } from '../clock.js';
import { GROWTH_FILTERS, counts, filterLabel, isFiltered, passes, typeList } from '../filters.js';
import { renderTypeChecks, readTypeChecks } from './types.js';
import { glyph, tagText } from './growth.js';
import { sheet } from './sheet.js';

const SORTS = [
  { id: 'folders', label: 'Folders' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'tended', label: 'Recently tended' },
  { id: 'least', label: 'Least tended' },
];

/** When a note was written: frontmatter date (with its time), then the file name, then what's known of its history. */
function noteDate(e) {
  const raw = String(Array.isArray(e.meta?.date) ? e.meta.date[0] : e.meta?.date || e.meta?.created || '');
  const m = /^(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d(?::\d\d)?))?\s*(Z|[+-]\d\d:?\d\d)?/.exec(raw);
  if (m) {
    const zone = m[3] ? (m[3] === 'Z' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(-2)}`) : '';
    const t = Date.parse(`${m[1]}T${m[2] || '12:00'}${zone}`);
    if (!Number.isNaN(t)) return t;
  }
  const p = fromPath(e.item.path);
  if (p) return p.at;
  return e.item.dateAt || changedAt(e.item) || 0;
}
const shortDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** @param app { openItem(item), compose({ sourceId, folder }) } */
export function initNotes(app) {
  const root = document.getElementById('notes');
  const view = { sourceId: null, folder: '', query: '' };
  const prefs = () => store.getPrefs();
  const types = () => typeList(prefs().notesTypes);
  let searchTimer;

  const searchInput = el('input', { type: 'search', class: 'notes-search', placeholder: 'Search your notes', 'aria-label': 'Search your notes', autocomplete: 'off' });
  const coverageLine = el('p', { class: 'hint notes-coverage', hidden: true });
  const crumbs = el('nav', { class: 'notes-crumbs', 'aria-label': 'Folder' });
  const newBtn = el('button', { class: 'btn' }, icon('pen', 'i i-sm'), 'New note here');
  const list = el('div', { class: 'notes-list' });
  // Sort and filter (remembered on this device, separately from the feed's).
  const sortSel = el('select', { class: 'notes-sort', 'aria-label': 'Sort' }, ...SORTS.map((o) => el('option', { value: o.id }, o.label)));
  const filterBtn = el('button', { type: 'button', class: 'btn btn-quiet notes-filter' });
  const tools = el('div', { class: 'notes-tools' }, el('label', { class: 'notes-sort-label' }, 'Sort ', sortSel), filterBtn);
  root.replaceChildren(el('div', { class: 'notes-inner' }, el('div', { class: 'notes-top' }, searchInput, tools, coverageLine), el('div', { class: 'notes-bar' }, crumbs, el('div', { class: 'notes-bar-actions' }, newBtn)), list));
  sortSel.onchange = () => {
    store.setPrefs({ notesSort: sortSel.value });
    render();
  };
  filterBtn.onclick = () => openFilters();
  const showFilterLabel = () => {
    const label = filterLabel(prefs().notesGrowth, types());
    filterBtn.textContent = label ? `Filter: ${label}` : 'Filter';
    filterBtn.classList.toggle('active', Boolean(label));
  };

  async function openFilters() {
    const map = await garden().catch(() => new Map());
    const here = [...map].filter(([k]) => !view.sourceId || k.startsWith(`${view.sourceId}|`)).map(([, v]) => v);
    const growthSel = el('select', { name: 'growth' });
    const typeBox = el('fieldset', { class: 'type-checks' }, el('legend', {}, 'Types ', el('span', { class: 'hint' }, 'none ticked = all')), el('div', { class: 'type-list' }));
    let chosen = types();
    const fill = (g) => {
      const c = counts(here, g, chosen);
      growthSel.replaceChildren(...GROWTH_FILTERS.map((f) => el('option', { value: f.id }, f.id === 'any' ? 'Any' : `${f.label} (${c.growth[f.id]})`)));
      growthSel.value = GROWTH_FILTERS.some((f) => f.id === g) ? g : g === 'resting' ? 'done' : 'any';
      renderTypeChecks(typeBox, c.types, chosen, () => {
        chosen = readTypeChecks(typeBox);
        fill(growthSel.value);
      });
    };
    fill(prefs().notesGrowth || 'any');
    growthSel.onchange = () => fill(growthSel.value);
    const { value } = await sheet({
      title: 'Filter notes',
      fields: [el('label', { class: 'field' }, 'Growth', growthSel), typeBox],
      submit: 'Show these',
    });
    if (value !== 'ok') return;
    store.setPrefs({ notesGrowth: growthSel.value, notesTypes: readTypeChecks(typeBox) });
    render();
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.query = searchInput.value.trim();
      render();
    }, 150);
  });
  newBtn.onclick = () => app.compose({ sourceId: view.sourceId, folder: view.folder });


  function row(item, title, sub, g = null, meta = '') {
    const tag = g && !['pending', 'inbox'].includes(g.stage) ? miniTag(g) : null;
    const b = el(
      'button',
      { class: 'note-row', 'data-key': item.key },
      el('b', {}, title),
      sub ? el('span', {}, sub) : null,
      tag || meta ? el('small', { class: 'row-meta' }, tag, tag && meta ? ' · ' : '', meta) : null
    );
    b.onclick = () => app.openItem(item);
    return b;
  }
  function miniTag(g) {
    const { main, rest } = tagText(g);
    const cls = g.stage === 'pruned' ? 'pruned' : g.resting ? 'resting' : g.health || 'unknown';
    return el('span', { class: `mini-grow ${cls}` }, glyph(g.stage === 'pruned' ? 'pruned' : g.stage), `${main}${rest ? ` · ${rest}` : ''}`);
  }
  function folderRow(label, count, go) {
    const b = el('button', { class: 'folder-row' }, el('span', { class: 'folder-name' }, label), el('span', { class: 'folder-count' }, String(count)));
    b.onclick = go;
    return b;
  }

  async function renderCoverage() {
    const { total, withText } = await coverage();
    const missing = total - withText;
    if (!missing) {
      coverageLine.hidden = true;
      return;
    }
    const btn = el('button', { class: 'linklike' }, 'Download them');
    btn.onclick = async () => {
      btn.disabled = true;
      await downloadAll((n) => (coverageLine.firstChild.textContent = `Downloading… ${n} of ${missing}. `));
      toast('All notes can be searched now');
      render();
    };
    coverageLine.replaceChildren(el('span', {}, `${missing} ${missing === 1 ? 'note hasn’t' : 'notes haven’t'} been opened on this device yet, so search only finds ${missing === 1 ? 'it' : 'them'} by title. `), btn);
    coverageLine.hidden = false;
  }

  async function render() {
    renderCoverage();
    showFilterLabel();
    sortSel.value = prefs().notesSort || 'folders';
    const all = await entries();
    const growth = await garden().catch(() => new Map());
    const titles = new Map(all.map((e) => [e.item.key, e.title]));
    // Libraries with notes, plus where new notes go (a books-only repo isn't listed).
    const sources = store.getSources().filter((s) => all.some((e) => e.item.sourceId === s.id) || s.id === dataHome()?.id || s.type === 'device');

    // Search across everything
    if (view.query) {
      crumbs.replaceChildren(el('span', {}, 'Search results'));
      newBtn.hidden = true;
      const results = await search(view.query);
      list.replaceChildren(
        ...(results.length
          ? results.map((r) => row(r.item, r.title, r.snippet || [displayName(store.getSource(r.item.sourceId)), r.item.folder].filter(Boolean).join(' / '), growth.get(r.item.key)))
          : [el('p', { class: 'notes-empty' }, `Nothing matches “${view.query}”.`)])
      );
      return;
    }

    // Choose a library first when there's more than one
    if (!view.sourceId && sources.length === 1) view.sourceId = sources[0].id;
    newBtn.hidden = !(view.sourceId ? canWrite(store.getSource(view.sourceId)) : true);
    // Sorted or filtered across all libraries.
    const flat = (prefs().notesSort || 'folders') !== 'folders' || isFiltered(prefs().notesGrowth || 'any', types());
    if (!view.sourceId && flat) {
      crumbs.replaceChildren(el('span', {}, 'All notes'));
      renderFlat(all, growth, prefs().notesSort || 'folders', prefs().notesGrowth || 'any', types(), titles);
      return;
    }
    if (!view.sourceId) {
      crumbs.replaceChildren(el('span', {}, 'All notes'));
      list.replaceChildren(
        ...sources.map((s) =>
          folderRow(displayName(s), all.filter((e) => e.item.sourceId === s.id).length, () => {
            view.sourceId = s.id;
            view.folder = '';
            render();
          })
        )
      );
      if (!sources.length) list.replaceChildren(el('p', { class: 'notes-empty' }, 'No notes yet. Write one with the pen above, or connect a GitHub repo or folder in Settings.'));
      return;
    }

    // Breadcrumbs
    const src = store.getSource(view.sourceId);
    const parts = view.folder ? view.folder.split('/') : [];
    const crumb = (label, go, current) => {
      const b = el('button', { class: 'crumb-btn', 'aria-current': current ? 'location' : null }, label);
      b.onclick = go;
      return b;
    };
    crumbs.replaceChildren(
      ...(sources.length > 1 ? [crumb('All notes', () => ((view.sourceId = null), (view.folder = ''), render()))] : []),
      crumb(displayName(src), () => ((view.folder = ''), render()), !parts.length),
      ...parts.map((p, i) => crumb(p, () => ((view.folder = parts.slice(0, i + 1).join('/')), render()), i === parts.length - 1))
    );

    // Sorted or filtered: one flat list of everything in this library and folder.
    const sortId = prefs().notesSort || 'folders';
    const gId = prefs().notesGrowth || 'any';
    const tId = types();
    if (sortId !== 'folders' || isFiltered(gId, tId)) {
      renderFlat(all, growth, sortId, gId, tId, titles);
      return;
    }

    // Folders and notes in this folder
    const here = all.filter((e) => e.item.sourceId === view.sourceId);
    const prefix = view.folder ? `${view.folder}/` : '';
    const sub = new Map();
    const notes = [];
    for (const e of here) {
      const f = e.item.folder;
      if (f === view.folder) notes.push(e);
      else if (!view.folder || f.startsWith(prefix)) {
        const next = f.slice(prefix.length).split('/')[0];
        if (next) sub.set(next, (sub.get(next) || 0) + 1);
      }
    }
    list.replaceChildren(
      ...[...sub.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => folderRow(name, n, () => ((view.folder = prefix + name), render()))),
      ...notes.sort((a, b) => a.title.localeCompare(b.title)).map((e) => row(e.item, titles.get(e.item.key), e.hasText ? firstLine(e.text) : '', growth.get(e.item.key)))
    );
    if (!list.children.length) list.append(el('p', { class: 'notes-empty' }, 'Nothing here yet.'));
  }

  /** Every note in this library (and folder, with its subfolders), filtered and sorted. */
  function renderFlat(all, growth, sortId, gId, tId, titles) {
    const prefix = view.folder ? `${view.folder}/` : '';
    let rows = all.filter((e) => (!view.sourceId || e.item.sourceId === view.sourceId) && (!view.folder || e.item.folder === view.folder || e.item.folder.startsWith(prefix)));
    rows = rows.filter((e) => passes(growth.get(e.item.key), gId, tId));
    const when = new Map(rows.map((e) => [e.item.key, noteDate(e)]));
    const tended = (e) => growth.get(e.item.key)?.lastTended || 0;
    const cmp = {
      folders: (a, b) => (a.item.folder || '').localeCompare(b.item.folder || '') || a.title.localeCompare(b.title),
      newest: (a, b) => when.get(b.item.key) - when.get(a.item.key),
      oldest: (a, b) => (when.get(a.item.key) || Infinity) - (when.get(b.item.key) || Infinity),
      tended: (a, b) => tended(b) - tended(a),
      least: (a, b) => (tended(a) || Infinity) - (tended(b) || Infinity),
    }[sortId];
    rows.sort(cmp);
    const where = (e) => [view.sourceId ? '' : displayName(store.getSource(e.item.sourceId)), e.item.folder].filter(Boolean).join(' / ');
    list.replaceChildren(
      el('p', { class: 'hint notes-count' }, `${rows.length} ${rows.length === 1 ? 'note' : 'notes'}`),
      ...rows.slice(0, 500).map((e) => row(e.item, titles.get(e.item.key), e.hasText ? firstLine(e.text) : '', growth.get(e.item.key), [shortDate(when.get(e.item.key)), where(e)].filter(Boolean).join(' · ')))
    );
    if (rows.length > 500) list.append(el('p', { class: 'hint' }, `Showing the first 500. Narrow it with a folder or filter.`));
    if (!rows.length) list.append(el('p', { class: 'notes-empty' }, isFiltered(gId, tId) ? 'No notes match these filters here.' : 'Nothing here yet.'));
  }

  const firstLine = (text) =>
    text
      .replace(/^#.*$/m, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t) // [[link|label]]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url)
      .replace(/[#>*_`=[\]]/g, '')
      .trim()
      .split('\n')
      .find((l) => l.trim())
      ?.slice(0, 120) || '';

  window.addEventListener('readover:notes-changed', () => !root.hidden && render());

  return {
    render,
    focusSearch() {
      searchInput.focus();
    },
  };
}
