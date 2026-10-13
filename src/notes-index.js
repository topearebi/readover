// An index of your notes, built on the device from the copies already downloaded:
// titles, links between notes, backlinks and full-text search. Notes that haven't
// been downloaded yet are still found by title; "Download all" fills in the rest.
import * as store from './store.js';
import { readText } from './library.js';
import { parseFrontmatter, resolveTitle, titleFromPath } from './notefile.js';

const cache = new Map(); // key -> { sha, entry }
window.addEventListener('readover:notes-changed', () => cache.clear());

const base = (path) => path.split('/').pop().replace(/\.(md|markdown|txt|json)$/i, '');
const low = (s) => s.toLowerCase().trim();

function parseEntry(item, text) {
  const { meta, body } = parseFrontmatter(text || '');
  // Without the text, the file name is the best title there is.
  const title = (text == null ? titleFromPath(item.path) : resolveTitle(meta, body, item.path)).replace(/[*_`]/g, '');
  const rawAliases = meta.aliases || meta.alias || '';
  const aliases = (Array.isArray(rawAliases) ? rawAliases : String(rawAliases).replace(/[[\]]/g, '').split(','))
    .map((a) => String(a).replace(/[[\]]/g, '').trim())
    .filter(Boolean);
  const links = [];
  for (const m of body.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) links.push({ wiki: m[1].trim(), at: m.index });
  for (const m of body.matchAll(/\[[^\]]*\]\(<?([^)\s>]+\.(?:md|markdown))(?:#[^)]*)?>?\)/gi)) {
    if (!/^[a-z]+:/i.test(m[1])) links.push({ href: decodeURI(m[1]), at: m.index });
  }
  return { item, title, aliases, meta, text: body, lower: body.toLowerCase(), links, hasText: text != null };
}

/** All notes (not books), with whatever text is on the device. */
export async function entries() {
  const notes = (await store.items.all()).filter((i) => i.kind === 'note' && store.getSource(i.sourceId));
  const out = [];
  for (const item of notes) {
    const hit = cache.get(item.key);
    if (hit && hit.sha === item.sha) {
      out.push(hit.entry);
      continue;
    }
    const c = await store.content.get(item.key);
    // An older copy is still searchable, but it's marked stale so it gets refreshed.
    const entry = parseEntry(item, c && c.sha === item.sha ? c.text : c?.text ?? null);
    entry.stale = Boolean(c && c.sha !== item.sha);
    if (c) cache.set(item.key, { sha: item.sha, entry });
    out.push(entry);
  }
  return out;
}

/** How much of the library can be searched in full. */
export async function coverage() {
  const all = await entries();
  return { total: all.length, withText: all.filter((e) => e.hasText).length };
}

/** Download every note not yet on the device (in one library, if given), a few at a time. */
export async function downloadAll(onProgress = () => {}, { sourceId = null } = {}) {
  const missing = (await entries()).filter((e) => (!e.hasText || e.stale) && (!sourceId || e.item.sourceId === sourceId)).map((e) => e.item);
  let done = 0;
  const worker = async () => {
    while (missing.length) {
      const item = missing.shift();
      try {
        await readText(item);
      } catch {}
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  cache.clear();
  return done;
}

/* ---------- Links ---------- */

/** Resolve a link written in `from` to a note on this device, or null. */
export function resolve(link, from, all) {
  if (link.href) {
    const parts = from.item.folder ? from.item.folder.split('/') : [];
    for (const seg of link.href.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const path = parts.join('/');
    return all.find((e) => e.item.sourceId === from.item.sourceId && e.item.path === path) || null;
  }
  const target = low(link.wiki).replace(/\.(md|markdown)$/i, '');
  const matches = all.filter((e) => {
    const p = low(e.item.path).replace(/\.(md|markdown|txt)$/i, '');
    return low(base(e.item.path)) === target || p === target || p.endsWith(`/${target}`) || low(e.title) === target || e.aliases.some((a) => low(a) === target);
  });
  if (!matches.length) return null;
  // Prefer the same library, then the shortest path (closest to the top).
  matches.sort((a, b) => (a.item.sourceId === from.item.sourceId ? -1 : 0) - (b.item.sourceId === from.item.sourceId ? -1 : 0) || a.item.path.length - b.item.path.length);
  return matches[0];
}

/** Find a note by a [[wiki link]] target, for opening links from the reader. */
export async function findByLink(target, fromItem) {
  const all = await entries();
  const from = all.find((e) => e.item.key === fromItem.key) || { item: fromItem };
  return resolve(target.endsWith('.md') && target.includes('/') ? { href: target } : { wiki: target }, from, all)?.item || null;
}

/** Notes that link to this one, with the line the link sits on. */
export async function backlinks(item) {
  const all = await entries();
  const out = [];
  for (const e of all) {
    if (e.item.key === item.key) continue;
    for (const link of e.links) {
      if (resolve(link, e, all)?.item.key !== item.key) continue;
      const start = e.text.lastIndexOf('\n', link.at) + 1;
      const end = e.text.indexOf('\n', link.at);
      out.push({ item: e.item, title: e.title, context: e.text.slice(start, end < 0 ? undefined : end).trim() });
      break;
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Notes that this note links to, resolved with target item, title, and excerpt. */
export async function outgoing(item) {
  const all = await entries();
  const me = all.find((e) => e.item.key === item.key);
  if (!me || !me.links?.length) return [];
  const out = [];
  const seen = new Set();
  for (const link of me.links) {
    const target = resolve(link, me, all);
    if (!target || target.item.key === item.key || seen.has(target.item.key)) continue;
    seen.add(target.item.key);
    out.push({
      item: target.item,
      title: target.title,
      excerpt: excerptOf(target.text, 140),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Full bidirectional link model: outgoing links, incoming backlinks, and mutual detection. */
export async function connections(item) {
  const [out, inLinks] = await Promise.all([outgoing(item), backlinks(item)]);
  const outKeys = new Set(out.map((x) => x.item.key));
  const inKeys = new Set(inLinks.map((x) => x.item.key));
  const mutual = new Set([...outKeys].filter((k) => inKeys.has(k)));

  return {
    outgoing: out.map((x) => ({ ...x, isMutual: mutual.has(x.item.key) })),
    backlinks: inLinks.map((x) => ({ ...x, isMutual: mutual.has(x.item.key) })),
    mutualKeys: mutual,
  };
}

/** Notes with the highest number of backlinks for Hub cards in the feed. */
export async function hubNotes({ minBacklinks = 2, limit = 10 } = {}) {
  const all = (await entries()).filter((e) => e.hasText);
  const backlinkMap = new Map(); // targetKey -> list of { item, title, context }

  for (const e of all) {
    for (const link of e.links) {
      const target = resolve(link, e, all);
      if (!target || target.item.key === e.item.key) continue;
      const list = backlinkMap.get(target.item.key) || [];
      const start = e.text.lastIndexOf('\n', link.at) + 1;
      const end = e.text.indexOf('\n', link.at);
      list.push({ item: e.item, title: e.title, context: e.text.slice(start, end < 0 ? undefined : end).trim() });
      backlinkMap.set(target.item.key, list);
    }
  }

  const hubs = [];
  for (const [key, list] of backlinkMap.entries()) {
    if (list.length < minBacklinks) continue;
    const entry = all.find((e) => e.item.key === key);
    if (!entry) continue;
    hubs.push({
      item: entry.item,
      title: entry.title,
      excerpt: excerptOf(entry.text, 160),
      count: list.length,
      links: list.slice(0, 3),
    });
  }
  return hubs.sort((a, b) => b.count - a.count).slice(0, limit);
}

/* ---------- Search ---------- */

/** Every word must appear in the title, path or text. Title matches rank first. */
export async function search(query, { limit = 60 } = {}) {
  const terms = low(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const e of await entries()) {
    const head = low(`${e.title} ${e.item.path}`);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inHead = head.includes(t);
      const inText = e.lower.includes(t);
      if (!inHead && !inText) {
        ok = false;
        break;
      }
      score += (inHead ? 10 : 0) + (inText ? 1 + Math.min(5, e.lower.split(t).length - 2) : 0);
    }
    if (!ok) continue;
    let snippet = '';
    // Show the words around the first match in the body (not the title line).
    const body = e.text.replace(/^\s*#\s.*$/m, '');
    const at = body.toLowerCase().indexOf(terms[0]);
    if (at >= 0) {
      const from = Math.max(0, body.lastIndexOf(' ', Math.max(0, at - 60)));
      const raw = excerptOf(body.slice(from, at + 160), 220);
      snippet = `${from > 0 ? '…' : ''}${raw}…`;
    } else {
      snippet = excerptOf(body, 140);
    }
    results.push({ item: e.item, title: e.title, snippet, score });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/* ---------- Related notes ---------- */

const STOP = new Set(
  'about above after again against also among because been before being below between both could does doing down during each from further have having here herself himself into itself just like more most myself only other ought ours over same should some such than that their them themselves then there these they this those through under until very were what when where which while whom will with would your yours really thing things into make made much many even still well every never always something someone'.split(' ')
);
const words = (text) =>
  text
    .toLowerCase()
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ')
    .match(/[\p{L}][\p{L}'-]{3,}/gu)
    ?.filter((w) => !STOP.has(w)) || [];
const vectors = new Map(); // key -> { sha, tf: Map, norm }

function vectorOf(e, idf) {
  let v = vectors.get(e.item.key);
  if (!v || v.sha !== e.item.sha) {
    const tf = new Map();
    // Titles say the most about a note, so their words count three times.
    for (const w of [...words(e.title), ...words(e.title), ...words(e.title), ...words(e.text)]) tf.set(w, (tf.get(w) || 0) + 1);
    v = { sha: e.item.sha, tf };
    vectors.set(e.item.key, v);
  }
  const weighted = new Map();
  let norm = 0;
  for (const [w, n] of v.tf) {
    const x = (1 + Math.log(n)) * (idf.get(w) || 0);
    weighted.set(w, x);
    norm += x * x;
  }
  return { weighted, norm: Math.sqrt(norm) || 1 };
}

/**
 * Notes about similar things to this one, by the words they share (rarer words count
 * more). Works on notes downloaded to this device. Returns [{ item, title, score, shared }].
 */
export async function related(item, { limit = 12 } = {}) {
  const all = (await entries()).filter((e) => e.hasText);
  const self = all.find((e) => e.item.key === item.key);
  if (!self || all.length < 2) return [];
  const df = new Map();
  for (const e of all) {
    for (const w of new Set([...words(e.title), ...words(e.text)])) df.set(w, (df.get(w) || 0) + 1);
  }
  const idf = new Map();
  for (const [w, n] of df) if (n < all.length) idf.set(w, Math.log(all.length / n));
  const me = vectorOf(self, idf);
  const out = [];
  for (const e of all) {
    if (e.item.key === item.key) continue;
    const v = vectorOf(e, idf);
    let dot = 0;
    const shared = [];
    for (const [w, x] of me.weighted) {
      const y = v.weighted.get(w);
      if (y) {
        dot += x * y;
        shared.push([w, x * y]);
      }
    }
    const score = dot / (me.norm * v.norm);
    if (score > 0.04) out.push({ item: e.item, title: e.title, score, shared: shared.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The first lines of a note's text, without headings or markup, for previews. */
export function excerptOf(text, length = 220) {
  return (text || '')
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#.*$/gm, '')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`=]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);
}

/** Pairs of notes where one links to the other (for "Connected" cards). */
export async function linkedPairs() {
  const all = (await entries()).filter((e) => e.hasText);
  const excerpt = (e) =>
    e.text
      .replace(/^#.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t)
      .replace(/[#>*_`=]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  const pairs = [];
  const seen = new Set();
  for (const e of all) {
    for (const link of e.links) {
      const t = resolve(link, e, all);
      if (!t || t.item.key === e.item.key || !t.hasText) continue;
      const id = [e.item.key, t.item.key].sort().join('↔');
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push({ a: { item: e.item, title: e.title, excerpt: excerpt(e) }, b: { item: t.item, title: t.title, excerpt: excerpt(t) } });
    }
  }
  return pairs;
}
