// Data home sync: favourites, hidden items, reading progress, feed history,
// preferences and your list of libraries, kept in .readover/ in one repo you choose.
//
// Merging is per entry: every entry carries a timestamp and the newer one wins,
// so two devices that changed different things (or the same thing at different
// times) combine cleanly. Changes go up as ONE commit per sync, on top of the
// exact commit that was read; if someone else pushed in between, the sync
// re-reads and merges again instead of overwriting.
import * as store from './store.js';
import * as github from './sources/github.js';
import { gitBlobSha } from './lib/gitsha.js';

const DIR = '.readover';
const FILES = { state: 'state.json', seen: 'seen.json', progress: 'progress.json', prefs: 'prefs.json' };
const SHA_CACHE = 'readover.sync.remote'; // last-read blob sha + text per file, to skip unchanged downloads

let running = null;
let lastResult = { ok: true, at: 0, message: '' };

export const lastSync = () => lastResult;

/** The GitHub source that holds .readover/, or null (this device only). */
export function dataHome() {
  const { dataHome: id } = store.getPrefs();
  const src = id ? store.getSource(id) : null;
  return src && src.type === 'github' && github.canWrite(src) ? src : null;
}

/** Pick a data home automatically the first time a writable repo is connected. */
export function ensureDataHome() {
  if (dataHome()) return dataHome();
  const candidate = store.getSources().find((s) => s.type === 'github' && github.canWrite(s));
  if (candidate && !localStorage.getItem('readover.dataHomeChosen')) {
    store.setPrefs({ dataHome: candidate.id });
    return candidate;
  }
  return null;
}

export function chooseDataHome(id) {
  localStorage.setItem('readover.dataHomeChosen', '1');
  store.setPrefs({ dataHome: id });
}

/**
 * Sync now. `includeSeen`: also send feed history if that's the only change
 * (it changes constantly, so it normally waits for leaving the app).
 */
export function syncNow({ includeSeen = true } = {}) {
  if (!running) {
    running = run(includeSeen).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(includeSeen) {
  const home = dataHome();
  if (!home) return { skipped: true };
  const started = Date.now();
  announce('syncing');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await attemptSync(home, includeSeen);
      if (result !== 'retry') {
        store.clearDirty(started, result.seenDeferred ? ['important'] : ['important', 'seen']);
        lastResult = { ok: true, at: Date.now(), message: '', ...result };
        return lastResult;
      }
    }
    throw new Error('Your data home kept changing while syncing. Will try again shortly.');
  } catch (err) {
    lastResult = { ok: false, at: Date.now(), message: err.message };
    if (!/offline|could not be reached/i.test(err.message)) console.warn('Sync failed:', err);
    return lastResult;
  } finally {
    announce();
  }
}

function announce(phase = '') {
  window.dispatchEvent(new CustomEvent('readover:sync', { detail: { phase, ...lastResult } }));
}

/* ---------------- One attempt ---------------- */

async function attemptSync(home, includeSeen) {
  const head = await github.headSha(home);
  const remoteRaw = head ? await readRemote(home, head) : {};
  const remote = {
    state: parse(remoteRaw.state, home),
    seen: parse(remoteRaw.seen),
    progress: parse(remoteRaw.progress),
    prefs: parse(remoteRaw.prefs),
  };

  const local = await snapshot();
  const merged = {
    state: mergeEntries(remote.state.items, local.state, (a, b) => (b.t > a.t ? b : a)),
    seen: mergeEntries(remote.seen.items, local.seen, (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])]),
    progress: mergeEntries(remote.progress.items, local.progress, mergeProgress),
    prefs: mergePrefs(remote.prefs, local.prefs),
  };

  const applied = await applyLocally(merged, local);

  const out = {
    state: serialize(merged.state),
    seen: serialize(merged.seen),
    progress: serialize(merged.progress),
    prefs: `${JSON.stringify({ version: 2, ...merged.prefs }, sortedReplacer, 2)}\n`,
  };
  const dirty = store.getDirty();
  const changes = {};
  let seenDeferred = false;
  for (const name of Object.keys(FILES)) {
    if (out[name] === remoteRaw[name]) continue;
    if (name === 'seen' && !includeSeen && !dirty.important && remoteRaw.seen) {
      seenDeferred = true; // history alone isn't worth a commit; it goes with the next one
      continue;
    }
    changes[`${DIR}/${FILES[name]}`] = out[name];
  }
  if (!Object.keys(changes).length) return { pushed: false, seenDeferred, ...applied };

  try {
    await github.commitFiles(home, head, changes, 'Readover: sync');
  } catch (err) {
    if (err.status === 422 || err.status === 409) return 'retry'; // branch moved: merge again
    throw err;
  }
  // Remember what we wrote so the next sync doesn't download it again.
  const cache = store.readJSON(SHA_CACHE, {});
  for (const name of Object.keys(FILES)) {
    const text = changes[`${DIR}/${FILES[name]}`];
    if (text) cache[name] = { sha: await gitBlobSha(text), text };
  }
  store.writeJSON(SHA_CACHE, cache);
  return { pushed: true, seenDeferred, ...applied };
}


async function readRemote(home, head) {
  const listing = await github.listDir(home, DIR, head);
  const cache = store.readJSON(SHA_CACHE, {});
  const out = {};
  for (const [name, file] of Object.entries(FILES)) {
    const entry = listing.find((e) => e.name === file);
    if (!entry) continue;
    if (cache[name]?.sha === entry.sha) out[name] = cache[name].text;
    else {
      out[name] = await github.readBlobText(home, entry.sha);
      cache[name] = { sha: entry.sha, text: out[name] };
    }
  }
  store.writeJSON(SHA_CACHE, cache);
  return out;
}

function parse(text, home) {
  if (!text) return { items: {} };
  try {
    const data = JSON.parse(text);
    if (data.version === 1 && home) return { items: fromV1(data, home) }; // v3 preview format
    return data.items ? data : { ...data, items: data.items || {} };
  } catch {
    return { items: {} };
  }
}

/** v3 preview stored favourites per repo as { starred: { path: iso }, hidden: {...} }. */
function fromV1(data, home) {
  const items = {};
  const sk = store.sourceKey(home);
  for (const flag of ['starred', 'hidden']) {
    for (const [path, iso] of Object.entries(data[flag] || {})) {
      const k = `${sk}|${path}`;
      const at = Date.parse(iso) || 1;
      items[k] = items[k] || { s: 0, h: 0, t: 0 };
      items[k][flag === 'starred' ? 's' : 'h'] = at;
      items[k].t = Math.max(items[k].t, at);
    }
  }
  return items;
}

/* ---------------- Local snapshot ---------------- */

async function snapshot() {
  const sources = store.getSources();
  // Notes kept only on this device aren't on GitHub, so their state stays here too.
  const keyById = new Map(sources.filter((s) => s.type !== 'device').map((s) => [s.id, store.sourceKey(s)]));
  const toKey = (row) => {
    const sk = keyById.get(row.sourceId);
    return sk ? `${sk}|${row.path ?? row.key.slice(row.key.indexOf('|') + 1)}` : null;
  };

  const state = {};
  const seen = {};
  for (const row of await store.state.all()) {
    const k = toKey(row);
    if (!k) continue;
    if (row.flagsAt) state[k] = { s: row.starred || 0, h: row.hidden || 0, t: row.flagsAt };
    if (row.lastSeen) seen[k] = [row.lastSeen, row.seen || 0];
  }
  const progress = {};
  for (const row of await store.progress.all()) {
    const k = toKey(row);
    if (!k || !row.updatedAt) continue;
    progress[k] = { pct: round(row.pct), loc: row.loc || '', t: row.updatedAt, hl: (row.highlights || []).map(({ cfi, text, chapter, comment, file, at }) => ({ cfi, text, chapter, comment, file, at })) };
  }

  const prefs = store.getPrefs();
  const times = store.getPrefTimes();
  const fields = {};
  for (const k of store.SYNCED_PREFS) if (times[k]) fields[k] = { v: prefs[k], t: times[k] };

  const libs = {};
  for (const s of sources.filter((x) => x.type === 'github')) {
    libs[store.sourceKey(s)] = {
      t: s.updatedAt || 1,
      owner: s.owner, repo: s.repo, branch: s.branch || 'main', root: s.root || '', ignore: s.ignore || '', name: s.name || '',
    };
  }
  for (const [sk, t] of Object.entries(store.getRemovedSources())) libs[sk] = { t, removed: true };

  return { state, seen, progress, prefs: { fields, libraries: libs }, keyById, sources };
}

const round = (n) => Math.round((n || 0) * 10000) / 10000;

/* ---------------- Merging ---------------- */

function mergeEntries(remote, local, pick) {
  const out = { ...remote };
  for (const [k, v] of Object.entries(local)) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}

function mergeProgress(a, b) {
  const newer = b.t > a.t ? b : a;
  const byCfi = new Map();
  for (const h of [...(a.hl || []), ...(b.hl || [])]) {
    if (!h?.cfi) continue;
    // Same highlight on both devices: keep every field either one knows (e.g. its file).
    const known = Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    byCfi.set(h.cfi, { ...(byCfi.get(h.cfi) || {}), ...known });
  }
  return { ...newer, hl: [...byCfi.values()].sort((x, y) => (x.at || 0) - (y.at || 0)) };
}

function mergePrefs(remote, local) {
  const fields = { ...(remote.fields || {}) };
  for (const [k, v] of Object.entries(local.fields)) if (!fields[k] || v.t > fields[k].t) fields[k] = v;
  const libraries = { ...(remote.libraries || {}) };
  for (const [k, v] of Object.entries(local.libraries)) if (!libraries[k] || v.t > libraries[k].t) libraries[k] = v;
  return { fields, libraries };
}

/* ---------------- Apply the merge to this device ---------------- */

async function applyLocally(merged, local) {
  const report = { librariesAdded: 0, librariesRemoved: 0, updated: 0 };

  // Libraries first, so their entries below have somewhere to land.
  const bySk = new Map(local.sources.map((s) => [store.sourceKey(s), s]));
  for (const [sk, lib] of Object.entries(merged.prefs.libraries)) {
    const mine = bySk.get(sk);
    const myTime = mine ? mine.updatedAt || 1 : store.getRemovedSources()[sk] || 0;
    if (lib.t <= myTime) continue;
    if (lib.removed && mine) {
      await store.removeSource(mine.id, { fromSync: true });
      report.librariesRemoved++;
    } else if (!lib.removed && !mine) {
      const src = {
        id: store.newId('gh'), type: 'github', owner: lib.owner, repo: lib.repo, branch: lib.branch, root: lib.root,
        ignore: lib.ignore, name: lib.name, token: '', updatedAt: lib.t,
      };
      store.saveSource(src, { fromSync: true });
      bySk.set(sk, src);
      report.librariesAdded++;
    } else if (!lib.removed && mine) {
      store.saveSource({ ...mine, branch: lib.branch, root: lib.root, ignore: lib.ignore, name: lib.name, updatedAt: lib.t }, { fromSync: true });
    }
  }

  const prefs = store.getPrefs();
  const times = store.getPrefTimes();
  const prefPatch = {};
  for (const [k, f] of Object.entries(merged.prefs.fields)) {
    if (store.SYNCED_PREFS.includes(k) && f.t > (times[k] || 0) && prefs[k] !== f.v) prefPatch[k] = f.v;
  }
  if (Object.keys(prefPatch).length) {
    store.setPrefs(prefPatch, { fromSync: true });
    const t = store.getPrefTimes();
    for (const k of Object.keys(prefPatch)) t[k] = merged.prefs.fields[k].t;
    store.writeJSON('readover.prefsAt', t);
    report.prefsChanged = true;
  }

  // Entries: resolve "sourceKey|path" to this device's source id.
  const idBySk = new Map([...bySk].map(([sk, s]) => [sk, s.id]));
  const resolve = (k) => {
    const i = k.indexOf('|');
    const id = idBySk.get(k.slice(0, i));
    return id ? { id, path: k.slice(i + 1), key: store.keyOf(id, k.slice(i + 1)) } : null;
  };

  const stateRows = new Map((await store.state.all()).map((r) => [r.key, r]));
  const stateUpdates = new Map();
  const blank = (r) => ({ key: r.key, sourceId: r.id, path: r.path, lastSeen: 0, seen: 0, starred: 0, hidden: 0 });
  for (const [k, v] of Object.entries(merged.state)) {
    const r = resolve(k);
    if (!r) continue;
    const row = stateUpdates.get(r.key) || stateRows.get(r.key) || blank(r);
    if ((row.flagsAt || 0) >= v.t) continue;
    stateUpdates.set(r.key, { ...row, starred: v.s || 0, hidden: v.h || 0, flagsAt: v.t });
  }
  for (const [k, v] of Object.entries(merged.seen)) {
    const r = resolve(k);
    if (!r) continue;
    const row = stateUpdates.get(r.key) || stateRows.get(r.key) || blank(r);
    if ((row.lastSeen || 0) >= v[0] && (row.seen || 0) >= v[1]) continue;
    stateUpdates.set(r.key, { ...row, lastSeen: Math.max(row.lastSeen || 0, v[0]), seen: Math.max(row.seen || 0, v[1]) });
  }
  if (stateUpdates.size) await store.state.bulkPut([...stateUpdates.values()]);

  const progUpdates = [];
  const progRows = new Map((await store.progress.all()).map((r) => [r.key, r]));
  for (const [k, v] of Object.entries(merged.progress)) {
    const r = resolve(k);
    if (!r) continue;
    const row = progRows.get(r.key);
    const haveCfis = new Set((row?.highlights || []).map((h) => h.cfi));
    const newHl = (v.hl || []).some((h) => !haveCfis.has(h.cfi));
    if (row && (row.updatedAt || 0) >= v.t && !newHl) continue;
    const newer = !row || v.t > (row.updatedAt || 0);
    progUpdates.push({
      key: r.key, sourceId: r.id,
      pct: newer ? v.pct : row.pct, loc: newer ? v.loc : row.loc,
      updatedAt: newer ? v.t : row.updatedAt,
      highlights: mergeProgress({ hl: row?.highlights || [], t: 0 }, { hl: v.hl || [], t: 0 }).hl,
    });
  }
  if (progUpdates.length) await store.progress.bulkPut(progUpdates);

  report.updated = stateUpdates.size + progUpdates.length;
  return report;
}

/* ---------------- Writing files that diff nicely ---------------- */

/** One entry per line, keys sorted, so git diffs show exactly what changed. */
function serialize(entries) {
  const keys = Object.keys(entries).sort();
  if (!keys.length) return '{\n  "version": 2,\n  "items": {}\n}\n';
  const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(entries[k], sortedReplacer)}`);
  return `{\n  "version": 2,\n  "items": {\n${lines.join(',\n')}\n  }\n}\n`;
}

function sortedReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]));
  }
  return value;
}

/* ---------------- When to sync ---------------- */

let interval = null;
let soon = null;
export function startAutoSync() {
  // Shortly after a change that matters (a favourite, a page turned in a book), so it
  // reaches your other devices quickly. A burst of changes still makes one commit.
  window.addEventListener('readover:dirty', (e) => {
    if (e.detail !== 'important' || !dataHome()) return;
    clearTimeout(soon);
    soon = setTimeout(() => syncNow({ includeSeen: true }), 15000);
  });
  // Every few minutes while the app is open, but only for changes that matter.
  clearInterval(interval);
  interval = setInterval(() => {
    if (document.visibilityState === 'visible' && store.getDirty().important) syncNow({ includeSeen: true });
  }, 4 * 60 * 1000);
  // Leaving the app (switching tabs, locking the phone): send everything.
  document.addEventListener('visibilitychange', () => {
    const d = store.getDirty();
    if (document.visibilityState === 'hidden' && (d.important || d.seen)) syncNow({ includeSeen: true });
    if (document.visibilityState === 'visible') syncNow({ includeSeen: false });
  });
  window.addEventListener('online', () => syncNow({ includeSeen: false }));
}
