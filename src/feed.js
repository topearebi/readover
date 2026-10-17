// The feed: a fresh random order on every open, weighted so that things you
// haven't seen in a long time (or ever) come up more often.
import { items, state } from './store.js';
import { isBook } from './library.js';
import { inboxState } from './insights.js';
import { garden, feedWeight } from './garden.js';
import { passes } from './filters.js';
import * as learn from './learn.js';
import { knownDate, memoryLine, isOnThisDay } from './dates.js';

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
 * @param {string} opts.growth   growth filter (filters.js), 'any' by default
 * @param {string[]} opts.types  types to show (top-level folders, '' = Unsorted); [] = all
 */
export async function buildQueue({ sourceIds, folder = '', filter = 'all', growth: growthId = 'any', types = [] }) {
  const [allItems, allStates] = await Promise.all([items.all(), state.all()]);
  const scope = new Set(sourceIds);
  const states = new Map(allStates.map((s) => [s.key, s]));
  const now = Date.now();

  let pool = allItems.filter((it) => {
    if (it.kind === 'blob') return false;
    if (!scope.has(it.sourceId)) return false;
    if (folder && !(it.folder === folder || it.folder.startsWith(`${folder}/`))) return false;
    const st = states.get(it.key);
    if (filter === 'hidden') return Boolean(st?.hidden);
    if (st?.hidden) return false;
    if (filter === 'starred') return Boolean(st?.starred);
    if (filter === 'notes') return it.kind === 'note';
    if (filter === 'books') return isBook(it);
    return true;
  });

  // Exports and old grouped highlight files are an inbox: they come up while they
  // still hold seeds (highlights not yet turned into insights), more often the more
  // they hold, and drop out of the feed once everything in them has been taken in.
  const inbox = new Map();
  try {
    for (const [key, box] of (await inboxState()).inboxes) inbox.set(key, box.seeds.length);
  } catch {}
  if (filter !== 'hidden') pool = pool.filter((it) => inbox.get(it.key) !== 0);
  const inboxBoost = (it) => (inbox.has(it.key) ? Math.min(3, 1 + inbox.get(it.key) / 10) : 1);

  // The garden: the thirstier a note, the likelier it comes up; pruned notes never do.
  let growth = new Map();
  try {
    growth = await garden(now);
  } catch {}
  // Pruned notes stay out of sight unless asked for; growth and type filters apply here.
  pool = pool.filter((it) => passes(growth.get(it.key), growthId, types));
  const thirst = (it) => feedWeight(growth.get(it.key), now);

  // Anything "on this day" first; everything else in a fresh weighted shuffle.
  const onThisDay = [];
  const rest = [];
  const reasons = new Map();
  for (const it of pool) {
    const d = knownDate(it);
    const line = memoryLine(d, now);
    if (line) reasons.set(it.key, line);
    if (isOnThisDay(d, now) && !seenToday(states.get(it.key), now)) onThisDay.push(it);
    else rest.push(it);
  }

  const forced = new Map(); // a highlight a card must show (none at present)
  const used = new Set(onThisDay.map((i) => i.key));
  const shuffled = weightedShuffle(
    rest.filter((i) => !used.has(i.key)),
    (it) => weight(states.get(it.key), now) * learn.multiplier(it, snapshotOnce()) * inboxBoost(it) * thirst(it)
  );
  const queue = [...onThisDay, ...shuffled];
  return { queue, states, reasons, forced, growth };
}

let learnSnap = null;
function snapshotOnce() {
  learnSnap = learnSnap && Date.now() - learnSnap.t < 1000 ? learnSnap : { t: Date.now(), data: learn.snapshot() };
  return learnSnap.data;
}

function seenToday(st, now) {
  return Boolean(st?.lastSeen && now - st.lastSeen < DAY);
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
