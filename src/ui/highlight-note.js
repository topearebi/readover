// Shared by the book and PDF readers.
import { el, icon, openSheet } from './overlay.js';

/** A small sheet for the note that goes with a highlight. Resolves with the text, or null. */
export function askNote(quote) {
  const dialog = el('dialog', { class: 'sheet' });
  const form = el('form', { class: 'sheet-inner', method: 'dialog' });
  const textarea = el('textarea', { rows: '5', placeholder: 'Why it matters, what it reminds you of…' });
  form.append(
    el('div', { class: 'sheet-head' }, el('h2', {}, 'Add a note'), el('button', { class: 'icon-btn', value: 'cancel', 'aria-label': 'Close' }, icon('close'))),
    el('blockquote', { class: 'note-quote' }, quote.length > 240 ? `${quote.slice(0, 240)}…` : quote),
    el('label', { class: 'field' }, 'Your note', textarea),
    el('button', { class: 'btn btn-primary', value: 'save' }, 'Save highlight')
  );
  dialog.append(form);
  document.body.append(dialog);
  setTimeout(() => textarea.focus(), 50);
  return openSheet(dialog).then((v) => {
    const text = textarea.value;
    dialog.remove();
    return v === 'save' ? text : null;
  });
}

