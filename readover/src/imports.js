// Highlights exported by other readers. When one of these files is in a library,
// its highlights come up in the feed like any other. No device connection needed:
// put the export file anywhere in a repo or folder.
//
//   KOReader  Markdown export  (### Page 12 @ 10 October 2026 09:41:07 PM …)
//   KOReader  JSON export      ({ title, author, entries: [...] } or { documents: [...] })
//   Kindle    My Clippings.txt (entries separated by ==========)
//
// Returns { title, markdown, highlights, imported } or null for ordinary notes.

export function parseImport(raw, path) {
  const name = path.split('/').pop();
  const text = (raw || '').replace(/^﻿/, '');
  if (/\.json$/i.test(name)) return koreaderJson(text);
  if (/my clippings\.txt$/i.test(name) || /^=+\s*$/m.test(text) && /- Your (Highlight|Note)/.test(text)) return kindleClippings(text);
  if (/\.(md|markdown)$/i.test(name) && /^### Page .+ @ /m.test(text)) return koreaderMarkdown(text);
  return null;
}

const clean = (s) => (s || '').replace(/\s+\n/g, '\n').trim();
const byline = (title, author) => (author ? `${title} — ${author}` : title);
const where = (chapter, page) => [chapter, page ? `p. ${page}` : ''].filter(Boolean).join(', ');

/** Turn a list of highlights into readable Markdown for the full-note view. */
function toMarkdown(books) {
  return books
    .map((b) =>
      [
        books.length > 1 ? `## ${byline(b.title, b.author)}` : b.author ? `*${b.author}*` : '',
        ...b.highlights.map((h) => {
          const quote = h.text.split('\n').map((l) => `> ${l}`).join('\n');
          return `${quote}${h.note ? `\n>\n> — ${h.note}` : ''}${h.comment ? `\n\n${h.comment}` : ''}`;
        }),
      ]
        .filter(Boolean)
        .join('\n\n')
    )
    .join('\n\n');
}

function result(books, fallbackTitle) {
  const multi = books.length > 1;
  const highlights = books.flatMap((b) => b.highlights.map((h) => ({ ...h, source: multi ? byline(b.title, b.author) : '' })));
  if (!highlights.length) return null;
  return {
    title: multi ? fallbackTitle : books[0].title || fallbackTitle,
    markdown: toMarkdown(books),
    highlights,
    imported: true,
  };
}

/* ---------- KOReader Markdown ---------- */

const unformat = (s) =>
  s
    .replace(/^\s*(\*\*\*|\*\*|\*|__|_|==|\+\+|~~)([\s\S]*?)\1\s*$/, '$2')
    .replace(/^<u>([\s\S]*)<\/u>$/, '$1')
    .trim();

function koreaderMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const books = [];
  let book = null;
  let chapter = '';
  let entry = null;
  const flush = () => {
    if (!entry || !book) return;
    const body = entry.lines.join('\n').replace(/\n?\[View in book\]\(<[^>]*>\)\s*$/, '');
    const [hl, ...noteParts] = body.split(/\n---\n/);
    book.highlights.push({ text: unformat(clean(hl)), note: where(entry.chapter, entry.page), comment: clean(noteParts.join('\n---\n')) });
    entry = null;
  };
  for (const line of lines) {
    let m;
    if ((m = /^# (.+)$/.exec(line))) {
      flush();
      book = { title: m[1].trim(), author: '', highlights: [] };
      books.push(book);
      chapter = '';
    } else if ((m = /^##### (.+)$/.exec(line)) && book && !book.author) {
      book.author = m[1].trim() === 'N/A' ? '' : m[1].trim();
    } else if ((m = /^## (.*)$/.exec(line))) {
      flush();
      chapter = m[1].trim();
    } else if ((m = /^### Page (\S+) @ /.exec(line))) {
      flush();
      entry = { page: m[1], chapter, lines: [] };
    } else if (entry) entry.lines.push(line);
  }
  flush();
  return result(books.filter((b) => b.highlights.length), 'KOReader highlights');
}

/* ---------- KOReader JSON ---------- */

function koreaderJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const docs = Array.isArray(data.documents) ? data.documents : data.entries ? [data] : [];
  const books = docs.map((d) => ({
    title: d.title || 'Untitled',
    author: d.author || '',
    highlights: (d.entries || [])
      .filter((e) => e.text)
      .map((e) => ({ text: clean(e.text), note: where(e.chapter, e.page), comment: clean(e.note) })),
  }));
  return result(books.filter((b) => b.highlights.length), 'KOReader highlights');
}

/* ---------- Kindle My Clippings.txt ---------- */

function kindleClippings(text) {
  const books = new Map();
  const seen = new Set();
  for (const chunk of text.split(/^=+\s*$/m)) {
    const lines = chunk.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim());
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length < 3) continue;
    const head = lines[0].replace(/^﻿/, '');
    const meta = lines[1];
    const body = clean(lines.slice(2).join('\n'));
    const m = /^(.*?)(?:\s*\(([^()]*)\))?$/.exec(head);
    const title = m[1].trim();
    const author = (m[2] || '').trim();
    const page = /page (\S+)/i.exec(meta)?.[1] || '';
    const loc = /location (\d+)(?:-(\d+))?/i.exec(meta);
    const key = byline(title, author);
    if (!books.has(key)) books.set(key, { title, author, highlights: [] });
    const book = books.get(key);
    if (/your highlight/i.test(meta) && body) {
      if (seen.has(`${key}|${body}`)) continue;
      seen.add(`${key}|${body}`);
      book.highlights.push({ text: body, note: page ? `p. ${page}` : loc ? `location ${loc[1]}` : '', end: Number(loc?.[2] || loc?.[1] || 0) });
    } else if (/your note/i.test(meta) && body) {
      // A note belongs to the highlight that ends where it sits.
      const at = Number(loc?.[1] || 0);
      const target = [...book.highlights].reverse().find((h) => !at || h.end === at || Math.abs(h.end - at) <= 1) || book.highlights[book.highlights.length - 1];
      if (target) target.comment = target.comment ? `${target.comment}\n\n${body}` : body;
    }
  }
  const list = [...books.values()].filter((b) => b.highlights.length);
  for (const b of list) for (const h of b.highlights) delete h.end;
  return result(list, 'Kindle highlights');
}
