// The garden: how developed each note is (its stage) and how recently it was tended
// (its health). Worked out live from the notes on this device; nothing is written to
// files except when a note is pruned (moved to Archive/ with `pruned:` in its frontmatter).
//
//   Stage    Seed     no thoughts and no connections
//            Sprout   at least 1 thought or 1 connection
//            Sapling  2+ thoughts and 2+ connections
//            Tree     5+ connections
//   Health   days since last tended, against the windows below: healthy, thirsty,
//            wilting. Notes marked done (`status: done`) rest instead: they don't wilt.
//            No status means in progress. `canonical_url:` links to a published version.
//   Type     the note's top-level folder in its library ('' = the top level, Unsorted).
//
// Thoughts: 1 if the note has your own words, plus each dated entry under ## Thoughts.
// Connections: distinct notes linked to or from this one. A quote's source line
// ("> — [[Note]]") doesn't count, and nor do pruned notes.
import * as store from './store.js';
import { entries, resolve } from './notes-index.js';
import { ownWords, typeOf, isDone } from './notefile.js';
import { changedAt } from './clock.js';
import { isInbox } from './insights.js';

/** Adjust the garden here. Days are "up to and including". */
export const THRESHOLDS = {
  sapling: { thoughts: 2, connections: 2 },
  tree: { connections: 5 },
  // [healthy up to, thirsty up to] in days; older than the second number is wilting.
  health: {
    seed: [7, 30],
    sprout: [30, 90],
    sapling: [90, 365],
    tree: [182, 730],
  },
  // The feed: past the healthy window, a note's chance of coming up grows with how far
  // past it is (twice the window → ×1.5), up to ×2. Resting notes unread for a year → ×1.3.
  boost: { slope: 0.5, max: 2, restingAfterDays: 365, resting: 1.3 },
};

const DAY = 86400000;
const ARCHIVE = /(^|\/)archive\//i;
export const isArchived = (path) => ARCHIVE.test(path || '');

/** Thoughts in a note: own words outside ## Thoughts / ## Related, plus dated entries. */
export function thoughtsOf(body) {
  let section = '';
  const own = [];
  const dated = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      section = h[1].trim().toLowerCase();
      continue;
    }
    if (section.startsWith('thoughts')) {
      const d = /^\s*[-*+]\s+(?:\*\*)?((?:19|20)\d\d-\d\d-\d\d)\b/.exec(line);
      if (d) dated.push(Date.parse(`${d[1]}T12:00:00`));
      continue;
    }
    if (section.startsWith('related')) continue;
    own.push(line);
  }
  const mine = ownWords(own.join('\n')) > 0;
  return { count: (mine ? 1 : 0) + dated.length, ownWords: mine, latest: dated.length ? Math.max(...dated) : 0 };
}

/** Is the line that holds this position a quote's source line ("> — …")? */
function inSourceLine(text, at) {
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  return /^\s*>\s*(—|–|--)\s/.test(text.slice(start, end < 0 ? undefined : end));
}

export function stageOf(thoughts, connections) {
  if (connections >= THRESHOLDS.tree.connections) return 'tree';
  if (thoughts >= THRESHOLDS.sapling.thoughts && connections >= THRESHOLDS.sapling.connections) return 'sapling';
  if (thoughts > 0 || connections > 0) return 'sprout';
  return 'seed';
}

export function healthOf(stage, days) {
  const w = THRESHOLDS.health[stage];
  if (!w || days == null) return null;
  return days <= w[0] ? 'healthy' : days <= w[1] ? 'thirsty' : 'wilting';
}

let cache = null;
let version = 0;
if (typeof window !== 'undefined') window.addEventListener('readover:notes-changed', () => version++);

/**
 * The garden for every note on this device: Map key → {
 *   stage: 'seed'|'sprout'|'sapling'|'tree'|'pruned'|'pending'|'inbox',
 *   health: 'healthy'|'thirsty'|'wilting'|null,   null when resting, pruned, inbox, pending
 *   clock: 'known'|'pending',                      pending until the last change is known
 *   type (top-level folder, '' = top level), status ('done'|''), resting, canonical, thoughts, connections, lastTended, days, lastRead
 * }
 */
export async function garden(now = Date.now()) {
  const all = await entries();
  const items = new Map((await store.items.all()).map((i) => [i.key, i]));
  const states = new Map((await store.state.all()).map((s) => [s.key, s]));
  const signature = `${version}|${all.map((e) => `${e.item.key}:${e.item.sha}:${e.hasText ? 1 : 0}:${changedAt(items.get(e.item.key)) ?? '-'}`).join(',')}`;
  if (cache?.signature === signature && now - cache.at < 60000) return cache.map;

  // Pass 1: what each note is.
  const info = new Map();
  for (const e of all) {
    const item = items.get(e.item.key) || e.item;
    if (!e.hasText) {
      info.set(item.key, { e, item, pending: true });
      continue;
    }
    const raw = (await store.content.get(item.key))?.text || '';
    const pruned = ARCHIVE.test(item.path) || Boolean(e.meta?.pruned);
    info.set(item.key, { e, item, inbox: isInbox(raw, item.path), pruned });
  }

  // Pass 2: links, both ways, between notes that count.
  const out = new Map();
  for (const [key, n] of info) {
    if (n.pending || n.inbox) continue;
    const set = new Set();
    for (const link of n.e.links) {
      if (inSourceLine(n.e.text, link.at)) continue;
      const target = resolve(link, n.e, all);
      const t = target && info.get(target.item.key);
      if (!t || target.item.key === key || t.pruned || t.pending) continue;
      set.add(target.item.key);
    }
    out.set(key, set);
  }
  const connected = new Map();
  for (const [from, targets] of out) {
    if (info.get(from).pruned) continue; // a pruned note's links don't count either
    for (const to of targets) {
      if (!connected.has(from)) connected.set(from, new Set());
      if (!connected.has(to)) connected.set(to, new Set());
      connected.get(from).add(to);
      connected.get(to).add(from);
    }
  }

  // Pass 3: stage and health.
  const map = new Map();
  for (const [key, n] of info) {
    const lastRead = states.get(key)?.lastSeen || 0;
    const root = store.getSource(n.item.sourceId)?.root || '';
    if (n.pending) {
      map.set(key, { stage: 'pending', health: null, clock: 'pending', type: typeOf(n.item.path, root), lastRead });
      continue;
    }
    if (n.inbox) {
      map.set(key, { stage: 'inbox', health: null, clock: 'known', type: typeOf(n.item.path, root), lastRead });
      continue;
    }
    // A pruned note keeps the type of the folder it came from.
    const from = n.pruned && n.e.meta?.pruned_from != null ? String(n.e.meta.pruned_from).replace(/^\/+|\/+$/g, '') : null;
    const type = from != null ? typeOf(`${from}/x`, root) : typeOf(n.item.path, root);
    const status = isDone(n.e.meta) ? 'done' : '';
    const resting = status === 'done';
    const canonical = /^https?:\/\//i.test(String(n.e.meta?.canonical_url || '')) ? String(n.e.meta.canonical_url) : '';
    const t = thoughtsOf(n.e.text);
    const connections = connected.get(key)?.size || 0;
    const stage = n.pruned ? 'pruned' : stageOf(t.count, connections);
    // Last tended: the newest of the last change, the latest dated thought, and an
    // unsent edit (being saved right now).
    // (A plain move waiting to be sent keeps the date it had.)
    const changed = String(n.item.sha).startsWith('local:') ? n.item.keepChangedAt ?? now : changedAt(n.item);
    const lastTended = Math.max(changed || 0, t.latest || 0);
    const known = changed !== null && changed !== undefined && (changed > 0 || t.latest > 0);
    const days = known ? Math.max(0, Math.floor((now - lastTended) / DAY)) : null;
    map.set(key, {
      stage,
      health: resting || n.pruned ? null : healthOf(stage, days),
      clock: known ? 'known' : 'pending',
      type,
      status,
      resting,
      canonical,
      thoughts: t.count,
      connections,
      lastTended: known ? lastTended : 0,
      days,
      lastRead,
    });
  }
  cache = { signature, map, at: now };
  return map;
}

/** One note's growth (see garden()), or null if it isn't a note on this device. */
export async function growthOf(item) {
  return (await garden()).get(item.key) || null;
}

/**
 * How much more likely a note is to come up in the feed, from its growth: the
 * thirstier, the likelier. 0 for pruned notes (never shown).
 */
export function feedWeight(g, now = Date.now()) {
  if (!g) return 1;
  if (g.stage === 'pruned') return 0;
  const b = THRESHOLDS.boost;
  if (g.resting) return g.lastRead && now - g.lastRead > b.restingAfterDays * DAY ? b.resting : 1;
  const w = THRESHOLDS.health[g.stage];
  if (!w || g.days == null) return 1;
  const ratio = g.days / Math.max(1, w[0]);
  return ratio <= 1 ? 1 : Math.min(b.max, 1 + b.slope * (ratio - 1));
}
