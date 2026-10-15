// Quick capture and full garden note composer. Readover is read-first, so this stays
// focused and clean: what you write, where it goes, and connections between notes.
// The type is a top-level folder of the library (none = the top level, Unsorted);
// the file is named from the date and the title, or the first words.
import * as store from '../store.js';
import { canWrite, displayName, writeNote, readText, deviceSource, DEVICE_ID } from '../library.js';
import { openSheet, toast, el, closeTop, icon } from './overlay.js';
import { newNotePath, newNoteText, titleFromText, wikiLink, formatGardenNoteBody, addRelatedLink } from '../notefile.js';
import { newNotesHome, inboxState, highlightsFolder } from '../insights.js';
import { entries as indexEntries } from '../notes-index.js';
import { libraryTypes } from './types.js';
import { sheet as openCustomSheet } from './sheet.js';

const NEW_TYPE = '\u0000new';
const STATUS_KEY = 'readover.statusByFolder';
const clean = (f) => String(f || '').trim().replace(/^\/+|\/+$/g, '');
const lastStatus = (folder) => {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}')[folder.toLowerCase()] || '';
  } catch {
    return '';
  }
};
const rememberStatus = (folder, status) => {
  try {
    const all = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
    all[folder.toLowerCase()] = status;
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch {}
};

export function initCompose(app) {
  const sheet = document.getElementById('compose-sheet');
  const form = document.getElementById('compose-form');
  const f = form.elements;
  const typeField = document.getElementById('compose-type-field');
  const addType = document.getElementById('compose-add-type');
  const newType = document.getElementById('compose-new-type');
  const includeCitationBtn = document.getElementById('compose-include-citation') || document.getElementById('compose-include-insight');
  let allItems = [];
  let activeSourceItem = null;
  const citedInsights = new Set();

  const srcOf = (id) => (id === DEVICE_ID ? deviceSource(false) || { id: DEVICE_ID, type: 'device', root: '' } : store.getSource(id));
  const rootOf = (src) => clean(src?.root);

  /** The folder chosen, relative to the repo (the library's top level when Unsorted). */
  function chosenFolder() {
    const root = rootOf(srcOf(f.source.value));
    const join = (name) => [root, clean(name)].filter(Boolean).join('/');
    if (!newType.hidden) return join(f.newType.value);
    return typeField.hidden ? root : f.folder.value;
  }

  function showNewType(on) {
    newType.hidden = !on;
    if (on) f.newType.focus();
  }

  /** Fill the type picker for the chosen library; `keep` is a folder to select. */
  function fillTypes(keep = null) {
    const src = srcOf(f.source.value);
    const root = rootOf(src);
    const types = libraryTypes(allItems, src);
    if (keep != null && keep !== root && !keep.startsWith(`${root}/`) && root) keep = root;
    const opts = [el('option', { value: root }, 'Unsorted'), ...types.map((t) => el('option', { value: [root, t].filter(Boolean).join('/') }, t))];
    // A deeper folder (a note started from inside it) stays as it is.
    if (keep && !opts.some((o) => o.value === keep)) opts.push(el('option', { value: keep }, keep.slice(root ? root.length + 1 : 0).split('/').join(' / ')));
    opts.push(el('option', { value: NEW_TYPE }, 'New type…'));
    f.folder.replaceChildren(...opts);
    f.folder.value = keep != null && opts.some((o) => o.value === keep) ? keep : root;
    // No folders in this library: no types to pick, just a quiet way to start one.
    const none = types.length === 0 && !(keep && keep !== root);
    typeField.hidden = none;
    addType.hidden = !none;
    showNewType(false);
    applyStatus();
  }

  function applyStatus(preferredStatus = null) {
    const s = preferredStatus != null ? preferredStatus : lastStatus(chosenFolder());
    const opt = form.querySelector(`input[name=status][value="${s}"]`);
    if (opt) opt.checked = true;
    else {
      const defaultOpt = form.querySelector('input[name=status][value=""]');
      if (defaultOpt) defaultOpt.checked = true;
    }
  }

  f.folder.onchange = () => {
    if (f.folder.value === NEW_TYPE) {
      showNewType(true);
      return;
    }
    showNewType(false);
    applyStatus();
  };
  addType.onclick = () => {
    addType.hidden = true;
    showNewType(true);
  };
  f.newType.addEventListener('change', () => applyStatus());

  /* ---------- "Include Citation…" Picker ---------- */

  async function openIncludeCitationPicker() {
    const all = await indexEntries().catch(() => []);
    const inbox = await inboxState().catch(() => null);

    // Dynamically retrieve the current configured highlights folder from Settings
    const hlFolder = clean(highlightsFolder()).toLowerCase();

    const inHighlightsFolder = (item) => {
      if (!item) return false;
      const f = clean(item.folder).toLowerCase();
      if (hlFolder) {
        return f === hlFolder || f.startsWith(`${hlFolder}/`);
      }
      return item.path.toLowerCase().includes('highlight') || item.kind === 'highlight';
    };

    // Collect citation objects strictly from the configured highlights folder to prevent bloating
    const itemsMap = new Map();

    for (const e of all) {
      if (!e.hasText) continue;
      // Filter out other note types (e.g. general garden notes, unsorted, journal)
      if (!inHighlightsFolder(e.item)) continue;

      const rawText = (await store.content.get(e.item.key))?.text || '';
      // Extract quote passages from blockquotes or note content
      const quotes = [];
      for (const m of rawText.matchAll(/(?:^|\n)((?:\s*>.*(?:\n|$))+)/g)) {
        const lines = m[1].split('\n').map((l) => l.replace(/^\s*>\s?/, '')).filter((l) => l.trim() && !/^\s*(—|–|--)\s*\S/.test(l));
        if (lines.length) quotes.push(lines.join(' ').trim());
      }

      // If no explicit blockquote exists, the substantive prose of the highlight note is the quote
      const mainQuote = quotes[0] || e.text.replace(/^[#\s]+.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').trim();
      if (mainQuote && mainQuote.length > 10) {
        itemsMap.set(e.item.key, {
          item: e.item,
          path: e.item.path,
          title: e.title,
          source: e.meta?.source || e.meta?.book || e.meta?.author || '',
          quote: mainQuote,
          allQuotes: quotes,
          thought: e.text.replace(/^[#>*_`\s-]+/gm, '').slice(0, 150).trim(),
        });
      }
    }

    // Add inbox seeds if their source belongs to highlights or inbox
    if (inbox?.inboxes) {
      for (const box of inbox.inboxes.values()) {
        const item = box.item;
        if (!inHighlightsFolder(item) && !item.path.toLowerCase().includes('inbox')) continue;
        for (const s of box.seeds || []) {
          const key = `${item.key}|${s.text.slice(0, 30)}`;
          if (!itemsMap.has(key)) {
            itemsMap.set(key, {
              item,
              path: item.path,
              title: item.name.replace(/\.(md|markdown|txt)$/i, ''),
              source: s.source || '',
              quote: s.text.replace(/^>+\s*/, '').trim(),
              thought: s.note || '',
            });
          }
        }
      }
    }

    const allCitations = [...itemsMap.values()];

    const searchInput = el('input', {
      type: 'search',
      class: 'field-input',
      placeholder: `Search citations in ${hlFolder || 'highlights'}…`,
      autocomplete: 'off',
      'aria-label': 'Search citations',
    });

    const listContainer = el('div', { class: 'insight-picker-list' });
    const emptyNotice = el('p', { class: 'insight-picker-empty', hidden: true }, 'No citations found in the configured highlights folder.');
    let closeDialog = null;

    function renderList(query = '') {
      const q = query.toLowerCase().trim();
      const filtered = q
        ? allCitations.filter((ins) =>
            ins.quote.toLowerCase().includes(q) ||
            ins.title.toLowerCase().includes(q) ||
            ins.source.toLowerCase().includes(q) ||
            ins.thought.toLowerCase().includes(q)
          )
        : allCitations.slice(0, 30);

      if (!filtered.length) {
        emptyNotice.hidden = false;
        listContainer.replaceChildren(emptyNotice);
        return;
      }
      emptyNotice.hidden = true;

      const cards = filtered.map((ins) => {
        const card = el('div', { class: 'insight-picker-card', role: 'button', tabindex: '0' });
        const titleEl = el('span', { class: 'insight-picker-title' }, ins.title);
        const sourceEl = ins.source ? el('span', { class: 'insight-picker-source' }, ins.source) : null;
        const head = el('div', { class: 'insight-picker-head' }, titleEl, sourceEl);
        const quoteEl = el('blockquote', { class: 'insight-picker-quote' }, `“${ins.quote.slice(0, 220)}${ins.quote.length > 220 ? '…' : ''}”`);
        const thoughtEl = ins.thought ? el('p', { class: 'insight-picker-thought' }, ins.thought.slice(0, 140)) : null;

        const insertBtn = el('button', { type: 'button', class: 'btn btn-quiet insight-picker-insert' }, 'Insert citation');
        const footer = el('div', { class: 'insight-picker-footer' }, insertBtn);

        card.append(head, quoteEl, thoughtEl, footer);

        const insertAction = (e) => {
          e?.stopPropagation?.();
          e?.preventDefault?.();
          insertCitation(ins);
          closeDialog?.();
        };

        card.onclick = insertAction;
        insertBtn.onclick = insertAction;
        card.onkeydown = (e) => {
          if (e.key === 'Enter') insertAction(e);
        };
        return card;
      });

      listContainer.replaceChildren(...cards);
    }

    // Insert as an Obsidian citation callout block with wiki link
    function insertCitation(ins) {
      const sourceLink = wikiLink(ins.path, ins.title);
      const cleanQuote = ins.quote.trim();
      const qLines = [
        `> [!quote] ${sourceLink}`,
        ...cleanQuote.split(/\r?\n/).map((l) => (l.trim() ? `> ${l.trim()}` : '>')),
      ];
      if (ins.source) {
        qLines.push('>', `> — ${ins.source}`);
      }
      const insertionText = qLines.join('\n');

      const start = f.body.selectionStart ?? f.body.value.length;
      const end = f.body.selectionEnd ?? start;
      const cur = f.body.value;
      const prefix = start > 0 && cur[start - 1] !== '\n' ? '\n\n' : '';
      const suffix = '\n\n';
      const toInsert = `${prefix}${insertionText}${suffix}`;

      f.body.setRangeText(toInsert, start, end, 'end');
      citedInsights.add(ins.item);
      f.body.focus();
      toast('Citation inserted');
    }

    renderList('');
    searchInput.oninput = () => renderList(searchInput.value);

    const pickerWrapper = el('div', { class: 'insight-picker' }, searchInput, listContainer);

    const { form: dialogForm } = await openCustomSheet({
      title: 'Include citation',
      fields: [pickerWrapper],
      tall: true,
      onOpen: (modalForm) => {
        closeDialog = () => modalForm.closest('dialog')?.close();
        setTimeout(() => searchInput.focus(), 60);
      },
    });
  }

  if (includeCitationBtn) {
    includeCitationBtn.onclick = () => openIncludeCitationPicker();
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const src = f.source.value === DEVICE_ID ? deviceSource(true) : store.getSource(f.source.value);
    const title = f.title.value.trim();
    const body = f.body.value.trim();
    if (!title && !body) {
      toast('Write something first');
      f.body.focus();
      return;
    }
    if (!newType.hidden && !clean(f.newType.value)) {
      toast('Name the new type, or pick one');
      f.newType.focus();
      return;
    }
    const folder = chosenFolder();
    const status = form.querySelector('input[name=status]:checked')?.value || '';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      // YYYY-MM-DD-title-words.md; the name stays fixed from now on, the title can change.
      const name = title || titleFromText(body).replace(/…$/, '');
      const path = await newNotePath(folder, name, async (p) => Boolean(await store.items.get(store.keyOf(src.id, p))));
      const text = newNoteText({ title, body, status, tags: f.tags.value });
      const item = await writeNote(src, path, text, { message: `Readover: add ${path}` });

      // Automated Reciprocal Linking & Graph Synchronization:
      // Writes a backlink to the new note under ## Related in the source insight (and any cited insights)
      const targets = [activeSourceItem, ...citedInsights].filter(Boolean);
      for (const targetItem of targets) {
        try {
          const targetSrc = store.getSource(targetItem.sourceId);
          if (canWrite(targetSrc)) {
            const targetText = await readText(targetItem);
            const myLink = wikiLink(path, title || name);
            const updatedTargetText = addRelatedLink(targetText, myLink);
            if (updatedTargetText !== targetText) {
              await writeNote(targetSrc, targetItem.path, updatedTargetText, {
                message: `Readover: reciprocal link from ${path}`,
              });
            }
          }
        } catch (err) {
          console.warn('Could not write reciprocal backlink to source insight', targetItem.path, err);
        }
      }

      // Notify graph and index of updates
      window.dispatchEvent(new CustomEvent('readover:notes-changed'));

      activeSourceItem = null;
      citedInsights.clear();
      rememberStatus(folder, status);
      localStorage.removeItem('readover.draft');
      form.reset();
      closeTop();
      toast(src.type === 'device' ? 'Garden note saved on this device' : `Garden note saved to ${displayName(src)}`);
      if (src.type === 'device') navigator.storage?.persist?.().catch(() => {});
      app.showFirst(item);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Ctrl/Cmd+Enter saves from anywhere in the form.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Keep an unsent draft per device (only when not working on a populated insight).
  form.addEventListener('input', () => {
    if (activeSourceItem) return;
    try {
      localStorage.setItem('readover.draft', JSON.stringify({ title: f.title.value, body: f.body.value, tags: f.tags.value }));
    } catch {}
  });

  return {
    /**
     * presets: { sourceId, folder, title, body, thought, quote, attribution, tags, status, sourceItem, sourceTitle }
     * to start or cultivate a note in a particular place.
     */
    async open(presets = {}) {
      activeSourceItem = presets.sourceItem || null;
      citedInsights.clear();

      // Repos and folders you can write to, then this device (always available).
      const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
      const sel = f.source;
      sel.replaceChildren(...writable.map((s) => el('option', { value: s.id }, displayName(s))), el('option', { value: DEVICE_ID }, 'This device'));

      // Destination library:
      if (presets.sourceId && [...sel.options].some((o) => o.value === presets.sourceId)) {
        sel.value = presets.sourceId;
      } else {
        sel.value = newNotesHome().id;
      }

      allItems = await store.items.all();

      // Destination folder/type:
      // "Make it a note" defaults to top-level Unsorted (root) per user confirmation.
      const initialFolder = presets.folder != null ? clean(presets.folder) : '';
      fillTypes(initialFolder);
      sel.onchange = () => fillTypes(clean(presets.folder || ''));

      // Status toggle: In progress (default) vs Done
      applyStatus(presets.status ?? '');

      // Pre-populate Title & Tags
      if (presets.title) {
        f.title.value = presets.title;
      }
      if (presets.tags) {
        f.tags.value = Array.isArray(presets.tags) ? presets.tags.join(', ') : presets.tags;
      }

      // Pre-populate Clean Markdown Body
      if (presets.body) {
        f.body.value = presets.body;
      } else if (presets.quote || presets.thought || presets.sourceItem) {
        const relatedLink = presets.sourceItem
          ? wikiLink(presets.sourceItem.path, presets.sourceTitle || presets.title)
          : '';
        f.body.value = formatGardenNoteBody({
          thought: presets.thought,
          quote: presets.quote,
          attribution: presets.attribution,
          relatedLink,
        });
      } else {
        // Normal compose: check saved draft
        try {
          const draft = JSON.parse(localStorage.getItem('readover.draft') || 'null');
          if (draft) {
            f.title.value = draft.title || '';
            f.body.value = draft.body || '';
            f.tags.value = draft.tags || '';
          } else {
            f.title.value = '';
            f.body.value = '';
            f.tags.value = '';
          }
        } catch {
          f.body.value = '';
        }
      }

      const done = openSheet(sheet);
      // Focus lead thought / top of body if title exists, else title
      if (presets.title && !presets.thought) {
        f.body.focus();
        f.body.setSelectionRange(0, 0);
      } else if (presets.title) {
        f.body.focus();
      } else {
        f.title.focus();
      }
      await done;
    },
  };
}
