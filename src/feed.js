// The feed: a fresh random order on every open, weighted so that things you
// haven't seen in a long time (or ever) come up more often.
import { items, state } from './store.js';

const DAY = 86400000;

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

  pool = weightedShuffle(pool, (it) => weight(states.get(it.key), now));
  return { queue: pool, states };
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
