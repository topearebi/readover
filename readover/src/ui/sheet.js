// Small bottom sheets built on demand (the static ones live in index.html).
import { el, icon, openSheet } from './overlay.js';

/**
 * Build and open a sheet. `fields` are elements placed in a form; the returned
 * promise resolves with the button value pressed ('' if dismissed) and the form.
 */
export async function sheet({ title, fields = [], submit, danger = false, tall = false, onOpen }) {
  const form = el('form', { class: 'sheet-inner', method: 'dialog' });
  form.append(
    el('div', { class: 'sheet-head' }, el('h2', {}, title), el('button', { class: 'icon-btn', value: '', type: 'submit', formnovalidate: true, 'aria-label': 'Close' }, icon('close'))),
    ...fields
  );
  if (submit) form.append(el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'ok' }, submit));
  const dialog = el('dialog', { class: `sheet${tall ? ' sheet-tall' : ''}` }, form);
  document.body.append(dialog);
  onOpen?.(form, dialog);
  const value = await openSheet(dialog);
  dialog.remove();
  return { value, form };
}

/** A list of actions in a sheet. Resolves with the chosen action's id, or ''. */
export async function menu(title, actions) {
  let chosen = '';
  const list = el(
    'div',
    { class: 'menu-list' },
    ...actions.map((a) => {
      const b = el('button', { type: 'submit', value: a.id, class: `menu-item${a.danger ? ' danger' : ''}` }, a.icon ? icon(a.icon) : null, el('span', {}, a.label));
      b.addEventListener('click', () => (chosen = a.id));
      return b;
    })
  );
  const { value } = await sheet({ title, fields: [list] });
  return value || chosen;
}
