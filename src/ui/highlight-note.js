// The sheet for saving an insight with a thought: the quote, an editable title and
// your thought. Used by the book and PDF readers, the note reader and seed cards.
import { el, icon, openSheet } from './overlay.js';
import { titleFromQuote } from '../insights.js';

/**
 * Resolves with { title, thought, tags }, or null if dismissed.
 * @param quote  the selected text
 * @param o      { title?, heading?, submit? }
 */
export function askNote(quote, o = {}) {
  const dialog = el('dialog', { class: 'sheet' });
  const form = el('form', { class: 'sheet-inner', method: 'dialog' });
  const title = el('input', { name: 'title', value: o.title || titleFromQuote(quote), required: true, autocomplete: 'off' });
  const tags = el('input', { name: 'tags', placeholder: 'optional', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' });
  const textarea = el('textarea', { rows: '5', name: 'thought', placeholder: 'What do you make of it? Why does it matter?' });
  form.append(
    el('div', { class: 'sheet-head' }, el('h2', {}, o.heading || 'New insight'), el('button', { class: 'icon-btn', value: 'cancel', formnovalidate: true, 'aria-label': 'Close' }, icon('close'))),
    el('blockquote', { class: 'note-quote' }, quote.length > 240 ? `${quote.slice(0, 240)}…` : quote),
    el('label', { class: 'field' }, 'Your thought', textarea),
    el('div', { class: 'field-pair' }, el('label', { class: 'field' }, 'Title', title), el('label', { class: 'field' }, 'Tags', tags)),
    el('button', { class: 'btn btn-primary', value: 'save' }, o.submit || 'Save insight')
  );
  dialog.append(form);
  document.body.append(dialog);
  setTimeout(() => textarea.focus(), 50);
  return openSheet(dialog).then((v) => {
    const result = v === 'save' ? { title: title.value.trim(), thought: textarea.value, tags: tags.value } : null;
    dialog.remove();
    return result;
  });
}
