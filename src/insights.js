// Insights: one note per idea, made by selecting text anywhere (a book, a PDF, a note,
// an export). And the inbox: exports from other readers and the older grouped
// Highlights/<Book>.md files, whose highlights wait as seeds until they become insights.
//
// An insight file:
//
//   ---
//   title: The best ideas arrive when you revisit…
//   date: 2026-10-11 11:54 +0100
//   source: Atomic Habits
//   tags: []
//   ---
//
//   > The best ideas arrive when you revisit what you wrote.
//   >
//   > — Atomic Habits, Chapter 3, p. 42
//   <!-- readover {"book":"gh:tope/books|Atomic Habits.epub","at":"epubcfi(…)"} -->
//
//   The thought written when it was saved, if any.
import * as store from './store.js';
import * as library from './library.js';
import { parseFrontmatter, newNotePath, newNoteText, formatGardenNoteBody, extractInsightComponents, addToSection, addRelatedLink } from './notefile.js';
import { entries } from './notes-index.js';
import { ANCHOR_RE, extractHighlights } from './markdown.js';
import { parseImport } from './imports.js';
import * as dataSync from './sync.js';

export { formatGardenNoteBody, extractInsightComponents, addToSection, addRelatedLink };


/* ---------- Where new notes go ---------- */

/** The library new notes and insights are saved to (Settings → Reading). */
export function newNotesHome() {
  const prefs = store.getPrefs();
  const sources = store.getSources();
  const pick = (id) => {
    if (!id) return null;
    if (id === library.DEVICE_ID) return library.deviceSource(false) || { id: library.DEVICE_ID, type: 'device', name: 'This device', virtual: true };
    return sources.find((s) => s.id === id && library.canWrite(s));
  };
  return (
    pick(prefs.newNotesHome) ||
    pick(prefs.highlightHome) || // the older setting, for books
    dataSync.dataHome() ||
    sources.find((s) => s.type !== 'device' && library.canWrite(s)) ||
    // The on-device notebook, without creating it just by asking.
    library.deviceSource(false) || { id: library.DEVICE_ID, type: 'device', name: 'This device', virtual: true }
  );
}
/**
 * The folder insights and clips go to (Settings → Highlights go to). Highlights/ unless
 * chosen; '' is the top level of the library.
 */
export function highlightsFolder() {
  const v = store.getPrefs().highlightsFolder;
  return v == null ? 'Highlights' : String(v).replace(/^\/+|\/+$/g, '');
}

/* ---------- Making an insight ---------- */

/** "The best ideas arrive when you revisit…": the first words of a quote. */
export function titleFromQuote(quote, words = 8) {
  const plain = String(quote || '')
    .replace(/[*_`=>#[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const all = plain.split(' ').filter(Boolean);
  const head = all.slice(0, words).join(' ').replace(/[\s,;:.!?…—–-]+$/, '');
  return all.length > words ? `${head}…` : head || 'Untitled insight';
}

/** The Markdown body of an insight: the quote, where it's from, a hidden anchor, your thought, and provenance. */
export function insightBody({ quote, attribution = '', anchor = null, thought = '', related = [], sourceTitle = '' }) {
  const lines = [];
  const cleanSource = String(sourceTitle || '').replace(/[*_`]/g, '').trim();
  const bookLink = cleanSource ? `[[${cleanSource}]]` : '';
  const locOnly = attribution.replace(new RegExp(`^${cleanSource}[,\\s]*`, 'i'), '').trim();

  // 1. Obsidian-compatible citation callout
  if (bookLink) {
    lines.push(`> [!quote]+ ${bookLink}${locOnly ? ` (${locOnly})` : ''}`);
  }
  for (const l of String(quote).trim().split(/\r?\n/)) {
    lines.push(l.trim() ? `> ${l.trim()}` : '>');
  }
  if (attribution) {
    const attr = bookLink ? `— ${bookLink}${locOnly ? `, ${locOnly}` : ''}` : `— ${attribution}`;
    lines.push('>', `> ${attr}`);
  }
  if (anchor) lines.push(`<!-- readover ${JSON.stringify(anchor)} -->`);

  const parts = [lines.join('\n')];
  const mine = String(thought || '').trim();
  if (mine) parts.push(mine);

  // 2. Deterministic Provenance section with jump-to-source deep link
  if (anchor?.book) {
    const jumpUrl = `readover://open?book=${encodeURIComponent(anchor.book)}&at=${encodeURIComponent(anchor.at || '')}`;
    const prov = [
      '## Source & Provenance',
      `- Source: ${bookLink || cleanSource || 'Book'}`,
      locOnly ? `- Location: ${locOnly}` : null,
      `- [Jump to passage in book](${jumpUrl})`,
    ].filter(Boolean);
    parts.push(prov.join('\n'));
  }

  if (related.length) {
    parts.push(`## Related\n\n${related.map((l) => `- ${l}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Save a new insight note in the new-notes library, in the highlights folder.
 * @param o { quote, sourceTitle, attribution, anchor, thought, title, tags, meta (more frontmatter), related ([[links]]) }
 * @returns { item, where, file }  `file` is "<sourceKey>|<path>", as stored on book highlights.
 */
export async function createInsight({ quote, sourceTitle = '', attribution = '', anchor = null, thought = '', title = '', tags = [], meta = {}, related = [] }) {
  if (!String(quote || '').trim()) throw new Error('Nothing selected');
  let dest = newNotesHome();
  if (dest.virtual) dest = library.deviceSource(true);
  const finalTitle = String(title || '').trim() || titleFromQuote(quote);
  // Inside the library's own folder, when it is one folder of a repo.
  const root = String(dest.root || '').replace(/^\/+|\/+$/g, '');
  const folder = [root, highlightsFolder()].filter(Boolean).join('/');
  const path = await newNotePath(folder, finalTitle.replace(/…$/, ''), async (p) => Boolean(await store.items.get(store.keyOf(dest.id, p))));

  // Highlight Metadata Contract: ensure type: highlight and deterministic coordinates
  const highlightMeta = {
    ...(sourceTitle ? { source: sourceTitle, book_title: sourceTitle } : {}),
    ...(anchor?.book ? { book_ref: anchor.book, book_format: anchor.format || (anchor.book.endsWith('.pdf') ? 'pdf' : 'epub') } : {}),
    ...(anchor?.at ? { locator: { type: anchor.format === 'pdf' ? 'pdf_page' : 'epubcfi', cfi: anchor.at, page: anchor.page, chapter: anchor.chapter } } : {}),
    ...meta,
  };
  if (!highlightMeta.type) highlightMeta.type = 'highlight';

  const text = newNoteText({
    title: finalTitle,
    tags,
    extra: highlightMeta,
    body: insightBody({ quote, attribution, anchor, thought, related, sourceTitle }),
  });
  const item = await library.writeNote(dest, path, text, { message: `Readover: new insight ${path}` });
  bump();
  return { item, where: dest.type === 'device' ? '' : library.displayName(dest), file: `${store.sourceKey(dest)}|${path}` };
}


/* ---------- The inbox ---------- */

/**
 * Is this note an inbox of highlights rather than an insight? Exports from other
 * readers, and the grouped highlight files Readover wrote before insights (they hold
 * Readover anchors but have neither `date` nor the `type` earlier insights carried).
 */
export function isInbox(text, path) {
  if (parseImport(text || '', path)) return true;
  const { meta, body } = parseFrontmatter(text || '');
  if (meta.type || meta.date) return false;
  return body.split(/\r?\n/).some((l) => ANCHOR_RE.test(l));
}

/**
 * Does this item qualify for "Make it a note"?
 * Strictly scoped to insights, highlights, and seed cards with quotes,
 * rather than appearing on ordinary plain notes.
 */
export function isInsightOrHighlight(item, note = null, rawText = '') {
  if (!item) return false;
  // Highlight cards or notes containing parsed highlights
  if (note?.highlights?.length > 0) return true;
  // Items in highlights folder
  const folder = String(item.folder || '').toLowerCase();
  if (folder === 'highlights' || folder.endsWith('/highlights')) return true;
  // Check text content for inbox or blockquotes
  const text = String(rawText || note?.body || '');
  if (isInbox(text, item.path)) return true;
  if (/<!--\s*readover\s+.*-->/i.test(text)) return true;
  if (/(?:^|\n)\s*>\s*.+/m.test(text)) return true;
  if (note?.meta?.source || note?.meta?.book) return true;
  return false;
}

const norm = (s) =>
  String(s || '')
    .replace(/[*_`=>[\]]/g, '')
    .replace(/[“”"‘’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

let version = 0;
let cache = null;
const bump = () => {
  version++;
};
if (typeof window !== 'undefined') window.addEventListener('readover:notes-changed', bump);

/**
 * Everything the inbox needs, worked out from the notes on this device:
 * quotes already turned into insights, and for each inbox file its highlights
 * with the ones still waiting (seeds).
 */
export async function inboxState() {
  const all = await entries();
  const signature = `${version}|${all.length}|${all.reduce((n, e) => n + (e.item.sha || '').length + (e.hasText ? 1 : 0), 0)}`;
  if (cache?.signature === signature) return cache;
  const quotes = [];
  const inboxes = new Map();
  for (const e of all) {
    if (!e.hasText) continue;
    const raw = (await store.content.get(e.item.key))?.text || '';
    if (isInbox(raw, e.item.path)) {
      const imported = parseImport(raw, e.item.path);
      inboxes.set(e.item.key, { item: e.item, highlights: imported ? imported.highlights : extractHighlights(parseFrontmatter(raw).body) });
    } else {
      // Quotes in your notes: blockquotes count as already taken in.
      for (const m of e.text.matchAll(/(?:^|\n)((?:\s*>.*(?:\n|$))+)/g)) {
        const lines = m[1].split('\n').map((l) => l.replace(/^\s*>\s?/, '')).filter((l) => !/^\s*(—|–|--)\s*\S/.test(l));
        const q = norm(lines.join(' '));
        if (q.length >= 12) quotes.push(q);
      }
    }
  }
  const taken = (h) => {
    const t = norm(h.text);
    return quotes.some((q) => t.includes(q) || q.includes(t));
  };
  for (const box of inboxes.values()) {
    box.seeds = box.highlights.filter((h) => !taken(h));
  }
  cache = { signature, inboxes, taken };
  return cache;
}

/** Seeds still waiting in one inbox file (all of its highlights if not known yet). */
export async function seedsOf(item) {
  const box = (await inboxState()).inboxes.get(item.key);
  return box ? box.seeds : null;
}

/** An insight (or any of your notes) that already quotes this text, or null. */
export async function findQuote(quote) {
  const q = norm(quote);
  if (q.length < 12) return null;
  for (const e of await entries()) {
    if (!e.hasText) continue;
    for (const m of e.text.matchAll(/(?:^|\n)((?:\s*>.*(?:\n|$))+)/g)) {
      const lines = m[1].split('\n').map((l) => l.replace(/^\s*>\s?/, '')).filter((l) => !/^\s*(—|–|--)\s*\S/.test(l));
      const t = norm(lines.join(' '));
      if (t.length >= 12 && (t.includes(q) || q.includes(t))) {
        const raw = (await store.content.get(e.item.key))?.text || '';
        if (!isInbox(raw, e.item.path)) return { item: e.item, title: e.title };
      }
    }
  }
  return null;
}
