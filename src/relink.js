// Renaming a note without breaking links. Works out every link in the library that
// points at the note (exactly: a same-named note elsewhere is never touched), and the
// text each one should become. The result is a list of exact string substitutions per
// note, so it can be re-applied later to a newer copy of a note (the save queue does
// this if a note changed elsewhere before the rename was sent).
//
// Rewritten: [[name]], [[name|alias]], [[name#heading]], ![[name]], [[Folder/name]],
// and Markdown links [text](../Folder/name.md). Links by title are rewritten only when
// the title changes; links by alias are left alone (aliases don't change).
import { entries, resolve } from './notes-index.js';
import * as store from './store.js';
import { parseFrontmatter, resolveTitle, titleFromPath, applySubs } from './notefile.js';

export { applySubs };

const WIKI = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]+)?\]\]/g;
const MD = /(\[[^\]]*\]\()(<?)([^)\s>]+\.(?:md|markdown))(#[^)]*)?(>?)\)/gi;
const low = (s) => String(s || '').toLowerCase().trim();
const stemOf = (path) => path.split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
const noExt = (path) => path.replace(/\.(md|markdown|txt)$/i, '');
const folderOf = (path) => path.split('/').slice(0, -1).join('/');

/** A relative link from a note in `fromFolder` to `toPath`, e.g. "../Ideas/note.md". */
export function relativePath(fromFolder, toPath) {
  const a = fromFolder ? fromFolder.split('/') : [];
  const b = toPath.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}


/** How a [[target]] matches the note: 'path', 'stem', 'title', 'alias' or ''. */
function matchKind(target, e) {
  const t = low(target).replace(/\.(md|markdown)$/i, '');
  const p = low(noExt(e.item.path));
  if (t.includes('/') && (p === t || p.endsWith(`/${t}`))) return 'path';
  if (low(stemOf(e.item.path)) === t) return 'stem';
  if (low(e.title) === t) return 'title';
  if (e.aliases.some((a) => low(a) === t)) return 'alias';
  return '';
}

function hrefFor(original, wrapped, rel) {
  if (wrapped) return rel;
  return /%/.test(original) || /\s/.test(rel) ? encodeURI(rel) : rel;
}

/**
 * What renaming/moving `item` to `newPath` (and retitling it `newTitle`) changes.
 * Only notes on this device are checked: download the library first.
 * @returns {
 *   self: { subs, fmPatch },        changes to the note itself (title and its own links)
 *   edits: [{ item, title, subs, count }],  other notes in the library whose links change
 *   count, notes,                   links and notes updated
 *   elsewhere                       links to it from other libraries (not rewritten)
 *   unchecked                       notes in the library not on this device (not checked)
 * }
 */
export async function planRename(item, { newPath, newTitle }) {
  const all = await entries();
  const target = all.find((e) => e.item.key === item.key);
  if (!target) throw new Error('This note isn’t on this device yet.');
  const root = String(store.getSource(item.sourceId)?.root || '').replace(/^\/+|\/+$/g, '');
  const oldTitle = target.title;
  const titleChanged = Boolean(newTitle) && newTitle.trim() !== oldTitle;
  const moved = newPath !== item.path;
  const newStem = stemOf(newPath);
  const newRel = noExt(root && newPath.startsWith(`${root}/`) ? newPath.slice(root.length + 1) : newPath);
  const edits = [];
  let elsewhere = 0;
  // Notes in the library that couldn't be downloaded can't be checked for links.
  const unchecked = all.filter((e) => !e.hasText && e.item.sourceId === item.sourceId).length;
  let selfSubs = [];

  for (const e of all) {
    if (!e.hasText) continue;
    const isSelf = e.item.key === item.key;
    const sameLib = e.item.sourceId === item.sourceId;
    const subs = new Map();
    let count = 0;
    const raw = e.text; // the body: links in frontmatter aren't followed anyway
    // Wiki links.
    for (const m of raw.matchAll(WIKI)) {
      const [whole, bang, t, heading = '', alias = ''] = m;
      const hit = resolve({ wiki: t.trim() }, e, all);
      if (hit?.item.key !== item.key) continue;
      if (!sameLib) {
        elsewhere++;
        continue;
      }
      const kind = matchKind(t.trim(), target);
      let next = null;
      if (kind === 'path' || kind === 'stem') {
        const ext = /\.(md|markdown)$/i.exec(t.trim())?.[0] || '';
        next = `${kind === 'path' ? newRel : newStem}${ext}`;
      } else if (kind === 'title' && titleChanged) {
        next = newStem;
      }
      if (next == null) continue;
      // A link by title keeps showing the words it showed; a label that was just the
      // old title (as Readover writes them) shows the new one.
      let label = alias || (kind === 'title' ? `|${t.trim()}` : '');
      if (titleChanged && alias && low(alias.slice(1)) === low(oldTitle)) label = `|${newTitle.trim()}`;
      const replacement = `${bang}[[${next}${heading}${label}]]`;
      if (replacement !== whole) {
        subs.set(whole, replacement);
        count++;
      }
    }
    // Markdown links, relative to the note they're in. The note being moved also
    // has its own relative links recomputed from its new folder.
    if (sameLib && (moved || isSelf)) {
      for (const m of raw.matchAll(MD)) {
        const [whole, open, lt, href, frag = '', gt] = m;
        if (/^[a-z]+:/i.test(href)) continue;
        let decoded = href;
        try {
          decoded = decodeURI(href);
        } catch {}
        const hit = resolve({ href: decoded }, e, all);
        if (!hit) continue;
        const pointsHere = hit.item.key === item.key;
        if (!pointsHere && !(isSelf && moved)) continue;
        const from = isSelf ? folderOf(newPath) : e.item.folder;
        const to = pointsHere ? newPath : hit.item.path;
        const replacement = `${open}${lt}${hrefFor(href, lt, relativePath(from, to))}${frag}${gt})`;
        if (replacement !== whole) {
          subs.set(whole, replacement);
          if (pointsHere) count++;
        }
      }
    }
    if (isSelf) selfSubs = [...subs];
    else if (subs.size) edits.push({ item: e.item, title: e.title, subs: [...subs], count });
  }

  // The new title: wherever the old one came from.
  let fmPatch = null;
  if (titleChanged) {
    const raw = (await store.content.get(item.key))?.text ?? '';
    const { meta, body } = parseFrontmatter(raw);
    const h1 = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
    if (meta.title) fmPatch = { title: newTitle.trim() };
    else if (h1 && resolveTitle(meta, body, item.path).replace(/[*_`]/g, '') === oldTitle) selfSubs.push([h1[0], `# ${newTitle.trim()}`]);
    else if (titleFromPath(newPath) !== newTitle.trim()) fmPatch = { title: newTitle.trim() };
  }
  return {
    self: { subs: selfSubs, fmPatch },
    edits,
    count: edits.reduce((n, x) => n + x.count, 0),
    notes: edits.length,
    elsewhere,
    unchecked,
  };
}
