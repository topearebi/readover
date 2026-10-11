// The shape of a note file: frontmatter, file name, title and type.
//
// New notes are named `YYYY-MM-DD-title-words.md` (the name never changes after
// creation, so links stay stable) and start with Jekyll-compatible frontmatter:
//
//   ---
//   title: This is a note
//   date: 2026-12-30 10:57 +0000
//   tags: []
//   ---
//
// A note's type is its top-level folder (Journal/, Essays/, …); notes at the top level
// are unsorted. `status: done` marks a note as finished. Notes that don't follow this
// are read as they are; nothing is renamed.

/* ---------- Frontmatter ---------- */

const FENCE = /^(---|\+\+\+)[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?\1[ \t]*(?:\r?\n|$)/;

/** Split a note into { meta, body }. Values are strings, or arrays for lists. */
export function parseFrontmatter(raw) {
  const text = (raw || '').replace(/^﻿/, '');
  const m = FENCE.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = m[1] === '+++' ? parseToml(m[2] || '') : parseYaml(m[2] || '');
  return { meta, body: text.slice(m[0].length).trim() };
}

/** A small YAML subset: scalars, quoted strings, inline and block lists, block text. */
function parseYaml(src) {
  const meta = {};
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue; // nested content is skipped
    const kv = /^("[^"]*"|'[^']*'|[^:#\s][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].replace(/^["']|["']$/g, '').trim().toLowerCase();
    const rest = (kv[2] || '').trim();
    if (!rest || /^#/.test(rest)) {
      // Either a block list or an empty value.
      const items = [];
      while (i + 1 < lines.length && (/^\s*-(\s|$)/.test(lines[i + 1]) || (!lines[i + 1].trim() && /^\s*-/.test(lines[i + 2] || '')))) {
        i++;
        if (!lines[i].trim()) continue;
        const v = scalar(lines[i].replace(/^\s*-\s?/, ''));
        if (v !== '') items.push(v);
      }
      meta[key] = items.length ? items : '';
    } else if (/^[|>][+-]?$/.test(rest)) {
      // Block text: the indented lines that follow.
      const out = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) out.push(lines[++i].trim());
      while (out.length && !out[out.length - 1]) out.pop();
      meta[key] = rest.startsWith('|') ? out.join('\n') : out.join(' ').replace(/\s+/g, ' ');
    } else if (/^\[.*\]$/.test(rest)) {
      meta[key] = splitInline(rest.slice(1, -1)).map(scalar).filter((v) => v !== '');
    } else {
      meta[key] = scalar(rest);
    }
  }
  return meta;
}

function parseToml(src) {
  const meta = {};
  for (const line of src.split(/\r?\n/)) {
    const kv = /^\s*([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1].toLowerCase()] = /^\[.*\]$/.test(v) ? splitInline(v.slice(1, -1)).map(scalar).filter(Boolean) : scalar(v);
  }
  return meta;
}

function scalar(v) {
  v = v.trim();
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    try {
      return JSON.parse(end > 0 ? v.slice(0, end + 1) : `${v}"`);
    } catch {
      return v.slice(1, end > 0 ? end : undefined);
    }
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    return v.slice(1, end > 0 ? end : undefined).replace(/''/g, "'");
  }
  return v.replace(/\s+#.*$/, '').trim(); // a trailing comment
}

function splitInline(s) {
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Write a value the way YAML (and Jekyll) will read it back as the same string. */
function yamlValue(v, { bare = false } = {}) {
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(String(x))).join(', ')}]`;
  const s = String(v ?? '');
  if (bare) return s;
  const risky =
    s === '' ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /:(\s|$)|\s#|[\n\r\t]/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(s) ||
    /^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

const BARE_KEYS = new Set(['date']); // dates stay unquoted, so Jekyll reads them as dates

/** Frontmatter text for an object (keys in the given order; empty values skipped). */
export function buildFrontmatter(obj) {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'string' && v === ''))
    .map(([k, v]) => `${k}: ${yamlValue(v, { bare: BARE_KEYS.has(k) })}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Change some frontmatter keys, leaving the rest of the file exactly as it was.
 * A value of null removes the key. Adds a frontmatter block if there isn't one.
 */
export function updateFrontmatter(raw, patch) {
  const text = raw || '';
  const m = /^(---)[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) {
    const add = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
    return Object.keys(add).length ? `${buildFrontmatter(add)}\n${text.replace(/^\s+/, '')}` : text;
  }
  const lines = (m[2] || '').split(/\r?\n/);
  for (const [key, value] of Object.entries(patch)) {
    const at = lines.findIndex((l) => new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`, 'i').test(l));
    let end = at + 1;
    if (at >= 0) while (end < lines.length && (/^\s/.test(lines[end]) || /^-(\s|$)/.test(lines[end]))) end++;
    const next = value === null || value === undefined ? [] : [`${key}: ${yamlValue(value, { bare: BARE_KEYS.has(key) })}`];
    if (at >= 0) lines.splice(at, end - at, ...next);
    else lines.push(...next);
  }
  const block = lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n');
  return `---\n${block}${block ? '\n' : ''}---\n${text.slice(m[0].length)}`;
}

/* ---------- Dates and file names ---------- */

const pad = (n) => String(n).padStart(2, '0');
const DATE_PREFIX = /^((?:19|20)\d\d)-(\d\d)-(\d\d)(?:[-_ ]+|$)/;

export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `2026-12-30 10:57 +0000`, in local time: what Jekyll reads as the post's date. */
export function frontmatterDate(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${isoDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())} ${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
}

/** "This is a Note!" → "this-is-a-note". */
export function slugify(text, max = 60) {
  let s = String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > max) s = s.slice(0, max).replace(/-[^-]*$/, '') || s.slice(0, max);
  return s || 'note';
}

/** A typed title may start with a date: "2026-12-30 My note" → { day, title: "My note" }. */
export function splitDatedTitle(title) {
  const t = String(title || '').trim();
  const m = DATE_PREFIX.exec(t);
  return m ? { day: `${m[1]}-${m[2]}-${m[3]}`, title: t.slice(m[0].length).trim() } : { day: '', title: t };
}

/**
 * The path for a new note: `<folder>/YYYY-MM-DD-title-words.md`. `exists(path)` says
 * whether a path is taken; a clash (same day and title) adds -2, -3…
 */
export async function newNotePath(folder, title, exists, now = new Date()) {
  const { day, title: rest } = splitDatedTitle(title);
  const base = `${day || isoDay(now)}-${slugify(rest || title)}`;
  const dir = String(folder || '').replace(/^\/+|\/+$/g, '');
  const at = (name) => (dir ? `${dir}/${name}.md` : `${name}.md`);
  let path = at(base);
  for (let n = 2; await exists(path); n++) path = at(`${base}-${n}`);
  return path;
}

/** The text of a new note. */
export function newNoteText({ title = '', body = '', date = new Date(), status = '', tags = [], extra = {} }) {
  const clean = splitDatedTitle(title).title || String(title || '').trim() || titleFromText(body);
  const fm = buildFrontmatter({ title: clean, date: frontmatterDate(date), status: status || undefined, ...extra, tags: parseTagList(tags) });
  return `${fm}\n${String(body).trim()}\n`;
}

/** "a, #b  c" → ['a', 'b', 'c'] (tags as typed in a one-line field). */
export function parseTagList(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/);
  return [...new Set(list.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))];
}

/** A title from a note's first words, for notes saved without one. */
export function titleFromText(text, words = 8) {
  const plain = String(text || '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/[*_`=>#[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const all = plain.split(' ').filter(Boolean);
  const head = all.slice(0, words).join(' ').replace(/[\s,;:.!?…—–-]+$/, '');
  return all.length > words ? `${head}…` : head;
}

/* ---------- Titles ---------- */

/** A readable title from a file name: "2026-12-30-this-is-a-note.md" → "This is a note". */
export function titleFromPath(path) {
  const name = String(path || '').split('/').pop().replace(/\.(md|markdown|txt|json)$/i, '');
  let t = name.replace(DATE_PREFIX, '').replace(/^\d{12,14}[-_ ]+/, '');
  if (!t) return name;
  if (/[-_]/.test(t) && !/\s/.test(t)) {
    t = t.replace(/[-_]+/g, ' ').trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

/** Title, in order: frontmatter title, the first # heading, the file name. */
export function resolveTitle(meta, body, path) {
  const fm = Array.isArray(meta?.title) ? meta.title.join(' ') : meta?.title;
  if (fm && String(fm).trim()) return String(fm).trim();
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(body || '');
  if (h1) return h1[1].trim();
  return titleFromPath(path);
}

/* ---------- Types and status ---------- */

/** Pruned notes live here; it isn't a type. */
export const ARCHIVE_FOLDER = 'Archive';
const DONE = ['done', 'submitted', 'published'];

/** A note's type: its top-level folder within its library ('' = unsorted, at the top level). */
export function typeOf(path, root = '') {
  const r = String(root || '').replace(/^\/+|\/+$/g, '');
  const rel = r && path.startsWith(`${r}/`) ? path.slice(r.length + 1) : path;
  const i = rel.indexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

/** Is the note finished? `status: done` (earlier versions also wrote submitted/published). */
export function isDone(meta) {
  const v = Array.isArray(meta?.status) ? meta.status[0] : meta?.status;
  return DONE.includes(String(v || '').trim().toLowerCase());
}

/** Your own words in a note: everything except quotes, headings, code and markup. */
export function ownWords(body) {
  const text = String(body || '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/\r?\n/)
    // Quotes, headings and "— Source" lines aren't your words.
    .filter((l) => !/^\s*>/.test(l) && !/^\s*#{1,6}\s/.test(l) && !/^\s*(—|–|--)\s*\S/.test(l))
    .join(' ')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`=~>#|-]+/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/* ---------- Links ---------- */

/** How Readover writes a link: [[file-name|Title]], or [[name]] when they match. */
export function wikiLink(path, title) {
  const name = String(path).split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
  const t = String(title || '').replace(/[[\]|]/g, '').trim();
  return !t || t.toLowerCase() === name.toLowerCase() ? `[[${name}]]` : `[[${name}|${t}]]`;
}

/** Apply exact substitutions [[from, to], …] to a text (link updates, see relink.js). */
export function applySubs(text, subs = []) {
  let out = String(text ?? '');
  for (const [from, to] of subs) out = out.split(from).join(to);
  return out;
}

/**
 * The file name (without extension) a note gets when renamed to `title`: dated names
 * keep their date ("2026-01-04-" + the title's words); others stay plain words.
 */
export function renamedStem(oldPath, title) {
  const stem = String(oldPath).split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
  const m = DATE_PREFIX.exec(stem);
  const t = splitDatedTitle(title).title || String(title || '').trim();
  if (m) return `${m[1]}-${m[2]}-${m[3]}-${slugify(t)}`;
  return t.replace(/[\\/:*?"<>|#^[\]]+/g, '').replace(/\s+/g, ' ').trim() || stem;
}
