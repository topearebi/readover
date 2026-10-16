// Settings sheet: 4-Tab Workstation (Sources & Sync, Garden, Reading & Export, App & Device).
import * as store from '../store.js';
import { displayName, deviceNotesZip, canWrite as canWriteSrc } from '../library.js';
import * as github from '../sources/github.js';
import * as local from '../sources/local.js';
import * as dropbox from '../sources/dropbox.js';
import * as webdav from '../sources/webdav.js';
import * as s3 from '../sources/s3.js';
import { openSheet, el, toast } from './overlay.js';
import * as dataSync from '../sync.js';
import * as outbox from '../outbox.js';
import * as learn from '../learn.js';
import { newNotesHome, highlightsFolder } from '../insights.js';
import { libraryTypes } from './types.js';
import { bookmarkletCode } from '../clip.js';
import { TOKEN_URL } from './setup.js';

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

  /* ---- Tab Navigation ---- */
  const tabButtons = sheet.querySelectorAll('.settings-tab');
  const tabPanels = sheet.querySelectorAll('.settings-tab-panel');

  tabButtons.forEach((btn) => {
    btn.onclick = () => {
      const targetId = btn.dataset.tab;
      tabButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      tabPanels.forEach((p) => {
        const active = p.id === targetId;
        p.hidden = !active;
        p.classList.toggle('is-active', active);
      });
    };
  });

  /* ---- Render Sources ---- */
  async function renderSources() {
    const list = $('source-list');
    const sources = store.getSources();
    const counts = new Map();
    for (const it of await store.items.all()) counts.set(it.sourceId, (counts.get(it.sourceId) || 0) + 1);

    if (!sources.length) {
      list.replaceChildren(el('p', { class: 'empty-sources' }, 'Nothing yet. Connect a source below or start writing.'));
      return;
    }
    const rows = await Promise.all(
      sources.map(async (src) => {
        const n = counts.get(src.id) || 0;
        if (src.type === 'device') return deviceRow(src, n);
        const bits = [];
        if (src.type === 'github') {
          bits.push(`${src.owner}/${src.repo}${src.root ? `/${src.root}` : ''}${src.branch && src.branch !== 'main' ? ` (${src.branch})` : ''}`);
        } else if (src.type === 'dropbox') {
          bits.push('Dropbox (/Apps/Readover)');
          if (src.root) bits.push(src.root);
        } else if (src.type === 'webdav') {
          try {
            bits.push(`WebDAV (${new URL(src.url).hostname})`);
          } catch {
            bits.push('WebDAV');
          }
        } else if (src.type === 's3' || src.type === 'r2') {
          bits.push(`Bucket: ${src.bucket} (${src.type === 'r2' ? 'Cloudflare R2' : 'AWS S3'})`);
          bits.push('Object Vault');
        } else {
          bits.push(src.mode === 'handle' ? 'Local folder' : 'Imported folder');
        }
        bits.push(`${n} ${n === 1 ? 'item' : 'items'}`);
        bits.push(lastSyncText(src.id).replace(/^Synced /, ''));
        const detail = el('div', { class: 'source-detail' }, bits.join(' · '));

        if (src.type === 'github' && !github.canWrite(src)) detail.append(el('br'), 'Read-only (no token)');
        if (src.type === 'dropbox' && !dropbox.canWrite(src)) detail.append(el('br'), 'Read-only (no token)');
        if (src.type === 'webdav' && !webdav.canWrite(src)) detail.append(el('br'), 'Credentials missing');
        if ((src.type === 's3' || src.type === 'r2') && !s3.canWrite(src)) detail.append(el('br'), 'Keys missing');
        if (src.type === 'local' && src.mode === 'handle') {
          const perm = await local.permissionState(src).catch(() => 'missing');
          if (perm !== 'granted') detail.append(el('br'), el('span', { class: 'warn' }, 'Tap Refresh to allow access again'));
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
          if (!confirm(`Remove "${displayName(src)}" from Readover? Your remote files aren't touched.`)) return;
          await store.removeSource(src.id);
          app.sourcesChanged();
          renderSources();
          renderHighlightHome();
        }, 'remove');
        return el('div', { class: 'source' }, el('div', { class: 'source-name' }, displayName(src)), detail, actions);
      })
    );
    list.replaceChildren(...rows);
  }

  /** Notes written before connecting anything. */
  function deviceRow(src, n) {
    const detail = el('div', { class: 'source-detail' }, `${n} ${n === 1 ? 'note' : 'notes'} · only in this browser`);
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
      if (!confirm(`Delete ${n} ${n === 1 ? 'note' : 'notes'} kept only in this browser? This can't be undone.`)) return;
      await store.removeSource(src.id);
      app.sourcesChanged();
      renderSources();
      renderHighlightHome();
    };
    if (n) actions.append(move, download);
    actions.append(del);
    return el('div', { class: 'source' }, el('div', { class: 'source-name' }, 'On this device'), detail, actions);
  }

  /* ---- OPDS Catalogs in Settings ---- */
  function getCatalogsList() {
    if (typeof store.getOpdsCatalogs === 'function') {
      try {
        return store.getOpdsCatalogs();
      } catch {}
    }
    try {
      const raw = localStorage.getItem('readover.opdsCatalogs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      {
        id: 'opds-gutenberg',
        name: 'Project Gutenberg',
        url: 'https://m.gutenberg.org/ebooks.opds/',
        description: 'Over 70,000 free public domain ebooks',
        useProxy: false,
      },
      {
        id: 'opds-standard-ebooks',
        name: 'Standard Ebooks (Donor Login)',
        url: 'https://standardebooks.org/opds',
        description: 'Free public domain ebooks in high-quality EPUB format',
        useProxy: false,
      },
    ];
  }

  function renderOpdsCatalogs() {
    const list = $('settings-opds-list');
    if (!list) return;
    const cats = getCatalogsList();
    if (!cats.length) {
      list.replaceChildren(el('p', { class: 'empty-sources' }, 'No OPDS catalogs configured.'));
      return;
    }
    const rows = cats.map((cat) => {
      const bits = [cat.url];
      if (cat.useProxy) bits.push('CORS proxy');
      if (cat.username) bits.push(`User: ${cat.username}`);
      const detail = el('div', { class: 'source-detail' }, bits.join(' · '));
      const actions = el('div', { class: 'source-actions' });
      const browseBtn = el('button', {}, 'Browse');
      browseBtn.onclick = async () => {
        const { openOpdsBrowser } = await import('./opds.js');
        openOpdsBrowser(app);
      };
      actions.append(browseBtn);
      const delBtn = el('button', { class: 'remove' }, 'Remove');
      delBtn.onclick = () => {
        if (typeof store.deleteOpdsCatalog === 'function') {
          store.deleteOpdsCatalog(cat.id);
        } else {
          const filtered = getCatalogsList().filter((c) => c.id !== cat.id);
          localStorage.setItem('readover.opdsCatalogs', JSON.stringify(filtered));
        }
        renderOpdsCatalogs();
        toast(`Removed ${cat.name}`);
      };
      actions.append(delBtn);
      return el('div', { class: 'source' }, el('div', { class: 'source-name' }, cat.name), detail, actions);
    });
    list.replaceChildren(...rows);
  }

  const openOpdsBtn = $('open-opds-from-settings');
  if (openOpdsBtn) {
    openOpdsBtn.onclick = async () => {
      const { openOpdsBrowser } = await import('./opds.js');
      openOpdsBrowser(app);
    };
  }


  /* ---- GitHub Form ---- */
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
    form.querySelector('.more-options').open = Boolean(src && (src.root || src.ignore || src.token || (src.branch && src.branch !== 'main')));
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
      renderHighlightHome();
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
    renderToken();
    renderSources();
    renderSync();
    renderHighlightHome();
  };
  $('token-link').href = TOKEN_URL;

  let tokenCheck = 0;
  async function renderToken() {
    const box = $('token-status');
    const token = store.getToken();
    const mine = ++tokenCheck;
    if (!token) {
      box.replaceChildren('No token: public repos only, read-only.');
      return;
    }
    box.replaceChildren('Checking…');
    let text;
    try {
      const login = await github.whoami(token);
      text = login ? [el('span', { class: 'ok' }, `✓ Signed in as ${login}`)] : [el('span', { class: 'err' }, 'GitHub rejected this token. It may have expired.')];
    } catch {
      text = ['Saved. Will be checked when online.'];
    }
    if (mine === tokenCheck) box.replaceChildren(...text);
  }

  /* ---- Dropbox Integration ---- */
  $('dbx-auth-btn').onclick = async () => {
    const btn = $('dbx-auth-btn');
    btn.disabled = true;
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const clientId = '9c0wff8143gq9i0';
      const { url } = await dropbox.createPKCEAuthUrl(clientId, redirectUri);
      
      const authWindow = window.open(url, 'dropbox_oauth_popup', 'width=620,height=700');
      if (!authWindow) {
        toast('Popup blocked. Please allow popups to sign in with Dropbox.');
        btn.disabled = false;
        return;
      }

      const onMessage = async (e) => {
        if (e.data?.type === 'OAUTH_AUTH_CODE') {
          window.removeEventListener('message', onMessage);
          if (e.data.error) {
            toast(`Dropbox sign in canceled: ${e.data.error}`);
            btn.disabled = false;
            return;
          }
          if (e.data.code) {
            toast('Connecting Dropbox account…');
            try {
              const res = await dropbox.exchangePKCECode(e.data.code, clientId, redirectUri);
              const user = (await dropbox.whoami(res.token)) || 'Dropbox';
              const src = {
                id: store.newId('dbx'),
                type: 'dropbox',
                token: res.token,
                name: user ? `Dropbox (${user})` : 'Dropbox (/Apps/Readover)',
                root: '',
              };
              store.saveSource(src);
              $('accordion-dropbox').open = false;
              app.sourcesChanged();
              toast(`Connected ${src.name}! Syncing…`);
              await app.syncSource(src, { userGesture: true });
              renderSources();
              renderHighlightHome();
            } catch (err) {
              toast(err.message);
            } finally {
              btn.disabled = false;
            }
          }
        }
      };
      window.addEventListener('message', onMessage);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };

  $('dbx-save-token-btn').onclick = async () => {
    const token = $('dbx-token-input').value.trim();
    if (!token) {
      toast('Please enter a Dropbox access token.');
      return;
    }
    const name = $('dbx-name-input').value.trim() || 'Dropbox (/Apps/Readover)';
    const src = {
      id: store.newId('dbx'),
      type: 'dropbox',
      token,
      name,
      root: '',
    };
    store.saveSource(src);
    $('dbx-token-input').value = '';
    $('accordion-dropbox').open = false;
    app.sourcesChanged();
    toast(`Saved ${name}! Syncing…`);
    await app.syncSource(src, { userGesture: true });
    renderSources();
    renderHighlightHome();
  };

  /* ---- WebDAV Integration ---- */
  sheet.querySelectorAll('[data-dav-preset]').forEach((b) => {
    b.onclick = () => {
      const preset = b.dataset.davPreset;
      const f = $('webdav-form').elements;
      if (preset === 'nextcloud') {
        f.url.value = 'https://cloud.example.com/remote.php/dav/files/USER/Notes';
        f.name.value = 'Nextcloud Notes';
      } else if (preset === 'koofr') {
        f.url.value = 'https://app.koofr.net/dav/Koofr/Notes';
        f.name.value = 'Koofr Notes';
      } else {
        f.url.value = '';
        f.name.value = '';
      }
    };
  });

  $('webdav-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = $('webdav-form').elements;
    const url = f.url.value.trim();
    const username = f.username.value.trim();
    const password = f.password.value.trim();
    const name = f.name.value.trim() || (url ? `WebDAV (${new URL(url).hostname})` : 'WebDAV');

    const submit = $('webdav-save-btn');
    submit.disabled = true;
    const src = {
      id: store.newId('dav'),
      type: 'webdav',
      url,
      username,
      password,
      name,
    };

    try {
      toast('Testing WebDAV connection…');
      await webdav.testConnection(src);
      store.saveSource(src);
      $('webdav-form').reset();
      $('accordion-webdav').open = false;
      app.sourcesChanged();
      toast(`Connected ${name}! Syncing…`);
      await app.syncSource(src, { userGesture: true });
      renderSources();
      renderHighlightHome();
    } catch (err) {
      toast(err.message);
    } finally {
      submit.disabled = false;
    }
  };

  const davCancel = sheet.querySelector('[data-dav-cancel]');
  if (davCancel) {
    davCancel.onclick = () => {
      $('webdav-form').reset();
      $('accordion-webdav').open = false;
    };
  }

  /* ---- S3 / Cloudflare R2 Integration ---- */
  sheet.querySelectorAll('[data-s3-preset]').forEach((b) => {
    b.onclick = () => {
      const preset = b.dataset.s3Preset;
      const f = $('s3-form').elements;
      if (preset === 'r2') {
        f.endpoint.value = 'https://<account_id>.r2.cloudflarestorage.com';
        f.region.value = 'auto';
        f.name.value = 'Cloudflare R2 Books';
      } else if (preset === 's3') {
        f.endpoint.value = 'https://s3.us-east-1.amazonaws.com';
        f.region.value = 'us-east-1';
        f.name.value = 'AWS S3 Books';
      }
    };
  });

  $('s3-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = $('s3-form').elements;
    const endpoint = f.endpoint.value.trim();
    const bucket = f.bucket.value.trim();
    const region = f.region.value.trim() || 'auto';
    const accessKeyId = f.accessKeyId.value.trim();
    const secretAccessKey = f.secretAccessKey.value.trim();
    const isR2 = endpoint.includes('r2.cloudflarestorage.com');
    const name = f.name.value.trim() || `${bucket} (${isR2 ? 'R2' : 'S3'})`;

    const submit = $('s3-save-btn');
    submit.disabled = true;
    const src = {
      id: store.newId('s3'),
      type: isR2 ? 'r2' : 's3',
      endpoint,
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      name,
    };

    try {
      toast('Testing S3/R2 bucket access…');
      await s3.testConnection(src);
      store.saveSource(src);
      $('s3-form').reset();
      $('accordion-s3').open = false;
      app.sourcesChanged();
      toast(`Connected ${name}! Scanning…`);
      await app.syncSource(src, { userGesture: true });
      renderSources();
      renderHighlightHome();
    } catch (err) {
      toast(err.message);
    } finally {
      submit.disabled = false;
    }
  };

  const s3Cancel = sheet.querySelector('[data-s3-cancel]');
  if (s3Cancel) {
    s3Cancel.onclick = () => {
      $('s3-form').reset();
      $('accordion-s3').open = false;
    };
  }

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
    if (!writable.length) info.textContent = 'Needs a GitHub repo and token for sync.';
    else if (!home) info.textContent = 'Not syncing.';
    else if (!last.at) info.textContent = `In ${home.repo}/.readover`;
    else if (last.ok) info.textContent = `In ${home.repo}/.readover · synced ${new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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
          el('p', {}, el('b', {}, name), ' ', e.error ? el('span', { class: 'err' }, `not saved: ${e.error}`) : 'waiting to save'),
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

  /* ---- Garden Tab: Note destinations ---- */
  function renderHighlightHome() {
    const sel = $('hl-home-select');
    const writable = store.getSources().filter((s) => s.type !== 'device' && canWriteSrc(s));
    const home = newNotesHome();
    sel.replaceChildren(
      ...writable.map((s) => el('option', { value: s.id }, displayName(s))),
      el('option', { value: 'device' }, 'This device')
    );
    sel.value = home.id;
    $('hl-folder-input').value = highlightsFolder();
    store.items
      .all()
      .then((all) => $('hl-folder-list').replaceChildren(...libraryTypes(all, home).map((t) => el('option', { value: t }))))
      .catch(() => {});
  }
  $('hl-home-select').onchange = (e) => store.setPrefs({ newNotesHome: e.target.value });
  $('hl-folder-input').onchange = (e) => store.setPrefs({ highlightsFolder: e.target.value.trim().replace(/^\/+|\/+$/g, '') });

  /* ---- Reading Tab: Appearance & Habits ---- */
  $('theme-select').onchange = (e) => {
    store.setPrefs({ theme: e.target.value });
    app.applyTheme();
  };
  $('mix-select').onchange = (e) => store.setPrefs({ highlightMix: Number(e.target.value) });
  $('break-select').onchange = (e) => store.setPrefs({ breakAfter: Number(e.target.value) });

  /* ---- Reading Tab: Export Suite ---- */
  $('export-share-test-btn').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Readover Note Export',
          text: 'Shared from Readover — intentional reading and digital gardening.',
          url: window.location.href,
        });
      } catch (err) {
        if (err.name !== 'AbortError') toast(err.message);
      }
    } else {
      await navigator.clipboard.writeText('Readover Note Export: intentional reading and digital gardening.');
      toast('Native OS share not supported in this desktop browser. Sample copied to clipboard.');
    }
  };

  $('export-copy-test-btn').onclick = async () => {
    const md = '# Note Sample for Publishing\n\n> "Knowledge is a garden, not a warehouse."\n\nFormatted dual-format payload ready for Substack or Medium.';
    const html = '<h1>Note Sample for Publishing</h1><blockquote><p>“Knowledge is a garden, not a warehouse.”</p></blockquote><p>Formatted dual-format payload ready for Substack or Medium.</p>';
    try {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([md], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      });
      await navigator.clipboard.write([item]);
      toast('Copied sample rich text + Markdown to clipboard!');
    } catch {
      await navigator.clipboard.writeText(md);
      toast('Copied Markdown note to clipboard!');
    }
  };

  $('export-print-btn').onclick = () => {
    window.print();
  };

  /* ---- App & Device Tab ---- */
  function renderLearning() {
    $('learn-toggle').checked = learn.enabled();
    const { more, less } = learn.describe();
    const box = $('learn-summary');
    if (!learn.enabled()) {
      box.replaceChildren(el('p', { class: 'hint' }, 'Off: a plain shuffle.'));
      return;
    }
    if (!more.length && !less.length) {
      box.replaceChildren(el('p', { class: 'hint' }, 'Nothing learned yet. On this device only.'));
      return;
    }
    const list = (label, rows) =>
      rows.length ? el('div', {}, el('p', { class: 'learn-label' }, label), el('ul', {}, ...rows.map((r) => el('li', {}, r.label)))) : null;
    box.replaceChildren(...[list('More of', more), list('Less of', less)].filter(Boolean));
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

  $('clear-books-btn').onclick = async () => {
    const all = await store.blobs.all();
    await store.blobs.bulkDelete(all.map((b) => b.key));
    toast('Removed. Books and attachments re-download when opened.');
    showStorage();
  };
  $('reset-seen-btn').onclick = async () => {
    if (!confirm('Forget what you have seen? Favourites and hidden items stay.')) return;
    const rows = await store.state.all();
    await store.state.bulkPut(rows.map((r) => ({ ...r, lastSeen: 0, seen: 0 })));
    toast('Reading history cleared');
  };

  async function showStorage() {
    const info = $('storage-info');
    if (!navigator.storage?.estimate) {
      info.textContent = '';
      return;
    }
    const { usage = 0 } = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) || false;
    const mb = (b) => (b / 1048576 < 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`);
    info.textContent = `${mb(usage)} used${persisted ? ' · Persisted storage active' : ' · Tap to request persistent storage'}`;
    if (!persisted) {
      info.style.cursor = 'pointer';
      info.onclick = async () => {
        const granted = await navigator.storage.persist?.();
        toast(granted ? 'Storage persistence granted' : 'Browser declined persistence');
        showStorage();
      };
    }
  }

  const runDiagBtn = $('run-diagnostics-btn');
  if (runDiagBtn) {
    runDiagBtn.onclick = async () => {
      const { openDiagnostics } = await import('./diagnostics.js');
      openDiagnostics(app);
    };
  }

  /* ---- Clip from anywhere ---- */
  const clipLink = $('clip-bookmarklet');
  clipLink.href = bookmarkletCode();
  clipLink.onclick = (e) => {
    e.preventDefault();
    toast('Drag it to your bookmarks bar, then use it on a page');
  };
  $('clip-shortcut-url').textContent = `${new URL('./', location.href).href}#clip?text=…&url=…`;

  return {
    async open() {
      const prefs = store.getPrefs();
      tokenInput.value = store.getToken();
      renderToken();
      $('theme-select').value = prefs.theme;
      $('mix-select').value = String(prefs.highlightMix >= 0.7 ? 0.8 : prefs.highlightMix > 0 ? 0.5 : 0);
      form.hidden = true;
      renderSources();
      renderOpdsCatalogs();
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
