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
    { class: 'menu-list', role: 'menu' },
    ...actions.map((a) => {
      if (a.type === 'divider') {
        return el('hr', { class: 'menu-divider', 'aria-hidden': 'true' });
      }
      const b = el(
        'button',
        { type: 'submit', value: a.id, class: `menu-item sheet-action${a.danger ? ' danger' : ''}`, role: 'menuitem' },
        a.icon ? icon(a.icon) : null,
        el('span', {}, a.label)
      );
      b.addEventListener('click', () => (chosen = a.id));
      return b;
    })
  );

  const handleKeydown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...list.querySelectorAll('button.sheet-action:not([disabled])')];
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = items.length - 1;
    }
    items[nextIndex]?.focus();
  };

  list.addEventListener('keydown', handleKeydown);

  const { value } = await sheet({
    title,
    fields: [list],
    onOpen: (form) => {
      form.addEventListener('keydown', handleKeydown);
      const firstAction = list.querySelector('button.sheet-action:not([disabled])');
      if (firstAction) {
        setTimeout(() => firstAction.focus(), 30);
      }
    },
  });
  return value || chosen;
}
