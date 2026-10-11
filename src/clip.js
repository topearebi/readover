// Clips: a quote from anywhere, arriving from the share sheet (Android), an iOS
// Shortcut, the bookmarklet, or pasted. They all open Readover at
//   …/readover/#clip?text=…&url=…&title=…
// (the part after # never leaves the device), or, from the share sheet,
//   …/readover/?title=…&text=…&url=…
// and are saved as insights (see insights.js).

const URL_RE = /https?:\/\/[^\s<>"“”]+/i;

/** Read a clip from the address Readover was opened with, or null. */
export function clipFromLocation(loc = location) {
  let params = null;
  if (loc.hash.startsWith('#clip')) params = new URLSearchParams(loc.hash.replace(/^#clip\??/, ''));
  else {
    const q = new URLSearchParams(loc.search);
    if (q.has('text') || q.has('url')) params = q;
  }
  if (!params) return null;
  return tidyClip({ text: params.get('text') || '', url: params.get('url') || '', title: params.get('title') || '' });
}

/**
 * Share sheets mix things up: Android often sends the selection and a link together
 * in `text`, sometimes in quotes. Split them into quote, link and title.
 */
export function tidyClip({ text = '', url = '', title = '' }) {
  let quote = String(text).replace(/\r\n/g, '\n').trim();
  let link = String(url).trim();
  const found = URL_RE.exec(quote);
  if (found) {
    if (!link) link = found[0];
    // A link on its own line (or at the end) is the source, not part of the quote.
    quote = quote.replace(new RegExp(`\\s*${found[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '').trim();
  }
  quote = quote.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  if (quote === link) quote = '';
  return { quote, url: link.replace(/[).,;]+$/, ''), title: String(title).trim() };
}

/** The page address without any fragment: what goes in the `url:` frontmatter. */
export const plainUrl = (url) => String(url || '').split('#')[0];

// Text fragments must escape these characters (as well as the usual ones).
const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');

/**
 * A link that opens the page at the quote (a text fragment). Long quotes use their
 * first and last few words, which survives small differences in the page's text.
 */
export function passageUrl(url, quote) {
  if (!url) return '';
  if (url.includes(':~:text=')) return url; // Android already made one
  const words = String(quote || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return url;
  const directive = words.length <= 8 ? enc(words.join(' ')) : `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}`;
  return url.includes('#') ? `${url}:~:text=${directive}` : `${url}#:~:text=${directive}`;
}

/** The bookmarklet: sends the selection, the page address and title to this Readover. */
export function bookmarkletCode(base = new URL('./', location.href).href) {
  const code =
    `(()=>{const s=String(getSelection()).trim().slice(0,6000);` +
    `open(${JSON.stringify(base)}+'#clip?'+new URLSearchParams({text:s,url:location.href,title:document.title}),'_blank')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
