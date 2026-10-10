// Full-screen note reader: read, edit, and work on a note (add a thought, link it
// to other notes, rename or move it, delete it). Opened from the feed and from Notes.
import { readText, writeNote, canWrite, moveNote, deleteNote, notePath, displayName } from '../library.js';
import { parseNote } from '../markdown.js';
import { getSource, items as itemStore } from '../store.js';
import { backlinks, findByLink, search, entries } from '../notes-index.js';
import { pushOverlay, el, icon, toast } from './overlay.js';
import { resolveImages } from './card.js';
import { sheet, menu } from './sheet.js';

const today = () => new Date().toISOString().slice(0, 10);
const linkName = (item) => item.path.split('/').pop().replace(/\.(md|markdown|txt)$/i, '');

/** Add `block` to the end of a "## <heading>" section, creating the section if needed. */
export function addToSection(text, heading, block) {
  const lines = text.replace(/\s*$/, '').split('\n');
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(l));
  if (at < 0) return `${lines.join('\n')}\n\n## ${heading}\n\n${block}\n`;
  let end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, block);
  return `${lines.join('\n')}\n`;
}

/**
 * @param item  the note
 * @param opts  { starred, onStar(bool), highlight?, onSaved(item, text), openItem(item), createNote(title) }
 */
export async function openNote(item, opts = {}) {
  let src = getSource(item.sourceId);
  let text = await readText(item);
  let note = parseNote(text, item.path);
  let starred = Boolean(opts.starred);
  const writable = canWrite(src);

  const star = el('button', { class: 'icon-btn star-btn', 'aria-pressed': String(starred), title: 'Favourite' }, icon('star'));
  const editBtn = writable && !note.imported ? el('button', { class: 'btn' }, 'Edit') : null;
  const linkBtn = el('button', { class: 'btn btn-quiet', hidden: true, title: 'Insert a link to another note' }, '[[ ]]');
  const moreBtn = el('button', { class: 'icon-btn', 'aria-label': 'More', title: 'More' }, '⋯');
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back' }, icon('back'));
  const status = el('span', { class: 'status' });
  const titleEl = el('span', { class: 'title' }, note.title);
  const bar = el('div', { class: 'reader-bar' }, back, titleEl, status, star, linkBtn, editBtn, moreBtn);
  const scroll = el('div', { class: 'reader-scroll', tabindex: '-1' });
  const root = el('div', { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': note.title }, bar, scroll);

  const githubUrl = () =>
    src?.type === 'github'
      ? `https://github.com/${src.owner}/${src.repo}/blob/${encodeURIComponent(src.branch || 'main')}/${item.path.split('/').map(encodeURIComponent).join('/')}`
      : null;

  const renderArticle = () => {
    const prose = el('div', { class: 'prose' });
    prose.innerHTML = note.html;
    resolveImages(prose, item);
    const crumbs = item.folder ? item.folder.split('/') : [];
    const linked = el('section', { class: 'backlinks', hidden: true });
    const article = el(
      'article',
      { class: 'reader-article' },
      el('div', { class: 'card-where' }, el('span', {}, ...[src?.name || displayName(src), ...crumbs].map((c) => el('span', { class: 'crumb' }, c)))),
      el('h1', { class: 'card-title' }, note.title),
      prose,
      linked,
      el('p', { class: 'reader-foot' }, item.path)
    );
    scroll.replaceChildren(article);
    titleEl.textContent = note.title;
    showBacklinks(linked);
    return prose;
  };

  async function showBacklinks(section) {
    const list = await backlinks(item);
    if (!list.length) return;
    section.hidden = false;
    section.replaceChildren(
      el('h2', {}, `Linked from ${list.length} ${list.length === 1 ? 'note' : 'notes'}`),
      ...list.map((b) => {
        const btn = el('button', { class: 'backlink' }, el('b', {}, b.title), el('span', {}, b.context.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => alias || t).replace(/^\s*[-*+]\s+/, '').replace(/[#>*_`]/g, '').slice(0, 160)));
        btn.onclick = () => opts.openItem?.(b.item);
        return btn;
      })
    );
  }

  let prose = renderArticle();
  document.body.append(root);
  scroll.focus();

  if (opts.section) {
    // Opened from one slide of a long note: start at that section.
    const h = [...prose.querySelectorAll('h2')].find((x) => x.textContent.trim() === opts.section.trim());
    if (h) requestAnimationFrame(() => h.scrollIntoView({ block: 'start' }));
  }
  if (opts.highlight) {
    const needle = opts.highlight.text.replace(/[*_`=>[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const target = [...prose.querySelectorAll('blockquote, mark, li, p')].find((n) => n.textContent.replace(/\s+/g, ' ').includes(needle));
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
    }
  }

  // Links to other notes open in Readover.
  scroll.addEventListener('click', async (e) => {
    const wiki = e.target.closest('[data-wikilink]');
    const a = e.target.closest('a[href]');
    let target = null;
    if (wiki) target = wiki.dataset.wikilink;
    else if (a && !/^[a-z]+:|^\/\/|^#/i.test(a.getAttribute('href')) && /\.(md|markdown)(#|$)/i.test(a.getAttribute('href'))) {
      target = decodeURI(a.getAttribute('href').split('#')[0]);
      const parts = item.folder ? item.folder.split('/') : [];
      for (const seg of target.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg && seg !== '.') parts.push(seg);
      }
      target = parts.join('/');
    }
    if (target === null) return;
    e.preventDefault();
    const found = await findByLink(target, item);
    if (found) opts.openItem?.(found);
    else toast(`There's no note called “${target}” yet`, opts.createNote ? { label: 'Create it', run: () => opts.createNote(target.split('/').pop().replace(/\.md$/i, '')) } : null);
  });
  scroll.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('[data-wikilink]')) e.target.click();
  });

  let editing = false;
  let textarea = null;
  const close = pushOverlay(() => root.remove());
  back.onclick = () => {
    if (editing && textarea.value !== text && !confirm('Discard your changes?')) return;
    close();
  };

  star.onclick = async () => {
    starred = !starred;
    star.setAttribute('aria-pressed', String(starred));
    await opts.onStar?.(starred);
  };

  /** Save new text for this note (instant; GitHub commits happen in the background). */
  async function save(newText, message = 'Saved', commitMessage) {
    status.textContent = 'Saving…';
    try {
      const updated = await writeNote(src, item.path, newText, { message: commitMessage });
      Object.assign(item, updated);
      text = newText;
      note = parseNote(text, item.path);
      prose = renderArticle();
      status.textContent = '';
      toast(message);
      opts.onSaved?.(item, text);
      return true;
    } catch (err) {
      status.textContent = '';
      toast(err.message);
      return false;
    }
  }

  const stopEditing = () => {
    editing = false;
    editBtn.textContent = 'Edit';
    editBtn.classList.remove('btn-primary');
    linkBtn.hidden = true;
  };

  if (editBtn) {
    editBtn.onclick = async () => {
      if (!editing) {
        editing = true;
        textarea = el('textarea', { spellcheck: 'true', 'aria-label': 'Note source' });
        textarea.value = text;
        scroll.replaceChildren(el('div', { class: 'editor' }, textarea));
        editBtn.textContent = 'Save';
        editBtn.classList.add('btn-primary');
        linkBtn.hidden = false;
        textarea.focus();
        return;
      }
      editBtn.disabled = true;
      if (textarea.value !== text) {
        if (await save(textarea.value)) stopEditing();
      } else {
        stopEditing();
        prose = renderArticle();
      }
      editBtn.disabled = false;
    };
  }

  // While editing: insert a [[link]] at the cursor.
  linkBtn.onclick = async () => {
    const picked = await pickNote('Link to a note', item);
    if (!picked || !textarea) return;
    const insert = `[[${linkName(picked)}]]`;
    const { selectionStart: s, selectionEnd: e } = textarea;
    textarea.setRangeText(insert, s, e, 'end');
    textarea.focus();
  };

  moreBtn.onclick = async () => {
    const actions = [];
    if (writable && !editing && !note.imported) {
      actions.push({ id: 'thought', label: 'Add a thought', icon: 'pen' });
      actions.push({ id: 'link', label: 'Link to another note', icon: 'open' });
    }
    if (writable && !editing) actions.push({ id: 'move', label: 'Rename or move', icon: 'feed' });
    if (githubUrl()) actions.push({ id: 'github', label: 'View on GitHub', icon: 'share' });
    if (writable && !editing) actions.push({ id: 'delete', label: 'Delete', icon: 'close', danger: true });
    if (!actions.length) {
      toast(`“${displayName(src)}” is read-only`);
      return;
    }
    const choice = await menu(note.title, actions);
    if (choice === 'thought') addThought();
    if (choice === 'link') linkTo();
    if (choice === 'move') renameOrMove();
    if (choice === 'github') window.open(githubUrl(), '_blank', 'noopener');
    if (choice === 'delete') remove();
  };

  async function addThought() {
    const input = el('textarea', { rows: '4', name: 'thought', placeholder: 'What do you think now? Has anything changed?', required: true });
    const { value } = await sheet({
      title: 'Add a thought',
      fields: [el('p', { class: 'hint' }, `Added to the end of “${note.title}” with today's date.`), el('label', { class: 'field' }, 'Your thought', input)],
      submit: 'Add thought',
      onOpen: () => setTimeout(() => input.focus(), 50),
    });
    if (value !== 'ok' || !input.value.trim()) return;
    const lines = input.value.trim().split('\n');
    const block = `- ${today()}: ${lines[0]}${lines.slice(1).map((l) => `\n  ${l}`).join('')}`;
    if (await save(addToSection(text, 'Thoughts', block), 'Thought added', `Readover: add a thought to ${item.path}`)) {
      scroll.querySelector('.prose h2:last-of-type')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  async function linkTo() {
    const picked = await pickNote(`Link “${note.title}” to…`, item);
    if (!picked) return;
    await save(addToSection(text, 'Related', `- [[${linkName(picked)}]]`), 'Linked', `Readover: link ${item.path} to ${picked.path}`);
  }

  async function renameOrMove() {
    const folders = new Set((await itemStore.byIndex('sourceId', src.id)).filter((i) => i.folder).map((i) => i.folder));
    const name = el('input', { name: 'name', required: true, value: linkName(item), autocapitalize: 'off' });
    const folder = el('input', { name: 'folder', list: 'move-folders', value: item.folder, placeholder: 'Top level', autocapitalize: 'off', spellcheck: 'false' });
    const list = el('datalist', { id: 'move-folders' }, ...[...folders].sort().map((f) => el('option', { value: f })));
    const { value } = await sheet({
      title: 'Rename or move',
      fields: [
        el('label', { class: 'field' }, 'Name', name),
        el('label', { class: 'field' }, 'Folder', folder, list),
        el('p', { class: 'hint' }, 'Links to this note that use its old name will need updating.'),
      ],
      submit: 'Save',
    });
    if (value !== 'ok') return;
    const to = notePath(folder.value, name.value);
    if (to === item.path) return;
    try {
      const moved = await moveNote(item, to);
      Object.assign(item, moved);
      src = getSource(item.sourceId);
      prose = renderArticle();
      toast(`Moved to ${to}`);
      opts.onSaved?.(item, text);
    } catch (err) {
      toast(err.message);
    }
  }

  async function remove() {
    const where = src.type === 'github' ? `It's removed from ${src.owner}/${src.repo}, and you can still restore it from the repository's history on GitHub.` : src.type === 'device' ? "It's removed from this device for good." : "It's removed from the folder on this device.";
    const { value } = await sheet({ title: `Delete “${note.title}”?`, fields: [el('p', { class: 'hint' }, where)], submit: 'Delete note', danger: true });
    if (value !== 'ok') return;
    try {
      await deleteNote(item);
      close();
      toast('Deleted');
    } catch (err) {
      toast(err.message);
    }
  }
}

/** Search-as-you-type picker over all notes. Resolves with an item, or null. */
export async function pickNote(title, exclude) {
  const input = el('input', { type: 'search', placeholder: 'Search your notes', autocomplete: 'off' });
  const results = el('div', { class: 'pick-list' });
  let picked = null;
  let dialogRef = null;
  const show = async () => {
    const q = input.value.trim();
    const list = q
      ? (await search(q, { limit: 30 })).map((r) => r.item)
      : (await entries()).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 30).map((e) => e.item);
    const all = await entries();
    results.replaceChildren(
      ...list
        .filter((i) => i.key !== exclude?.key)
        .map((i) => {
          const e = all.find((x) => x.item.key === i.key);
          const b = el('button', { type: 'button', class: 'pick-item' }, el('b', {}, e?.title || linkName(i)), el('span', {}, i.folder || getSource(i.sourceId)?.name || ''));
          b.onclick = () => {
            picked = i;
            dialogRef?.close();
          };
          return b;
        })
    );
    if (!results.children.length) results.append(el('p', { class: 'hint' }, 'No notes match.'));
  };
  input.addEventListener('input', show);
  await sheet({
    title,
    tall: true,
    fields: [input, results],
    onOpen: (_form, dialog) => {
      dialogRef = dialog;
      show();
      setTimeout(() => input.focus(), 50);
    },
  });
  return picked;
}
