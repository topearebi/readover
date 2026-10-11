// Full-screen note reader: read, edit, and work on a note (add a thought, link it
// to other notes, rename or move it, delete it). Opened from the feed and from Notes.
import { readText, writeNote, canWrite, moveNote, deleteNote, notePath, displayName } from '../library.js';
import { parseNote } from '../markdown.js';
import { getSource, items as itemStore, progress, saveProgress } from '../store.js';
import { backlinks, findByLink, search, entries, related, excerptOf, resolve, downloadAll } from '../notes-index.js';
import { pushOverlay, el, icon, toast } from './overlay.js';
import { resolveImages } from './card.js';
import { sheet, menu } from './sheet.js';
import { askNote } from './highlight-note.js';

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
 * @param opts  { starred, onStar(bool), highlight?, onSaved(item, text), openItem(item), createNote(title),
 *                onHighlight?(h) → Promise<{ where, file }> (saved web articles only) }
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
      note.article ? articleMeta() : null,
      prose,
      linked,
      el('p', { class: 'reader-foot' }, item.path)
    );
    scroll.replaceChildren(article);
    titleEl.textContent = note.title;
    showBacklinks(linked);
    if (note.article) paintQuotes(prose, highlights);
    return prose;
  };

  /** Where a saved web article came from. */
  function articleMeta() {
    const m = note.meta;
    let host = m.site || '';
    try {
      host = host || new URL(m.source).hostname.replace(/^www\./, '');
    } catch {}
    const bits = [m.author, m.published].filter(Boolean).join(' · ');
    return el(
      'p',
      { class: 'article-meta' },
      bits ? el('span', {}, bits) : null,
      el('a', { href: m.source, target: '_blank', rel: 'noopener' }, `${host || 'Original'} ↗`)
    );
  }

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

  // Highlights made in a saved web article (also written to Highlights/<title>.md).
  const highlights = note.article ? [...((await progress.get(item.key))?.highlights || [])] : [];
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
  let selTimer = null;
  const onSelection = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 250);
  };
  const close = pushOverlay(() => {
    document.removeEventListener('selectionchange', onSelection);
    root.remove();
  });
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
        textarea.addEventListener('input', () => fitEditor(textarea, scroll));
        fitEditor(textarea, scroll);
        editBtn.textContent = 'Save';
        editBtn.classList.add('btn-primary');
        linkBtn.hidden = false;
        // Start at the top of the note, not with the cursor (and view) at the end.
        textarea.setSelectionRange(0, 0);
        textarea.focus({ preventScroll: true });
        scroll.scrollTop = 0;
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
    fitEditor(textarea, scroll);
    textarea.focus({ preventScroll: true });
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

  /* ---------- Highlighting a saved web article ---------- */

  let selBar = null;
  let selection = null;
  const dropBar = () => {
    selBar?.remove();
    selBar = null;
  };
  function checkSelection() {
    const sel = document.getSelection();
    const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null;
    const inside = range && !editing && prose.isConnected && prose.contains(range.commonAncestorContainer);
    const text = inside ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (text.length < 3) {
      selection = null;
      dropBar();
      return;
    }
    const heads = [...prose.querySelectorAll('h2, h3')];
    const chapter = heads.filter((h) => h.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING).pop()?.textContent.trim() || '';
    selection = { text, chapter };
    if (selBar) return;
    const keep = el('button', { class: 'btn btn-mark' }, icon('marker', 'i i-sm'), 'Highlight');
    const withNote = el('button', { class: 'btn btn-quiet' }, 'Add a note');
    const cancel = el('button', { class: 'btn btn-quiet', 'aria-label': 'Cancel' }, '✕');
    selBar = el('div', { class: 'selection-bar' }, keep, withNote, cancel);
    root.append(selBar);
    cancel.onclick = () => {
      document.getSelection().removeAllRanges();
      dropBar();
    };
    keep.onclick = () => keepHighlight(selection, '');
    withNote.onclick = async () => {
      const sel = selection;
      const comment = await askNote(sel?.text || '');
      if (comment !== null) keepHighlight(sel, comment);
    };
  }
  if (note.article && opts.onHighlight) document.addEventListener('selectionchange', onSelection);

  async function keepHighlight(sel, comment) {
    if (!sel) return;
    document.getSelection().removeAllRanges();
    dropBar();
    const h = { text: sel.text, chapter: sel.chapter, comment: comment.trim(), at: Date.now(), cfi: `text:${normText(sel.text).slice(0, 40)}` };
    highlights.push(h);
    await saveProgress(item, { highlights });
    paintQuotes(prose, highlights);
    try {
      const saved = await opts.onHighlight({ text: h.text, comment: h.comment, chapter: h.chapter, title: note.title, at: `text=${h.text.slice(0, 80)}` });
      if (saved?.file) {
        h.file = saved.file;
        await saveProgress(item, { highlights });
      }
      toast(saved?.where ? `Highlight saved to ${saved.where}` : 'Highlight saved on this device');
    } catch (err) {
      toast(`Kept on this device. ${err.message}`);
    }
  }

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

const normText = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Mark each highlight's text in rendered prose. Matching ignores case and spacing, so
 * it survives the Markdown round trip; a quote that can't be found is simply skipped.
 */
export function paintQuotes(root, quotes) {
  root.querySelectorAll('mark.ro-hl').forEach((m) => m.replaceWith(...m.childNodes));
  root.normalize();
  for (const h of quotes) {
    const q = normText(h.text || '');
    if (q.length < 3) continue;
    // Flatten the text (recomputed per quote: wrapping splits text nodes).
    const map = [];
    let flat = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.data;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i])) {
          if (flat && flat[flat.length - 1] !== ' ') {
            flat += ' ';
            map.push([n, i]);
          }
        } else {
          flat += t[i].toLowerCase();
          map.push([n, i]);
        }
      }
    }
    const at = flat.indexOf(q);
    if (at < 0) continue;
    const [startNode, startOff] = map[at];
    const [endNode, endIdx] = map[at + q.length - 1];
    wrapText(root, startNode, startOff, endNode, endIdx + 1, h.comment);
  }
}

function wrapText(root, startNode, startOff, endNode, endOff, comment) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = startNode;
  for (let n = startNode; n; n = walker.nextNode()) {
    nodes.push(n);
    if (n === endNode) break;
  }
  for (const node of nodes) {
    const s = node === startNode ? startOff : 0;
    const e = node === endNode ? Math.min(endOff, node.length) : node.length;
    if (s >= e || !node.data.slice(s, e).trim()) continue;
    if (e < node.length) node.splitText(e);
    const target = s > 0 ? node.splitText(s) : node;
    const mark = el('mark', { class: 'ro-hl', title: comment || '' });
    target.replaceWith(mark);
    mark.append(target);
  }
}

/** Grow the textarea to fit its text, keeping the page where it was. */
function fitEditor(textarea, scroll) {
  const keep = scroll.scrollTop;
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
  scroll.scrollTop = keep;
}

/**
 * Pick a note to link to. With no search it suggests notes about similar things to
 * `from`; search covers the full text. Tap a note to preview it before linking.
 * Resolves with an item, or null.
 */
export async function pickNote(title, from) {
  const input = el('input', { type: 'search', placeholder: 'Search titles and text', autocomplete: 'off', 'aria-label': 'Search notes' });
  const cover = el('p', { class: 'hint pick-cover', hidden: true });
  const results = el('div', { class: 'pick-list' });
  let picked = null;
  let dialogRef = null;
  let all = [];
  let linked = new Set();
  let generation = 0;

  const row = (item, title, sub, snippet) => {
    const isLinked = linked.has(item.key);
    const main = el('button', { type: 'button', class: 'pick-item', 'aria-expanded': 'false' }, el('b', {}, title), snippet ? el('span', { class: 'pick-snippet' }, snippet) : null, el('small', {}, sub));
    const link = el('button', { type: 'button', class: `btn ${isLinked ? 'btn-quiet' : ''} pick-link`, disabled: isLinked }, isLinked ? 'Linked' : 'Link');
    const preview = el('div', { class: 'pick-preview', hidden: true });
    const wrap = el('div', { class: 'pick-row' }, el('div', { class: 'pick-line' }, main, link), preview);
    link.onclick = () => {
      picked = item;
      dialogRef?.close();
    };
    main.onclick = async () => {
      const open = preview.hidden;
      results.querySelectorAll('.pick-preview').forEach((p) => (p.hidden = true));
      results.querySelectorAll('.pick-item').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (!open) return;
      preview.hidden = false;
      main.setAttribute('aria-expanded', 'true');
      preview.replaceChildren(el('p', { class: 'hint' }, 'Loading…'));
      try {
        const note = parseNote(await readText(item), item.path);
        const prose = el('div', { class: 'prose' });
        prose.innerHTML = note.html;
        prose.querySelectorAll('img').forEach((i) => i.remove());
        preview.replaceChildren(prose);
      } catch (err) {
        preview.replaceChildren(el('p', { class: 'hint' }, `Couldn't load this note: ${err.message}`));
      }
    };
    return wrap;
  };
  const where = (item) => [getSource(item.sourceId)?.name, item.folder].filter(Boolean).join(' / ');
  const heading = (text) => el('h3', { class: 'pick-heading' }, text);

  const show = async () => {
    const mine = ++generation;
    const q = input.value.trim();
    const nodes = [];
    if (q) {
      const found = (await search(q, { limit: 40 })).filter((r) => r.item.key !== from?.key);
      nodes.push(...found.map((r) => row(r.item, r.title, where(r.item), r.snippet || excerptOf(all.find((e) => e.item.key === r.item.key)?.text, 140))));
      if (!found.length) nodes.push(el('p', { class: 'hint' }, 'No notes match.'));
    } else {
      const suggested = from ? await related(from, { limit: 8 }) : [];
      if (suggested.length) {
        nodes.push(heading('Similar notes'));
        nodes.push(...suggested.map((r) => row(r.item, r.title, `${where(r.item)} · shares “${r.shared.join('”, “')}”`, excerptOf(all.find((e) => e.item.key === r.item.key)?.text, 140))));
      }
      nodes.push(heading('All notes'));
      const rest = all.filter((e) => e.item.key !== from?.key).sort((a, b) => a.title.localeCompare(b.title));
      nodes.push(...rest.slice(0, 60).map((e) => row(e.item, e.title, where(e.item), excerptOf(e.text, 140))));
      if (rest.length > 60) nodes.push(el('p', { class: 'hint' }, `${rest.length - 60} more: search to find them.`));
    }
    if (mine === generation) results.replaceChildren(...nodes);
  };

  const refresh = async () => {
    all = await entries();
    const self = all.find((e) => e.item.key === from?.key);
    linked = new Set(self ? self.links.map((l) => resolve(l, self, all)?.item.key).filter(Boolean) : []);
    const missing = all.filter((e) => !e.hasText).length;
    cover.hidden = !missing;
    if (missing) {
      const get = el('button', { type: 'button', class: 'linklike' }, 'Download them');
      get.onclick = async () => {
        get.disabled = true;
        await downloadAll((n) => (get.textContent = `Downloading… ${n} of ${missing}`));
        await refresh();
      };
      cover.replaceChildren(`${missing} of ${all.length} notes aren't on this device yet, so only their titles are searched. `, get);
    }
    await show();
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(show, 120);
  });
  await sheet({
    title,
    tall: true,
    fields: [input, cover, results],
    onOpen: (_form, dialog) => {
      dialogRef = dialog;
      refresh();
      setTimeout(() => input.focus(), 50);
    },
  });
  return picked;
}
