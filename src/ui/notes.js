// Notes: the place to work on notes, separate from reading. Browse by library and
// folder, search everything, open a note to edit it, link it, move it or delete it.
import * as store from '../store.js';
import { displayName, canWrite, sourceNotesZip, moveNotesBetweenSources, DEVICE_ID } from '../library.js';
import { entries, search, coverage, downloadAll } from '../notes-index.js';
import { dataHome } from '../sync.js';
import { el, icon, toast } from './overlay.js';
import { garden } from '../garden.js';
import { fromPath } from '../dates.js';
import { changedAt } from '../clock.js';
import { GROWTH_FILTERS, counts, filterLabel, isFiltered, passes, typeList } from '../filters.js';
import { renderTypeChecks, readTypeChecks } from './types.js';
import { glyph, tagText } from './growth.js';
import { sheet, menu } from './sheet.js';

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
  const manageBtn = el('button', { type: 'button', class: 'btn btn-quiet notes-manage-btn' }, 'Actions ▾');
  const list = el('div', { class: 'notes-list' });

  // Bulk actions bar
  const bulkBar = el('div', { class: 'notes-bulk-bar', hidden: true });
  const selectAllBtn = el('button', { type: 'button', class: 'btn btn-sm btn-quiet' }, 'Select all');
  const bulkCount = el('span', { class: 'notes-bulk-count' }, '0 selected');
  const bulkMoveBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary' }, 'Move to…');
  const bulkExportBtn = el('button', { type: 'button', class: 'btn btn-sm btn-quiet' }, 'Export (.zip)');
  const bulkDoneBtn = el('button', { type: 'button', class: 'btn btn-sm btn-quiet' }, 'Done');
  bulkBar.append(selectAllBtn, bulkCount, bulkMoveBtn, bulkExportBtn, bulkDoneBtn);

  let selectMode = false;
  const selectedKeys = new Set();
  let currentVisibleNotes = [];

  function startSelectMode() {
    selectMode = true;
    selectedKeys.clear();
    bulkBar.hidden = false;
    updateBulkBar();
    render();
  }

  function exitSelectMode() {
    selectMode = false;
    selectedKeys.clear();
    bulkBar.hidden = true;
    render();
  }

  function updateBulkBar() {
    bulkCount.textContent = `${selectedKeys.size} selected`;
    bulkMoveBtn.disabled = selectedKeys.size === 0;
    bulkExportBtn.disabled = selectedKeys.size === 0;
    selectAllBtn.textContent = currentVisibleNotes.length > 0 && selectedKeys.size === currentVisibleNotes.length ? 'Deselect all' : 'Select all';
  }

  selectAllBtn.onclick = () => {
    if (selectedKeys.size === currentVisibleNotes.length) {
      selectedKeys.clear();
    } else {
      for (const n of currentVisibleNotes) selectedKeys.add(n.key);
    }
    updateBulkBar();
    render();
  };

  bulkDoneBtn.onclick = () => exitSelectMode();

  bulkExportBtn.onclick = async () => {
    if (!selectedKeys.size) return;
    toast('Creating .zip…');
    try {
      const { makeZip } = await import('../lib/zip.js');
      const all = await entries();
      const selectedEntries = all.filter((e) => selectedKeys.has(e.item.key));
      const files = [];
      for (const e of selectedEntries) {
        const text = e.text || (await store.content.get(e.item.key))?.text || '';
        files.push({ path: e.item.path, text });
      }
      const blob = makeZip(files);
      const a = el('a', { href: URL.createObjectURL(blob), download: `readover-selected-${new Date().toISOString().slice(0, 10)}.zip` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Zip downloaded');
    } catch (err) {
      toast(`Export failed: ${err.message}`);
    }
  };

  bulkMoveBtn.onclick = async () => {
    if (!selectedKeys.size) return;
    const all = await entries();
    const selectedEntries = all.filter((e) => selectedKeys.has(e.item.key));
    const firstSrcId = selectedEntries[0]?.item.sourceId || view.sourceId || DEVICE_ID;
    await promptAndMoveNotes(Array.from(selectedKeys), firstSrcId);
  };

  manageBtn.onclick = () => openActionsMenu();

  async function openActionsMenu() {
    const src = view.sourceId ? store.getSource(view.sourceId) : null;
    const actions = [
      { id: 'select', label: 'Select notes (multi-select mode)' },
      { id: 'export-zip', label: src ? `Export ${view.folder ? `folder "${view.folder}"` : displayName(src)} as .zip` : 'Export all notes as .zip' },
    ];
    if (src) {
      actions.push({ id: 'move-storage', label: `Move ${view.folder ? `folder "${view.folder}"` : displayName(src)} to another storage…` });
    }
    const chosen = await menu('Library & File Actions', actions);
    if (chosen === 'select') {
      startSelectMode();
    } else if (chosen === 'export-zip') {
      await exportCurrentScopeZip();
    } else if (chosen === 'move-storage') {
      await moveCurrentScope();
    }
  }

  async function exportCurrentScopeZip() {
    toast('Creating .zip…');
    try {
      let blob;
      let filename;
      if (view.sourceId) {
        blob = await sourceNotesZip(view.sourceId, view.folder);
        const src = store.getSource(view.sourceId);
        const scope = [displayName(src), view.folder].filter(Boolean).join('-').replace(/[\\/:*?"<>|]+/g, '_');
        filename = `readover-${scope}-${new Date().toISOString().slice(0, 10)}.zip`;
      } else {
        const { makeZip } = await import('../lib/zip.js');
        const all = await entries();
        const files = [];
        for (const e of all) {
          const text = e.text || (await store.content.get(e.item.key))?.text || '';
          files.push({ path: e.item.path, text });
        }
        blob = makeZip(files);
        filename = `readover-all-notes-${new Date().toISOString().slice(0, 10)}.zip`;
      }
      const a = el('a', { href: URL.createObjectURL(blob), download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Zip downloaded');
    } catch (err) {
      toast(`Export failed: ${err.message}`);
    }
  }

  async function moveCurrentScope() {
    const all = await entries();
    const prefix = view.folder ? `${view.folder}/` : '';
    const scopeNotes = all.filter((e) => e.item.sourceId === view.sourceId && (!view.folder || e.item.folder === view.folder || e.item.folder.startsWith(prefix)));
    if (!scopeNotes.length) {
      toast('No notes in this view to move');
      return;
    }
    await promptAndMoveNotes(scopeNotes.map((e) => e.item.key), view.sourceId);
  }

  async function promptAndMoveNotes(keysToMove, fromSourceId) {
    const writable = store.getSources().filter((s) => canWrite(s) && s.id !== fromSourceId);
    if (fromSourceId !== DEVICE_ID && !writable.some((s) => s.id === DEVICE_ID)) {
      writable.push({ id: DEVICE_ID, type: 'device', name: 'This device' });
    }
    if (!writable.length) {
      toast('Connect another writable library (Dropbox, WebDAV, or GitHub) in Settings first.');
      return;
    }
    const destSelect = el(
      'select',
      { class: 'field-input' },
      ...writable.map((s) => el('option', { value: s.id }, `${displayName(s)} (${s.type})`))
    );
    const folderInput = el('input', { type: 'text', placeholder: 'Optional subfolder (e.g. notes)', autocomplete: 'off' });
    const { value } = await sheet({
      title: `Move ${keysToMove.length} ${keysToMove.length === 1 ? 'note' : 'notes'}`,
      fields: [
        el('p', { class: 'hint' }, `Transfer selected notes to another storage provider. Content and reciprocal links will be preserved.`),
        el('label', { class: 'field' }, 'Destination Library', destSelect),
        el('label', { class: 'field' }, 'Destination Folder', folderInput),
      ],
      submit: 'Move notes',
    });
    if (value !== 'ok') return;
    const targetId = destSelect.value;
    const targetFolder = folderInput.value.trim();
    toast('Moving notes…');
    try {
      const count = await moveNotesBetweenSources(fromSourceId, targetId, {
        noteKeys: keysToMove,
        targetFolder,
        onProgress: (m) => toast(m),
      });
      toast(`Moved ${count} ${count === 1 ? 'note' : 'notes'}`);
      exitSelectMode();
      render();
    } catch (err) {
      toast(`Move failed: ${err.message}`);
    }
  }

  // Sort and filter (remembered on this device, separately from the feed's).
  const sortSel = el('select', { class: 'notes-sort', 'aria-label': 'Sort' }, ...SORTS.map((o) => el('option', { value: o.id }, o.label)));
  const filterBtn = el('button', { type: 'button', class: 'btn btn-quiet notes-filter', 'aria-label': 'Filter notes' }, 'Filter');
  const tools = el('div', { class: 'notes-tools' }, el('label', { class: 'notes-sort-label' }, 'Sort ', sortSel), filterBtn);
  root.replaceChildren(
    el(
      'div',
      { class: 'notes-inner' },
      el('div', { class: 'notes-top' }, searchInput, tools, coverageLine),
      el('div', { class: 'notes-bar' }, crumbs, el('div', { class: 'notes-bar-actions' }, newBtn, manageBtn)),
      bulkBar,
      list
    )
  );
  sortSel.onchange = () => {
    store.setPrefs({ notesSort: sortSel.value });
    render();
  };
  filterBtn.onclick = () => openFilters();
  const showFilterLabel = () => {
    const label = filterLabel(prefs().notesGrowth, types());
    filterBtn.textContent = label ? `Filter: ${label}` : 'Filter';
    filterBtn.setAttribute('aria-label', label ? `Filter notes: ${label}` : 'Filter notes');
    filterBtn.classList.toggle('active', Boolean(label));
  };
  showFilterLabel();

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
    const isSelected = selectedKeys.has(item.key);

    if (selectMode) {
      const check = el('input', { type: 'checkbox', class: 'note-select-check', checked: isSelected, 'aria-label': `Select ${title}` });
      const contentCol = el(
        'div',
        { class: 'note-content-col' },
        el('b', {}, title),
        sub ? el('span', {}, sub) : null,
        tag || meta ? el('small', { class: 'row-meta' }, tag, tag && meta ? ' · ' : '', meta) : null
      );
      const b = el(
        'button',
        { class: `note-row selecting${isSelected ? ' is-selected' : ''}`, 'data-key': item.key, type: 'button' },
        check,
        contentCol
      );
      b.onclick = (e) => {
        e.preventDefault();
        if (selectedKeys.has(item.key)) selectedKeys.delete(item.key);
        else selectedKeys.add(item.key);
        updateBulkBar();
        check.checked = selectedKeys.has(item.key);
        b.classList.toggle('is-selected', check.checked);
      };
      return b;
    }

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
      manageBtn.hidden = true;
      const results = await search(view.query);
      currentVisibleNotes = results.map((r) => r.item);
      list.replaceChildren(
        ...(results.length
          ? results.map((r) => row(r.item, r.title, r.snippet || [displayName(store.getSource(r.item.sourceId)), r.item.folder].filter(Boolean).join(' / '), growth.get(r.item.key)))
          : [el('p', { class: 'notes-empty' }, `Nothing matches “${view.query}”.`)])
      );
      updateBulkBar();
      return;
    }

    // Choose a library first when there's more than one
    if (!view.sourceId && sources.length === 1) view.sourceId = sources[0].id;
    if (selectMode) {
      newBtn.hidden = true;
      manageBtn.hidden = true;
    } else {
      newBtn.hidden = !(view.sourceId ? canWrite(store.getSource(view.sourceId)) : true);
      manageBtn.hidden = false;
    }

    // Sorted or filtered across all libraries.
    const flat = (prefs().notesSort || 'folders') !== 'folders' || isFiltered(prefs().notesGrowth || 'any', types());
    if (!view.sourceId && flat) {
      crumbs.replaceChildren(el('span', {}, 'All notes'));
      renderFlat(all, growth, prefs().notesSort || 'folders', prefs().notesGrowth || 'any', types(), titles);
      return;
    }
    if (!view.sourceId) {
      currentVisibleNotes = [];
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
      updateBulkBar();
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
    currentVisibleNotes = notes.map((e) => e.item);
    list.replaceChildren(
      ...[...sub.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => folderRow(name, n, () => ((view.folder = prefix + name), render()))),
      ...notes.sort((a, b) => a.title.localeCompare(b.title)).map((e) => row(e.item, titles.get(e.item.key), e.hasText ? firstLine(e.text) : '', growth.get(e.item.key)))
    );
    if (!list.children.length) list.append(el('p', { class: 'notes-empty' }, 'Nothing here yet.'));
    updateBulkBar();
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
    const visibleRows = rows.slice(0, 500);
    currentVisibleNotes = visibleRows.map((e) => e.item);
    list.replaceChildren(
      el('p', { class: 'hint notes-count' }, `${rows.length} ${rows.length === 1 ? 'note' : 'notes'}`),
      ...visibleRows.map((e) => row(e.item, titles.get(e.item.key), e.hasText ? firstLine(e.text) : '', growth.get(e.item.key), [shortDate(when.get(e.item.key)), where(e)].filter(Boolean).join(' · ')))
    );
    if (rows.length > 500) list.append(el('p', { class: 'hint' }, `Showing the first 500. Narrow it with a folder or filter.`));
    if (!rows.length) list.append(el('p', { class: 'notes-empty' }, isFiltered(gId, tId) ? 'No notes match these filters here.' : 'Nothing here yet.'));
    updateBulkBar();
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
