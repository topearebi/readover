// The feed: a fresh random order on every open, weighted so that things you
// haven't seen in a long time (or ever) come up more often.
import { items, state, progress, getSources, sourceKey, keyOf } from './store.js';
import * as learn from './learn.js';
import { knownDate, memoryLine, isOnThisDay } from './dates.js';

const DAY = 86400000;

/**
 * New notes come back on a schedule: the day after, then 3 days, a week and
 * three weeks after they were written (or first appeared in a library). Each
 * time one is due and you haven't seen it since, it goes to the front.
 */
const REVIEW_DAYS = [1, 3, 7, 21];
const SCHEDULE_ENDS = 30 * DAY;

export function reviewDue(item, st, now = Date.now()) {
  if (!item.addedAt || now - item.addedAt > SCHEDULE_ENDS) return null;
  let due = 0;
  for (const d of REVIEW_DAYS) {
    const t = item.addedAt + d * DAY;
    if (t <= now) due = t;
  }
  if (!due || (st?.lastSeen || 0) >= due) return null;
  return due;
}

function ago(ms) {
  const days = Math.round(ms / DAY);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'a week ago';
  return `${Math.round(days / 7)} weeks ago`;
}

/** The short line a card shows when it's back because of the schedule. */
export function reviewReason(item, now = Date.now()) {
  return item.written ? `You wrote this ${ago(now - item.addedAt)}` : `New ${ago(now - item.addedAt)}`;
}

/**
 * Weight: never seen → 4, seen today → ~0.15, rising to 4 over ~3 months.
 * Starred items get a mild boost so favourites resurface, but not constantly.
 */
function weight(st, now) {
  let w;
  if (!st || !st.lastSeen) w = 4;
  else {
    const days = (now - st.lastSeen) / DAY;
    w = Math.min(4, 0.15 + days / 24);
  }
  if (st && st.starred) w *= 1.4;
  return w;
}

/** Efraimidis–Spirakis weighted shuffle: key = u^(1/w), sort descending. */
function weightedShuffle(list, weightOf) {
  return list
    .map((x) => ({ x, k: Math.pow(Math.random(), 1 / Math.max(weightOf(x), 1e-6)) }))
    .sort((a, b) => b.k - a.k)
    .map((e) => e.x);
}

/**
 * @param {object} opts
 * @param {string[]} opts.sourceIds   sources in scope
 * @param {string}   opts.folder      folder prefix ('' = everything)
 * @param {'all'|'starred'|'notes'|'books'} opts.filter
 */
export async function buildQueue({ sourceIds, folder = '', filter = 'all' }) {
  const [allItems, allStates] = await Promise.all([items.all(), state.all()]);
  const scope = new Set(sourceIds);
  const states = new Map(allStates.map((s) => [s.key, s]));
  const now = Date.now();

  let pool = allItems.filter((it) => {
    if (!scope.has(it.sourceId)) return false;
    if (folder && !(it.folder === folder || it.folder.startsWith(`${folder}/`))) return false;
    const st = states.get(it.key);
    if (filter === 'hidden') return Boolean(st?.hidden);
    if (st?.hidden) return false;
    if (filter === 'starred') return Boolean(st?.starred);
    if (filter === 'notes') return it.kind === 'note';
    if (filter === 'books') return it.kind !== 'note';
    return true;
  });

  // Order: notes due for review, then highlights due to come back, then anything
  // "on this day"; everything else follows in a fresh weighted shuffle.
  const due = [];
  const onThisDay = [];
  const rest = [];
  const reasons = new Map();
  for (const it of pool) {
    const at = reviewDue(it, states.get(it.key), now);
    if (at) {
      due.push({ it, at });
      reasons.set(it.key, reviewReason(it, now));
      continue;
    }
    const d = knownDate(it);
    const line = memoryLine(d, now);
    if (line) reasons.set(it.key, line);
    if (isOnThisDay(d, now) && !seenToday(states.get(it.key), now)) onThisDay.push(it);
    else rest.push(it);
  }
  due.sort((a, b) => a.at - b.at);

  // Book highlights you made recently, back after 1, 3 and 7 days.
  const forced = new Map();
  const hlDue = await highlightsDue(new Set(pool.map((i) => i.key)), now);
  const hlItems = [];
  for (const h of hlDue) {
    if (forced.has(h.fileKey) || due.some((d) => d.it.key === h.fileKey)) continue;
    const it = pool.find((i) => i.key === h.fileKey);
    if (!it) continue;
    forced.set(it.key, { text: h.text, cfi: h.cfi });
    reasons.set(it.key, `You highlighted this ${agoShort(now - h.at)}`);
    hlItems.push(it);
  }
  const used = new Set([...hlItems, ...onThisDay].map((i) => i.key));
  const shuffled = weightedShuffle(
    rest.filter((i) => !used.has(i.key)),
    (it) => weight(states.get(it.key), now) * learn.multiplier(it, snapshotOnce())
  );
  const queue = [...due.map((d) => d.it), ...hlItems, ...onThisDay.filter((i) => !forced.has(i.key)), ...shuffled];
  return { queue, states, reasons, forced, dueCount: due.length + hlItems.length };
}

let learnSnap = null;
function snapshotOnce() {
  learnSnap = learnSnap && Date.now() - learnSnap.t < 1000 ? learnSnap : { t: Date.now(), data: learn.snapshot() };
  return learnSnap.data;
}

const seenToday = (st, now) => st?.lastSeen && now - st.lastSeen < DAY;
const agoShort = (ms) => (ms < 1.5 * DAY ? 'yesterday' : `${Math.round(ms / DAY)} days ago`);

/* ---------- Highlights coming back ---------- */

const HL_DAYS = [1, 3, 7];
const HL_SEEN = 'readover.hlSeen';
const hlSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(HL_SEEN) || '{}');
  } catch {
    return {};
  }
};
export function markHighlightSeen(cfi) {
  const seen = hlSeen();
  seen[cfi] = Date.now();
  try {
    localStorage.setItem(HL_SEEN, JSON.stringify(seen));
  } catch {}
}

/** Highlights saved from books whose next step (1, 3, 7 days) has come and not been seen. */
async function highlightsDue(inPool, now) {
  const idBySk = new Map(getSources().map((s) => [sourceKey(s), s.id]));
  const seen = hlSeen();
  const out = [];
  for (const p of await progress.all()) {
    for (const h of p.highlights || []) {
      if (!h.file || !h.at || now - h.at > 10 * DAY) continue;
      let step = 0;
      for (const d of HL_DAYS) if (h.at + d * DAY <= now) step = h.at + d * DAY;
      if (!step || (seen[h.cfi] || 0) >= step) continue;
      const i = h.file.indexOf('|');
      const id = idBySk.get(h.file.slice(0, i));
      const fileKey = id && keyOf(id, h.file.slice(i + 1));
      if (fileKey && inPool.has(fileKey)) out.push({ ...h, fileKey, step });
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

export function foldersFor(allItems, sourceIds) {
  const scope = new Set(sourceIds);
  const set = new Set();
  for (const it of allItems) {
    if (!scope.has(it.sourceId) || !it.folder) continue;
    const parts = it.folder.split('/');
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
