// Settings sheet: libraries, token, appearance, storage.
import * as store from '../store.js';
import { displayName, deviceNotesZip, canWrite as canWriteSrc } from '../library.js';
import * as github from '../sources/github.js';
import * as local from '../sources/local.js';
import { openSheet, el, toast } from './overlay.js';
import * as dataSync from '../sync.js';
import * as outbox from '../outbox.js';
import * as learn from '../learn.js';

const $ = (id) => document.getElementById(id);

export function lastSyncText(id) {
  const t = Number(localStorage.getItem(`readover.lastSync.${id}`));
  if (!t) return 'Not synced yet';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `Synced ${hrs} h ago`;
  return `Synced ${Math.round(hrs / 24)} days ago`;
}

/** @param app { syncSource(src), addFolder(), reimport(src), sourcesChanged(), applyTheme() } */
export function initSettings(app) {
  const sheet = $('settings-sheet');
  const form = $('repo-form');
  const tokenInput = $('token-input');

  async function renderSources() {
    const list = $('source-list');
    const sources = store.getSources();
    const counts = new Map();
    for (const it of await store.items.all()) counts.set(it.sourceId, (counts.get(it.sourceId) || 0) + 1);

    if (!sources.length) {
      list.replaceChildren(el('p', { class: 'empty-sources' }, 'Nothing connected yet. Add a GitHub repo of notes, or open a folder on this device. You can also just start writing: notes are kept in this browser until you connect somewhere.'));
      return;
    }
    const rows = await Promise.all(
      sources.map(async (src) => {
        const n = counts.get(src.id) || 0;
        if (src.type === 'device') return deviceRow(src, n);
        const bits = [];
        if (src.type === 'github') {
          bits.push(`${src.owner}/${src.repo}${src.root ? `/${src.root}` : ''} on ${src.branch || 'main'}`);
        } else {
          bits.push(src.mode === 'handle' ? 'Folder on this device' : 'Imported copy of a folder');
        }
        bits.push(`${n} ${n === 1 ? 'item' : 'items'}`);
        bits.push(lastSyncText(src.id));
        const detail = el('div', { class: 'source-detail' }, bits.join(', '));
        if (src.type === 'github' && !github.canWrite(src)) {
          detail.append(el('br'), 'Read only. Add a token to edit notes or keep Readover data here.');
        }
        if (src.type === 'local' && src.mode === 'handle') {
          const perm = await local.permissionState(src).catch(() => 'missing');
          if (perm !== 'granted') detail.append(el('br'), el('span', { class: 'warn' }, 'Needs your permission to read again.'));
        }
        const actions = el('div', { class: 'source-actions' });
        const add = (label, fn, cls) => {
          const b = el('button', { class: cls }, label);
          b.onclick = fn;
          actions.append(b);
        };
        if (src.type === 'local' && src.mode === 'import') add('Re-import', () => app.reimport(src));
        else add('Refresh', () => app.syncSource(src, { userGesture: true }).then(renderSources));
        if (src.type === 'github') add('Edit', () => showForm(src));
        add('Remove', async () => {
          if (!confirm(`Remove "${displayName(src)}" from Readover? Your files are not touched; favourites synced to the repo are kept there.`)) return;
          await store.removeSource(src.id);
          app.sourcesChanged();
          renderSources();
        }, 'remove');
        return el('div', { class: 'source' }, el('div', { class: 'source-name' }, displayName(src)), detail, actions);
      })
    );
    list.replaceChildren(...rows);
  }

  /** Notes written before connecting anything. */
  function deviceRow(src, n) {
    const detail = el('div', { class: 'source-detail' }, `${n} ${n === 1 ? 'note' : 'notes'}, kept only in this browser.`);
    const actions = el('div', { class: 'source-actions' });
    const move = el('button', {}, 'Move to GitHub');
    move.onclick = () => app.openSetup();
    const download = el('button', {}, 'Download');
    download.onclick = async () => {
      const blob = await deviceNotesZip();
      const a = el('a', { href: URL.createObjectURL(blob), download: `readover-notes-${new Date().toISOString().slice(0, 10)}.zip` });
      document.body.append(a);
      a.click();
      a.remove();
    };
    const del = el('button', { class: 'remove' }, 'Delete');
    del.onclick = async () => {
      if (!confirm(`Delete ${n} ${n === 1 ? 'note' : 'notes'} stored only in this browser? This can't be undone. Download them first if you want to keep them.`)) return;
      await store.removeSource(src.id);
      app.sourcesChanged();
      renderSources();
    };
    if (n) actions.append(move, download);
    actions.append(del);
    return el('div', { class: 'source' }, el('div', { class: 'source-name' }, 'On this device'), detail, actions);
  }

  function showForm(src = null) {
    form.hidden = false;
    form.reset();
    $('repo-form-title').textContent = src ? `Edit ${displayName(src)}` : 'Add a GitHub repo';
    form.elements.id.value = src?.id || '';
    if (src) {
      form.elements.repo.value = `${src.owner}/${src.repo}`;
      form.elements.branch.value = src.branch || '';
      form.elements.root.value = src.root || '';
      form.elements.ignore.value = src.ignore || '';
      form.elements.name.value = src.name || '';
      form.elements.token.value = src.token || '';
    }
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.elements.repo.focus();
  }

  form.querySelector('[data-cancel]').onclick = () => (form.hidden = true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const parsed = github.parseRepoInput(f.repo.value);
    if (!parsed) {
      toast('Enter the repo as owner/repo, or paste its GitHub link.');
      return;
    }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    const existing = f.id.value ? store.getSource(f.id.value) : null;
    const src = {
      ...(existing || {}),
      id: existing?.id || store.newId('gh'),
      type: 'github',
      owner: parsed.owner,
      repo: parsed.repo,
      branch: f.branch.value.trim() || parsed.branch,
      root: (f.root.value.trim() || parsed.root).replace(/^\/|\/$/g, ''),
      ignore: f.ignore.value.trim(),
      token: f.token.value.trim(),
      name: f.name.value.trim(),
    };
    try {
      if (!src.branch) src.branch = (await github.repoInfo(src)).defaultBranch;
      if (!src.name) src.name = src.root ? `${src.repo}/${src.root.split('/').pop()}` : src.repo;
      store.saveSource(src);
      form.hidden = true;
      app.sourcesChanged();
      await app.syncSource(src, { userGesture: true });
      if (dataSync.ensureDataHome()) dataSync.syncNow();
      renderSources();
      renderSync();
    } catch (err) {
      toast(err.message);
    } finally {
      submit.disabled = false;
    }
  };

  $('add-repo-btn').onclick = () => showForm();
  $('add-folder-btn').onclick = () => app.addFolder().then(renderSources);
  $('folder-input').onchange = (e) => app.importFiles(e.target.files).then(renderSources);

  tokenInput.onchange = () => {
    store.setToken(tokenInput.value);
    toast(tokenInput.value.trim() ? 'Token saved on this device' : 'Token removed');
    if (dataSync.ensureDataHome()) dataSync.syncNow();
    renderSources();
    renderSync();
  };

  /* ---- Sync between devices ---- */

  async function renderSync() {
    const select = $('data-home-select');
    const writable = store.getSources().filter((s) => s.type === 'github' && github.canWrite(s));
    const home = dataSync.dataHome();
    select.replaceChildren(
      el('option', { value: '' }, 'This device only'),
      ...writable.map((s) => el('option', { value: s.id }, displayName(s)))
    );
    select.value = home?.id || '';
    select.disabled = !writable.length;

    const info = $('sync-info');
    const last = dataSync.lastSync();
    if (!writable.length) info.textContent = 'Add a GitHub repo and a token to sync between devices. Until then, everything stays on this device.';
    else if (!home) info.textContent = 'Not syncing. Favourites, progress and preferences stay on this device.';
    else if (!last.at) info.textContent = `Kept in .readover/ in ${home.owner}/${home.repo}.`;
    else if (last.ok) info.textContent = `Kept in .readover/ in ${home.owner}/${home.repo}. Last synced ${new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    else info.textContent = `Couldn't sync: ${last.message}`;
    $('sync-now-btn').hidden = !home;

    const entries = await outbox.list();
    $('outbox-list').replaceChildren(
      ...entries.map((e) => {
        const name = e.path.split('/').pop();
        const discard = el('button', {}, 'Discard');
        discard.onclick = async () => {
          if (!confirm(`Discard your unsaved change to "${name}"? This can't be undone.`)) return;
          await outbox.discard(e.id);
          renderSync();
        };
        const retry = el('button', {}, 'Try again');
        retry.onclick = () => outbox.process({ retryErrors: true }).then(renderSync);
        return el(
          'div',
          { class: 'outbox-item' },
          el('p', {}, el('b', {}, name), ' ', e.error ? el('span', { class: 'err' }, `couldn't be saved: ${e.error}`) : 'is waiting to be saved to GitHub.'),
          e.error ? retry : null,
          e.error ? discard : null
        );
      })
    );
  }

  $('data-home-select').onchange = (e) => {
    dataSync.chooseDataHome(e.target.value);
    if (e.target.value) {
      toast('Syncing…');
      dataSync.syncNow().then((r) => {
        toast(r.ok ? 'Synced' : `Couldn't sync: ${r.message}`);
        renderSync();
      });
    }
    renderSync();
  };
  $('sync-now-btn').onclick = async () => {
    const btn = $('sync-now-btn');
    btn.disabled = true;
    const r = await dataSync.syncNow();
    await outbox.process({ retryErrors: true });
    btn.disabled = false;
    toast(r.ok ? 'Synced' : `Couldn't sync: ${r.message}`);
    renderSync();
  };
  window.addEventListener('readover:sync', () => sheet.open && renderSync());
  window.addEventListener('readover:outbox', () => sheet.open && renderSync());

  $('theme-select').onchange = (e) => {
    store.setPrefs({ theme: e.target.value });
    app.applyTheme();
  };
  $('mix-select').onchange = (e) => store.setPrefs({ highlightMix: Number(e.target.value) });
  $('hl-home-select').onchange = (e) => store.setPrefs({ highlightHome: e.target.value });
  $('break-select').onchange = (e) => store.setPrefs({ breakAfter: Number(e.target.value) });

  function renderLearning() {
    $('learn-toggle').checked = learn.enabled();
    const { more, less } = learn.describe();
    const box = $('learn-summary');
    if (!learn.enabled()) {
      box.replaceChildren(el('p', { class: 'hint' }, 'Off: the feed is a plain weighted shuffle.'));
      return;
    }
    if (!more.length && !less.length) {
      box.replaceChildren(el('p', { class: 'hint' }, "Nothing yet. It needs a few days of reading before it changes anything."));
      return;
    }
    const list = (label, rows) =>
      rows.length ? el('div', {}, el('p', { class: 'learn-label' }, label), el('ul', {}, ...rows.map((r) => el('li', {}, r.label)))) : null;
    box.replaceChildren(...[list('Showing a little more of', more), list('Showing a little less of', less)].filter(Boolean));
  }
  $('learn-toggle').onchange = (e) => {
    store.setPrefs({ learn: e.target.checked });
    renderLearning();
  };
  $('learn-reset').onclick = () => {
    if (!confirm('Forget everything the feed has learned on this device?')) return;
    learn.reset();
    renderLearning();
    toast('The feed starts fresh');
  };

  function renderHighlightHome() {
    const sel = $('hl-home-select');
    const writable = store.getSources().filter((s) => s.type !== 'device' && canWriteSrc(s));
    const home = dataSync.dataHome();
    sel.replaceChildren(
      el('option', { value: '' }, home ? `Same repo as your synced data (${home.repo})` : writable.length ? `${displayName(writable[0])}` : 'This device'),
      ...writable.filter((s) => s.id !== home?.id).map((s) => el('option', { value: s.id }, displayName(s)))
    );
    sel.value = writable.some((s) => s.id === store.getPrefs().highlightHome) ? store.getPrefs().highlightHome : '';
  }

  $('clear-books-btn').onclick = async () => {
    const githubIds = new Set(store.getSources().filter((s) => s.type === 'github').map((s) => s.id));
    const all = await store.blobs.all();
    await store.blobs.bulkDelete(all.filter((b) => githubIds.has(b.sourceId)).map((b) => b.key));
    toast('Downloaded books removed. They download again when opened.');
    showStorage();
  };
  $('reset-seen-btn').onclick = async () => {
    if (!confirm('Forget which items you have seen? Favourites and hidden items are kept.')) return;
    const rows = await store.state.all();
    await store.state.bulkPut(rows.map((r) => ({ ...r, lastSeen: 0, seen: 0 })));
    toast('Reading history cleared');
  };

  async function showStorage() {
    const info = $('storage-info');
    if (!navigator.storage?.estimate) {
      info.textContent = 'Storage details are not available in this browser.';
      return;
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) || false;
    const mb = (b) => (b / 1048576 < 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`);
    info.textContent = `Using ${mb(usage)} of ${mb(quota)} available. ${
      persisted ? 'The browser will keep this data.' : 'The browser may clear this data if space runs low.'
    }`;
  }

  return {
    async open() {
      const prefs = store.getPrefs();
      tokenInput.value = store.getToken();
      $('theme-select').value = prefs.theme;
      $('mix-select').value = String(prefs.highlightMix >= 0.7 ? 0.8 : prefs.highlightMix > 0 ? 0.5 : 0);
      form.hidden = true;
      renderSources();
      renderSync();
      renderHighlightHome();
      renderLearning();
      $('break-select').value = String(prefs.breakAfter || 0);
      showStorage();
      const done = openSheet(sheet);
      if (!store.getSources().length) showForm();
      await done;
    },
    refresh: renderSources,
  };
}
