// The feed learns what you like, on this device only, and says what it learned.
//
// Signals: opening something, starring it and staying on it count for it; skipping
// it quickly and hiding it count against. They're credited to the item's library,
// folder and top-level folder ("facets"), not to the item itself. The feed then
// shows more of the facets you engage with, never more than about twice as often,
// and never less than half. Scores fade by ~2% a day, so tastes can change.
import { getSource, getPrefs } from './store.js';

const KEY = 'readover.learn';
const DAY = 86400000;
const SIGNALS = { open: 3, star: 4, unstar: -2, dwell: 1, skip: -1, hide: -4 };

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { facets: data.facets || {}, at: data.at || Date.now() };
  } catch {
    return { facets: {}, at: Date.now() };
  }
}
function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

/** Fade old scores so recent behaviour counts most. */
function decayed() {
  const data = load();
  const days = (Date.now() - data.at) / DAY;
  if (days >= 1) {
    const f = Math.pow(0.98, days);
    for (const v of Object.values(data.facets)) v.score *= f;
    data.at = Date.now();
    save(data);
  }
  return data;
}

export const enabled = () => getPrefs().learn !== false;

function facetsOf(item) {
  const out = [`src:${item.sourceId}`];
  if (item.folder) {
    const top = item.folder.split('/')[0];
    out.push(`dir:${item.sourceId}|${top}`);
    if (item.folder !== top) out.push(`dir:${item.sourceId}|${item.folder}`);
  }
  out.push(`kind:${item.kind === 'note' ? 'note' : 'book'}`);
  return out;
}

/** Record a signal for an item: 'open' | 'star' | 'unstar' | 'dwell' | 'skip' | 'hide'. */
export function signal(item, kind) {
  if (!enabled() || !item || !(kind in SIGNALS)) return;
  const data = decayed();
  for (const f of facetsOf(item)) {
    const v = data.facets[f] || { score: 0, n: 0 };
    v.score = Math.max(-30, Math.min(30, v.score + SIGNALS[kind]));
    v.n += 1;
    data.facets[f] = v;
  }
  save(data);
}

/** How much more (or less) often this item should come up: 0.5× to 2×. */
export function multiplier(item, data = decayed()) {
  if (!enabled()) return 1;
  let sum = 0;
  for (const f of facetsOf(item)) {
    const v = data.facets[f];
    if (!v || v.n < 3) continue; // need a few signals before acting on them
    // Folders say the most about taste; a whole library or "notes vs books" is broader.
    const w = f.startsWith('dir:') ? 1 : 0.5;
    sum += (w * v.score) / 15;
  }
  return Math.exp(Math.max(-0.7, Math.min(0.7, sum * 0.5)));
}

/** For Settings: what the feed shows more and less of, in plain words. */
export function describe() {
  const { facets } = decayed();
  const label = (key) => {
    const [type, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (type === 'kind') return rest === 'note' ? 'Notes' : 'Books';
    if (type === 'src') return getSource(rest)?.name || 'A removed library';
    const [id, folder] = rest.split('|');
    return `${folder} (${getSource(id)?.name || 'removed'})`;
  };
  const rows = Object.entries(facets)
    .filter(([k, v]) => v.n >= 3 && Math.abs(v.score) >= 2 && !k.startsWith('kind:'))
    .map(([k, v]) => ({ label: label(k), score: v.score }))
    .sort((a, b) => b.score - a.score);
  return { more: rows.filter((r) => r.score > 0).slice(0, 5), less: rows.filter((r) => r.score < 0).reverse().slice(0, 5) };
}

export function reset() {
  localStorage.removeItem(KEY);
}

export const snapshot = decayed;
