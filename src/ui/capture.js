// The capture sheet: a clip arrives (shared, from the bookmarklet or a Shortcut, or
// pasted) and becomes an insight: the quote, where it's from, your thought, a title,
// and optionally links to notes it relates to.
import { el, toast, closeTop } from './overlay.js';
import { sheet } from './sheet.js';
import { pickNote } from './reader.js';
import { displayName } from '../library.js';
import { entries } from '../notes-index.js';
import { wikiLink } from '../notefile.js';
import { createInsight, findQuote, titleFromQuote, newNotesHome, highlightsFolder } from '../insights.js';
import { passageUrl, plainUrl, tidyClip } from '../clip.js';

/**
 * @param clip { quote, url, title }
 * @param app  { openItem(item), showFirst(item) }
 */
export async function openCapture(clip, app) {
  const c = tidyClip({ text: clip.quote ?? clip.text ?? '', url: clip.url, title: clip.title });
  const quoteIn = el('textarea', { name: 'quote', rows: '4', required: true, placeholder: 'Paste or type the passage' });
  quoteIn.value = c.quote;
  const thoughtIn = el('textarea', { name: 'thought', rows: '4', placeholder: 'What do you make of it? Why does it matter?' });
  const titleIn = el('input', { name: 'title', autocomplete: 'off', placeholder: 'From the first words of the quote' });
  const tagsIn = el('input', { name: 'tags', placeholder: 'e.g. habits, writing', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' });
  const sourceIn = el('input', { name: 'source', value: c.title, placeholder: 'Where it’s from', autocomplete: 'off' });
  const urlIn = el('input', { name: 'url', type: 'url', value: c.url, placeholder: 'https://…', autocapitalize: 'off', spellcheck: 'false' });
  const dupe = el('p', { class: 'hint clip-dupe', hidden: true });
  const linksBox = el('div', { class: 'clip-links' });
  const related = []; // [{ item, link }]
  let opened = null;

  const home = newNotesHome();
  const folder = highlightsFolder();
  const where = el('p', { class: 'hint clip-where' }, `Saved to ${home.type === 'device' ? 'this device' : displayName(home)}${folder ? ` / ${folder}` : ''}`);

  // Already saved? Say so, and offer the existing note.
  let checkTimer = null;
  const checkDupe = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const found = await findQuote(quoteIn.value).catch(() => null);
      dupe.hidden = !found;
      if (!found) return;
      const open = el('button', { type: 'button', class: 'linklike' }, 'Open it');
      open.onclick = async () => {
        opened = found.item;
        await closeTop();
      };
      dupe.replaceChildren(`Already saved in “${found.title}”. `, open);
    }, 250);
  };
  quoteIn.addEventListener('input', checkDupe);

  const renderLinks = () =>
    linksBox.replaceChildren(
      ...related.map((r, i) => {
        const x = el('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove link to ${r.title}` }, '×');
        x.onclick = () => {
          related.splice(i, 1);
          renderLinks();
        };
        return el('span', { class: 'chip' }, r.title, x);
      })
    );
  const linkBtn = el('button', { type: 'button', class: 'btn btn-quiet clip-link-btn' }, '+ Link to a note');
  linkBtn.onclick = async () => {
    const picked = await pickNote('Link this clip to…', null);
    if (!picked || related.some((r) => r.item.key === picked.key)) return;
    const e = (await entries()).find((x) => x.item.key === picked.key);
    related.push({ item: picked, title: e?.title || picked.path, link: wikiLink(picked.path, e?.title) });
    renderLinks();
  };

  const { value } = await sheet({
    title: 'Save a clip',
    tall: true,
    fields: [
      dupe,
      el('label', { class: 'field' }, 'Quote', quoteIn),
      el('div', { class: 'field-pair' }, el('label', { class: 'field' }, 'From', sourceIn), el('label', { class: 'field' }, 'Link', urlIn)),
      el('label', { class: 'field' }, 'Your thought', thoughtIn),
      el('div', { class: 'field-pair' }, el('label', { class: 'field' }, 'Title', titleIn), el('label', { class: 'field' }, 'Tags', tagsIn)),
      el('div', { class: 'clip-related' }, linkBtn, linksBox),
      where,
    ],
    submit: 'Save clip',
    onOpen: () => {
      checkDupe();
      setTimeout(() => (c.quote ? thoughtIn : quoteIn).focus(), 60);
    },
  });

  if (opened) {
    app.openItem(opened);
    return null;
  }
  if (value !== 'ok') return null;
  const quote = quoteIn.value.trim();
  if (!quote) {
    toast('Nothing to save: add the quote');
    return null;
  }
  const url = urlIn.value.trim();
  const source = sourceIn.value.trim();
  const link = passageUrl(url, quote);
  let attribution = source;
  if (link) {
    let label = source;
    try {
      label = label || new URL(url).hostname.replace(/^www\./, '');
    } catch {
      label = label || 'Source';
    }
    attribution = `[${label.replace(/[[\]]/g, '')}](${link})`;
  }
  try {
    const saved = await createInsight({
      quote,
      title: titleIn.value.trim() || titleFromQuote(quote),
      thought: thoughtIn.value,
      tags: tagsIn.value,
      sourceTitle: source,
      attribution,
      anchor: link ? { url: link } : null,
      meta: url ? { url: plainUrl(url) } : {},
      related: related.map((r) => r.link),
    });
    toast(saved.where ? `Clip saved to ${saved.where}` : 'Clip saved on this device');
    app.showFirst?.(saved.item);
    return saved;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

/** Read the clipboard (the browser asks first), then open the capture sheet with it. */
export async function pasteClip(app) {
  let text = '';
  try {
    text = (await navigator.clipboard.readText()) || '';
  } catch {
    // Not allowed or not supported here: the sheet opens empty, ready to paste into.
  }
  return openCapture({ text }, app);
}
