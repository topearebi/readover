// Saving web articles as Markdown notes. The page arrives as HTML (from the bookmarklet,
// or pasted), Readability finds the article in it, and Turndown turns that into
// Markdown with a small frontmatter header. The result is an ordinary note: it shows in
// the feed, can be searched, linked and edited, and its highlights go to
// Highlights/<title>.md like a book's.
import { loadArticleTools } from './lib/vendor.js';

const DROP = ['script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea', 'svg', 'canvas', 'video', 'audio', 'object', 'embed'];

async function converter() {
  const { TurndownService, gfm } = await loadArticleTools();
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_', hr: '---' });
  td.use(gfm);
  td.remove(DROP);
  // The note's title is its only H1; headings inside the article start at H2.
  td.addRule('demote-h1', {
    filter: 'h1',
    replacement: (content) => `\n\n## ${content.replace(/\n+/g, ' ').trim()}\n\n`,
  });
  // "- item", not Turndown's "-   item".
  td.addRule('list-item', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start')) || 1;
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const pad = ' '.repeat(prefix.length);
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n(?!$)/gm, `\n${pad}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
    },
  });
  // Images without a usable address are noise once saved.
  td.addRule('images', {
    filter: 'img',
    replacement: (_c, node) => {
      const src = node.getAttribute('src') || '';
      if (!/^https?:/i.test(src)) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[[\]\n]/g, ' ').trim();
      return `![${alt}](${src})`;
    },
  });
  return td;
}

const tidy = (md) =>
  md
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Make relative links and images absolute, using the page address. */
function absolutise(root, url) {
  if (!url) return;
  for (const [sel, attr] of [['a[href]', 'href'], ['img[src]', 'src']]) {
    for (const n of root.querySelectorAll(sel)) {
      try {
        n.setAttribute(attr, new URL(n.getAttribute(attr), url).href);
      } catch {}
    }
  }
  // Lazy-loaded images often keep the real address in data-src.
  for (const n of root.querySelectorAll('img[data-src]')) {
    if (!n.getAttribute('src') || /^data:/.test(n.getAttribute('src'))) {
      try {
        n.setAttribute('src', new URL(n.getAttribute('data-src'), url || undefined).href);
      } catch {}
    }
  }
}

// Page furniture that Readability sometimes keeps when an article is short.
const CLUTTER = /^(ad|ads|advert|advertisement|banner|sponsor|sponsored|promo|newsletter|subscribe|signup|cookie|cookies|consent|share|sharing|social|related-posts|comments?)$/i;
function declutter(doc) {
  doc.querySelectorAll('script, style, noscript, nav, footer, aside, form, iframe, [role=navigation], [role=complementary], [aria-hidden=true]').forEach((n) => n.remove());
  for (const n of [...doc.querySelectorAll('[class], [id]')]) {
    const tokens = [...n.classList, n.id].flatMap((t) => t.split(/[-_]/).concat(t));
    if (tokens.some((t) => CLUTTER.test(t)) && !n.querySelector('h1, article')) n.remove();
  }
}

/**
 * A whole web page (as sent by the bookmarklet) → article.
 * The HTML is only parsed, never run: DOMParser doesn't execute scripts.
 */
export async function fromPage({ html, url = '', title = '' }) {
  const { Readability } = await loadArticleTools();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (url) {
    const base = doc.createElement('base');
    base.href = url;
    doc.head.prepend(base);
  }
  absolutise(doc, url);
  const meta = (names) => {
    for (const n of names) {
      const v = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content');
      if (v) return v.trim();
    }
    return '';
  };
  const published = meta(['article:published_time', 'datePublished', 'date', 'pubdate']);
  const pageTitle = doc.title;
  const h1s = [...doc.querySelectorAll('h1')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  declutter(doc);
  const parsed = new Readability(doc.cloneNode(true), { charThreshold: 200 }).parse();
  const td = await converter();
  let body;
  if (parsed?.content) {
    body = tidy(td.turndown(parsed.content));
  } else {
    // Not an article Readability recognises: keep the page's main text.
    const main = doc.querySelector('main, article, [role=main]') || doc.body;
    body = tidy(td.turndown(main.innerHTML));
  }
  // The page's own headline beats "Headline | Site name".
  const ogTitle = meta(['og:title', 'twitter:title']);
  const h1 = h1s.length === 1 && pageTitle.includes(h1s[0]) ? h1s[0] : '';
  const author = (parsed?.byline || meta(['author', 'article:author'])).replace(/^by\s+/i, '').trim();
  if (author) body = body.replace(new RegExp(`^(?:_|\\*\\*)?by\\s+${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:_|\\*\\*)?\\s*\\n+`, 'i'), '');
  const article = {
    title: (ogTitle || h1 || parsed?.title || title || pageTitle || hostOf(url) || 'Saved article').replace(/\s+/g, ' ').trim(),
    url,
    site: (parsed?.siteName || hostOf(url)).trim(),
    author,
    published: (parsed?.publishedTime || published).slice(0, 10),
    body,
  };
  return dropRepeatedTitle(article);
}

/**
 * Pasted content → article. `html` is what the clipboard offered (formatting kept),
 * `text` the plain version. A pasted fragment is converted as it is: Readability is
 * for whole pages.
 */
export async function fromPaste({ html = '', text = '', url = '', title = '' }) {
  let body = '';
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    absolutise(doc, url);
    body = tidy((await converter()).turndown(doc.body.innerHTML));
  }
  if (!body) body = tidy(text);
  const firstLine = body.split('\n').find((l) => l.trim()) || '';
  const guessed = /^#{1,3}\s/.test(firstLine) ? firstLine.replace(/^#+\s*/, '') : '';
  return dropRepeatedTitle({ title: (title || guessed || hostOf(url) || 'Saved article').trim(), url, site: hostOf(url), author: '', published: '', body });
}

/** Articles usually repeat their title as the first heading; the note already has it. */
function dropRepeatedTitle(a) {
  const lines = a.body.split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i >= 0 && /^#{1,3}\s/.test(lines[i]) && lines[i].replace(/^#+\s*/, '').trim().toLowerCase() === a.title.toLowerCase()) {
    lines.splice(i, 1);
    a.body = lines.join('\n').trim();
  }
  return a;
}

export const wordCount = (a) => a.body.split(/\s+/).filter(Boolean).length;

const yaml = (v) => {
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/"/g, '”')}"`;
};

/** The Markdown file saved for an article. */
export function toMarkdown(a, saved = new Date()) {
  const fm = [
    ['title', a.title],
    ['source', a.url],
    ['site', a.site],
    ['author', a.author],
    ['published', a.published],
    ['saved', saved.toISOString().slice(0, 10)],
  ].filter(([, v]) => v);
  return `---\n${fm.map(([k, v]) => `${k}: ${yaml(v)}`).join('\n')}\n---\n\n# ${a.title.replace(/\n/g, ' ')}\n\n${a.body}\n`;
}

/** Is this note a saved web article? (Its frontmatter names a web address.) */
export const isArticle = (meta) => /^https?:\/\//i.test(meta?.source || '');
