// Save queue for changes to notes in GitHub repos.
//
// Every save lands on the device first (so the feed and reader show it at once),
// then goes into this queue. A background sender commits each change on its own.
// Offline, the queue waits. If the file changed on GitHub since you opened it,
// your version is saved next to it as a conflict copy: nothing is overwritten.
import * as store from './store.js';
import * as github from './sources/github.js';
import { kindOf } from './library.js';
import { applySubs } from './notefile.js';

const { outbox, items, content, keyOf } = store;

let running = false;
let again = false;
let lastError = '';

/* ---------- Status, for the dot in the top bar ---------- */

export async function status() {
  const all = await outbox.all();
  const errors = all.filter((e) => e.error);
  return { pending: all.length, errors: errors.length, message: errors[0]?.error || lastError || '', sending: running };
}

async function announce() {
  window.dispatchEvent(new CustomEvent('readover:outbox', { detail: await status() }));
}

/** Paths a library refresh must leave alone until the queue has sent them. */
export async function pendingKeys() {
  const keys = new Set();
  for (const e of await outbox.all()) {
    keys.add(e.key);
    if (e.fromKey) keys.add(e.fromKey); // a move's old path, still on GitHub for now
    for (const x of e.edits || []) keys.add(x.key); // notes whose links a rename updates
  }
  return keys;
}

/* ---------- Queueing ---------- */

const newId = () => `${Date.now().toString(36).padStart(9, '0')}-${Math.random().toString(36).slice(2, 6)}`;

function toItem(src, path, sha) {
  const parts = path.split('/');
  const name = parts.pop();
  return { key: keyOf(src.id, path), sourceId: src.id, path, folder: parts.join('/'), name, kind: kindOf(path), sha };
}

async function showLocally(src, path, text, sha) {
  const item = toItem(src, path, sha);
  const prev = await items.get(item.key);
  Object.assign(item, prev ? { addedAt: prev.addedAt, written: prev.written } : { addedAt: Date.now(), written: true });
  await items.put(item);
  await content.put({ key: item.key, sourceId: src.id, sha, text });
  return item;
}

/** Replace a note's whole text. Returns the local item straight away. */
export async function queueWrite(src, path, text, message) {
  const key = keyOf(src.id, path);
  const existing = (await outbox.byIndex('key', key)).find((e) => e.op === 'put' && !e.sending);
  const current = await items.get(key);
  let entry;
  if (existing) {
    // Not sent yet: fold this edit into it (same starting point, newest text).
    entry = { ...existing, text, message: message || existing.message, error: '' };
  } else {
    const baseSha = current && !String(current.sha).startsWith('local:') ? current.sha : current ? undefined : null;
    entry = { id: newId(), key, sourceId: src.id, path, op: 'put', text, baseSha, message: message || `Readover: edit ${path}`, createdAt: Date.now() };
    if (baseSha === undefined) {
      // Edited again while an earlier edit is still sending: start from that edit.
      // (or from a move or rename that wrote this note and hasn't been sent yet).
      const inFlight = (await outbox.byIndex('key', key)).find((e) => e.op === 'put');
      entry.after = inFlight?.id || String(current.sha).slice(6);
      entry.baseSha = null;
    }
  }
  await outbox.put(entry);
  const item = await showLocally(src, path, text, `local:${entry.id}`);
  kick();
  return item;
}

/** Append a block to a file (e.g. a book highlight). Appends never conflict. */
export async function queueAppend(src, path, header, block, message) {
  const key = keyOf(src.id, path);
  const entry = { id: newId(), key, sourceId: src.id, path, op: 'append', header, block, message, createdAt: Date.now() };
  await outbox.put(entry);
  const cached = await content.get(key);
  const text = `${(cached?.text ?? header).replace(/\s*$/, '')}\n\n${block.trim()}\n`;
  const item = await showLocally(src, path, text, `local:${entry.id}`);
  kick();
  return item;
}

/** Delete a note. Unsent edits to it are dropped; a note never sent is just forgotten. */
export async function queueDelete(src, path) {
  const key = keyOf(src.id, path);
  const queued = await outbox.byIndex('key', key);
  for (const e of queued) if (!e.sending) await outbox.delete(e.id);
  const current = await items.get(key);
  const baseSha = current?.committedSha ?? (String(current?.sha).startsWith('local:') ? null : current?.sha ?? null);
  const inFlight = queued.some((e) => e.sending);
  if (baseSha || inFlight) {
    await outbox.put({ id: newId(), key, sourceId: src.id, path, op: 'delete', baseSha, after: inFlight || undefined, message: `Readover: delete ${path}`, createdAt: Date.now() });
    kick();
  }
  announce();
}

/** Rename or move a note, as one commit that git sees as a rename. */
export async function queueMove(src, from, to, text, fmPatch = null, message = '') {
  const fromKey = keyOf(src.id, from);
  const current = await items.get(fromKey);
  const baseSha = current?.committedSha ?? (String(current?.sha).startsWith('local:') ? null : current?.sha ?? null);
  // A plain move (the text unchanged) keeps the note's last-change date: moving isn't tending.
  const keepChangedAt = !fmPatch && current && current.changedSha === current.sha ? current.changedAt || 0 : null;
  const entry = { id: newId(), key: keyOf(src.id, to), fromKey, sourceId: src.id, from, path: to, op: 'move', text, fmPatch, baseSha, keepChangedAt, message: message || `Readover: move ${from} to ${to}`, createdAt: Date.now() };
  await outbox.put(entry);
  // Queued edits of the old path follow the note to its new path.
  for (const e of await outbox.byIndex('key', fromKey)) {
    if (e.op === 'put' && !e.sending && e.id > entry.id) await outbox.put({ ...e, key: entry.key, path: to });
  }
  let item = await showLocally(src, to, text, `local:${entry.id}`);
  if (keepChangedAt != null) {
    item = { ...item, keepChangedAt };
    await items.put(item);
  }
  kick();
  return item;
}

/**
 * Rename or move a note and update the links to it, as one commit. `subs` are exact
 * substitutions for the note itself (its title, its own links); `edits` are the
 * other notes: [{ path, text, subs }], `text` being the new text as on this device.
 * If a note changed elsewhere before this is sent, its substitutions are applied to
 * the newer text instead. Link updates aren't tending: those notes keep their clock,
 * and so does the renamed note unless `keepClock` is false.
 */
export async function queueRename(src, { from, to, text, fmPatch = null, subs = [], edits = [], message = '', keepClock = true }) {
  const fromKey = keyOf(src.id, from);
  const current = await items.get(fromKey);
  const baseOf = (it) => it?.committedSha ?? (String(it?.sha).startsWith('local:') ? null : it?.sha ?? null);
  const clockOf = (it) => (it && it.changedSha === it.sha ? it.changedAt || 0 : it?.keepChangedAt ?? null);
  const id = newId();
  const list = [];
  for (const x of edits) {
    const key = keyOf(src.id, x.path);
    const it = await items.get(key);
    list.push({ key, path: x.path, text: x.text, subs: x.subs, baseSha: baseOf(it), keepChangedAt: clockOf(it) });
  }
  const keepChangedAt = keepClock ? clockOf(current) : null;
  const entry = { id, key: keyOf(src.id, to), fromKey: from === to ? undefined : fromKey, sourceId: src.id, from, path: to, op: 'move', text, fmPatch, subs, edits: list, baseSha: baseOf(current), keepChangedAt, message: message || `Readover: rename ${from} to ${to}`, createdAt: Date.now() };
  await outbox.put(entry);
  if (from !== to) {
    for (const e of await outbox.byIndex('key', fromKey)) {
      if (e.op === 'put' && !e.sending && e.id > entry.id) await outbox.put({ ...e, key: entry.key, path: to });
    }
  }
  const mark = async (it, keep) => {
    if (keep == null) return it;
    const next = { ...it, keepChangedAt: keep };
    await items.put(next);
    return next;
  };
  for (const x of list) await mark(await showLocally(src, x.path, x.text, `local:${id}`), x.keepChangedAt);
  const item = await mark(await showLocally(src, to, text, `local:${id}`), keepChangedAt);
  kick();
  return item;
}

/* ---------- Sending ---------- */

let timer = null;
export function kick(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(() => process().catch((e) => console.warn('Save queue:', e)), delay);
}

const isOffline = (err) => !navigator.onLine || /offline|could not be reached|Failed to fetch|NetworkError/i.test(err.message || '');

export async function process({ retryErrors = false } = {}) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  announce();
  try {
    do {
      again = false;
      const queue = (await outbox.all()).sort((a, b) => a.id.localeCompare(b.id));
      for (const entry of queue) {
        if (entry.error && !retryErrors) continue;
        const src = store.getSource(entry.sourceId);
        if (!src) {
          await outbox.delete(entry.id); // library was removed
          continue;
        }
        try {
          await outbox.put({ ...entry, sending: true });
          await send(src, entry);
          await outbox.delete(entry.id);
          lastError = '';
        } catch (err) {
          if (isOffline(err)) {
            await outbox.put({ ...entry, sending: false });
            lastError = '';
            return; // try again when back online
          }
          console.warn('Save failed', entry.path, err);
          await outbox.put({ ...entry, sending: false, error: err.message || 'Could not save' });
        }
        announce();
      }
    } while (again);
  } finally {
    running = false;
    announce();
  }
}

async function send(src, entry) {
  if (entry.op === 'delete') return sendDelete(src, entry);
  if (entry.op === 'move') return sendMove(src, entry);
  if (entry.op === 'append') {
    let text;
    const sha = await github.updateFile(
      src,
      entry.path,
      (cur) => (text = `${(cur ?? entry.header).replace(/\s*$/, '')}\n\n${entry.block.trim()}\n`),
      entry.message
    );
    await settle(src, entry, text, sha);
    return;
  }

  const remote = await github.getFile(src, entry.path);
  const remoteSha = remote?.sha ?? null;
  let expected = entry.baseSha ?? null;
  if (entry.after) {
    // It followed an edit that was still sending; that one is committed now.
    const item = await items.get(entry.key);
    expected = item?.committedSha ?? (String(item?.sha).startsWith('local:') ? null : item?.sha ?? null);
  }

  if (remote && remote.text === entry.text) {
    await settle(src, entry, entry.text, remoteSha); // already identical on GitHub
    return;
  }
  if (remoteSha === expected) {
    const sha = await github.putFile(src, entry.path, entry.text, remoteSha, entry.message);
    await settle(src, entry, entry.text, sha);
    return;
  }

  // Changed on GitHub since this edit started: keep theirs, save ours alongside.
  const copyPath = conflictPath(entry.path);
  const copySha = await github.putFile(src, copyPath, entry.text, null, `Readover: kept your edit of ${entry.path} as a copy (it changed elsewhere)`);
  await showLocally(src, copyPath, entry.text, copySha);
  if (remote) await showLocally(src, entry.path, remote.text, remote.sha);
  window.dispatchEvent(new CustomEvent('readover:conflict', { detail: { path: entry.path, copyPath } }));
}

async function sendDelete(src, entry) {
  const remote = await github.getFile(src, entry.path);
  if (!remote) return; // already gone
  let expected = entry.baseSha;
  if (entry.after) expected = remote.sha; // it was our own edit that just went up
  if (remote.sha !== expected) {
    // Changed somewhere else since you deleted it: keep it, and say so.
    await showLocally(src, entry.path, remote.text, remote.sha);
    window.dispatchEvent(new CustomEvent('readover:conflict', { detail: { path: entry.path, kind: 'delete' } }));
    return;
  }
  await github.deleteFile(src, entry.path, remote.sha, entry.message);
}

async function sendMove(src, entry) {
  const { gitBlobSha } = await import('./lib/gitsha.js');
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await github.headSha(src);
    const remote = await github.getFile(src, entry.from);
    // Move whatever the note says now (an edit made elsewhere moves with it), with any
    // frontmatter change the move carries (pruning adds `pruned:`) applied to that text.
    let text = remote ? (remote.sha === entry.baseSha ? entry.text : remote.text) : entry.text;
    if (remote && remote.sha !== entry.baseSha) {
      if (entry.fmPatch) {
        const { updateFrontmatter } = await import('./notefile.js');
        text = updateFrontmatter(text, entry.fmPatch);
      }
      if (entry.subs?.length) text = applySubs(text, entry.subs);
    }
    const same = entry.from === entry.path;
    let to = entry.path;
    if (!same && (await github.getFile(src, to))) to = conflictPath(to); // never overwrite another note
    const files = { [to]: text };
    if (remote && !same) files[entry.from] = null;
    // Notes whose links change, from whatever they say now.
    const edited = [];
    const untouched = [];
    for (const x of entry.edits || []) {
      const r = await github.getFile(src, x.path);
      const t = r ? (r.sha === x.baseSha ? x.text : applySubs(r.text, x.subs)) : null;
      if (!r || t === r.text) {
        untouched.push({ x, r }); // deleted, or nothing left to change
        continue;
      }
      files[x.path] = t;
      edited.push({ ...x, text: t });
    }
    try {
      await github.commitFiles(src, head, files, entry.message);
    } catch (err) {
      if (err.status === 422 || err.status === 409) continue;
      throw err;
    }
    if (to !== entry.path) {
      await items.delete(entry.key);
      await content.delete(entry.key);
    }
    const sha = await gitBlobSha(text);
    // Same text as before the move: keep its last-change date.
    const keep = entry.keepChangedAt != null && remote && remote.sha === sha ? entry.keepChangedAt : null;
    await settle(src, { ...entry, path: to, key: keyOf(src.id, to) }, text, sha, keep ?? (entry.edits ? entry.keepChangedAt : null));
    for (const x of edited) await settle(src, { ...entry, path: x.path, key: x.key }, x.text, await gitBlobSha(x.text), x.keepChangedAt);
    for (const { x, r } of untouched) {
      if (r) await settle(src, { ...entry, path: x.path, key: x.key }, r.text, r.sha, x.keepChangedAt);
      else {
        await items.delete(x.key);
        await content.delete(x.key);
      }
    }
    return;
  }
  throw new Error('The repository kept changing; will try the move again.');
}

/** Point the local copy at the committed version, unless a newer edit is already queued. */
async function settle(src, entry, text, sha, keepChangedAt = null) {
  const newer = (await outbox.byIndex('key', entry.key)).some((e) => e.id !== entry.id && e.id > entry.id);
  if (newer) {
    const item = await items.get(entry.key);
    if (item) await items.put({ ...item, committedSha: sha });
    return;
  }
  await showLocally(src, entry.path, text, sha);
  // Just committed: that's when it last changed (the garden's clock), no need to ask.
  const item = await items.get(entry.key);
  if (item && item.sha === sha) {
    const { keepChangedAt: _drop, ...rest } = item;
    await items.put({ ...rest, changedAt: keepChangedAt ?? Date.now(), changedSha: sha });
  }
}

function conflictPath(path) {
  const d = new Date();
  const stamp = `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const dot = path.lastIndexOf('.');
  return `${path.slice(0, dot)} (conflict ${stamp})${path.slice(dot)}`;
}

/** Drop a change that can't be saved (shown in Settings with the error). */
export async function discard(id) {
  await outbox.delete(id);
  announce();
}

export async function list() {
  return (await outbox.all()).sort((a, b) => a.id.localeCompare(b.id));
}

window.addEventListener('online', () => kick(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') kick(0);
});
setInterval(async () => {
  if ((await outbox.all()).some((e) => !e.error)) kick(0);
}, 30000);
