// Markdown → card model. Rendering is sanitised: notes can come from any repo,
// and the GitHub token lives in this origin's storage.
import { Marked } from '../vendor/marked-15.0.12/marked.esm.js';
import DOMPurify from '../vendor/dompurify-3.2.6/purify.es.mjs';
import { parseImport } from './imports.js';

const marked = new Marked({ gfm: true, breaks: true });

// ==highlight== (Obsidian) → <mark>, [[Wiki link|alias]] → styled text.
marked.use({
  extensions: [
    {
      name: 'mark',
      level: 'inline',
      start: (src) => src.indexOf('=='),
      tokenizer(src) {
        const m = /^==(?!\s)([^=\n]+?)==/.exec(src);
        if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
      },
    },
    {
      name: 'wikilink',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenizer(src) {
        const m = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), text: (m[2] || m[1]).trim() };
      },
      renderer(token) {
        // Opened in-app by the reader (it resolves the target to a note).
        return `<a class="wikilink" role="link" tabindex="0" data-wikilink="${escapeHtml(token.target)}">${escapeHtml(token.text)}</a>`;
      },
    },
  ],
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ''), { FORBID_TAGS: ['style', 'form', 'input'] });
}

export function splitFrontmatter(raw) {
  const text = (raw || '').replace(/^﻿/, '');
  const m = /^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[2].split(/\r?\n/)) {
    const i = line.search(/[:=]/);
    if (i > 0 && !/^\s/.test(line)) {
      meta[line.slice(0, i).trim().toLowerCase()] = line
        .slice(i + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

const stripExt = (name) => name.replace(/\.(md|markdown|txt)$/i, '');

/**
 * Highlights are what get surfaced on their own, Readwise-style:
 *  - blockquotes (incl. Obsidian callouts)
 *  - ==marked== passages
 *  - list items under a "Highlights" heading (Readwise / Kindle exports)
 */
/** `<!-- readover {"book":"…","at":"…"} -->`: where a highlight sits in its book. */
export const ANCHOR_RE = /^\s*<!--\s*readover\s+(\{.*\})\s*-->\s*$/;

export function extractHighlights(body) {
  const out = [];
  const seen = new Set();
  const add = (text, note = '', extra = {}) => {
    const clean = text.trim();
    const plain = clean.replace(/[*_`>#\[\]()]/g, '').trim();
    if (plain.length < 24 || plain.length > 1400 || seen.has(plain)) return;
    seen.add(plain);
    out.push({ text: clean, note: note.trim(), ...extra });
  };

  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
  const lines = noCode.split(/\r?\n/);

  // Blockquotes, optionally followed by a readover anchor and your own note.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*>/.test(lines[i])) continue;
    const buf = [];
    while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
    const parts = buf.join('\n').replace(/^\s*\[![^\]]+\][+-]?.*(\n|$)/, '').split('\n'); // drop callout header
    let note = '';
    const last = parts[parts.length - 1]?.trim() || '';
    if (/^(—|--|–)\s*\S/.test(last) && parts.length > 1) {
      note = last.replace(/^(—|--|–)\s*/, ''); // "— Chapter, p. 12" becomes the attribution
      parts.pop();
    }
    const extra = {};
    const anchor = ANCHOR_RE.exec(lines[i] || '');
    if (anchor) {
      try {
        extra.at = JSON.parse(anchor[1]);
      } catch {}
      i++;
      // Your note: the paragraphs that follow, up to the next quote or heading.
      const mine = [];
      while (i < lines.length && !/^\s*(>|#)/.test(lines[i]) && !ANCHOR_RE.test(lines[i])) mine.push(lines[i++]);
      const comment = mine.join('\n').trim();
      if (comment) extra.comment = comment;
    }
    i--;
    add(parts.join('\n').trim(), note, extra);
  }

  // ==marks==
  // Marked passages are often mid-sentence: show them as fragments.
  for (const m of noCode.matchAll(/==(?!\s)([^=\n]{20,}?)==/g)) {
    const t = m[1].trim();
    add(`${/^[a-z]/.test(t) ? '…' : ''}${t}${/[.!?…"”')]$/.test(t) ? '' : '…'}`);
  }

  // Lists under a Highlights heading
  let inSection = false;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      inSection = /highlight|quote|excerpt|clipping/i.test(h[2]);
      continue;
    }
    if (!inSection) continue;
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) add(li[1].replace(/\s*\(\[(Location|Page)[^\]]*\]\([^)]*\)\)\s*$/i, ''));
  }
  return out;
}

export function parseNote(raw, path) {
  const imported = parseImport(raw, path);
  if (imported) {
    // An export from another reader: always shown as single highlights.
    return {
      title: imported.title,
      meta: {},
      body: imported.markdown,
      html: renderMarkdown(imported.markdown),
      words: imported.markdown.split(/\s+/).length,
      minutes: Math.max(1, Math.round(imported.markdown.split(/\s+/).length / 220)),
      highlights: imported.highlights,
      tags: [],
      imported: true,
    };
  }
  const { meta, body: withAnchors } = splitFrontmatter(raw);
  const body = withAnchors.split(/\r?\n/).filter((l) => !ANCHOR_RE.test(l)).join('\n');
  const filename = stripExt(path.split('/').pop());
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  const title = meta.title || (h1 ? h1[1] : filename);
  let main = body;
  if (h1 && body.trimStart().startsWith(h1[0])) main = body.trimStart().slice(h1[0].length).trim();

  const words = main.split(/\s+/).filter(Boolean).length;
  const isPlain = /\.txt$/i.test(path);
  // A saved web article: its quotes aren't your highlights (those go to Highlights/).
  const article = /^https?:\/\//i.test(meta.source || '');
  return {
    title: title.replace(/[*_`]/g, ''),
    meta,
    body: main,
    html: isPlain ? `<pre class="plain">${escapeHtml(main)}</pre>` : renderMarkdown(main),
    words,
    minutes: Math.max(1, Math.round(words / 220)),
    highlights: isPlain || article ? [] : extractHighlights(withAnchors),
    tags: parseTags(meta.tags, main),
    article,
  };
}

function parseTags(metaTags, body) {
  const tags = new Set();
  if (metaTags) metaTags.replace(/[\[\]]/g, '').split(/[,\s]+/).filter(Boolean).forEach((t) => tags.add(t.replace(/^#/, '')));
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z][\w/-]{1,40})/g)) tags.add(m[1]);
  return [...tags].slice(0, 6);
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}
