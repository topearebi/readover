// Notes: the place to work on notes, separate from reading. Browse by library and
// folder, search everything, open a note to edit it, link it, move it or delete it.
import * as store from '../store.js';
import { displayName, canWrite } from '../library.js';
import { entries, search, coverage, downloadAll } from '../notes-index.js';
import { dataHome } from '../sync.js';
import { el, icon, toast } from './overlay.js';

/** @param app { openItem(item), compose({ sourceId, folder }) } */
export function initNotes(app) {
  const root = document.getElementById('notes');
  const view = { sourceId: null, folder: '', query: '' };
  let searchTimer;

  const searchInput = el('input', { type: 'search', class: 'notes-search', placeholder: 'Search your notes', 'aria-label': 'Search your notes', autocomplete: 'off' });
  const coverageLine = el('p', { class: 'hint notes-coverage', hidden: true });
  const crumbs = el('nav', { class: 'notes-crumbs', 'aria-label': 'Folder' });
  const newBtn = el('button', { class: 'btn' }, icon('pen', 'i i-sm'), 'New note here');
  const list = el('div', { class: 'notes-list' });
  root.replaceChildren(el('div', { class: 'notes-inner' }, el('div', { class: 'notes-top' }, searchInput, coverageLine), el('div', { class: 'notes-bar' }, crumbs, newBtn), list));

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.query = searchInput.value.trim();
      render();
    }, 150);
  });
  newBtn.onclick = () => app.compose({ sourceId: view.sourceId, folder: view.folder });


  function row(item, title, sub) {
    const b = el('button', { class: 'note-row' }, el('b', {}, title), sub ? el('span', {}, sub) : null);
    b.onclick = () => app.openItem(item);
    return b;
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
    const all = await entries();
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
          ? results.map((r) => row(r.item, r.title, r.snippet || [displayName(store.getSource(r.item.sourceId)), r.item.folder].filter(Boolean).join(' / ')))
          : [el('p', { class: 'notes-empty' }, `Nothing matches “${view.query}”.`)])
      );
      return;
    }

    // Choose a library first when there's more than one
    if (!view.sourceId && sources.length === 1) view.sourceId = sources[0].id;
    newBtn.hidden = !(view.sourceId ? canWrite(store.getSource(view.sourceId)) : true);
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
      ...notes.sort((a, b) => a.title.localeCompare(b.title)).map((e) => row(e.item, titles.get(e.item.key), e.hasText ? firstLine(e.text) : ''))
    );
    if (!list.children.length) list.append(el('p', { class: 'notes-empty' }, 'Nothing here yet.'));
  }

  const firstLine = (text) =>
    text
      .replace(/^#.*$/m, '')
      .replace(/<!--[\s\S]*?-->/g, '')
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
