// Quick capture and full garden note composer. Readover is read-first, so this stays
// focused and clean: what you write, where it goes, and connections between notes.
// The type is a top-level folder of the library (none = the top level, Unsorted);
// the file is named from the date and the title, or the first words.
import * as store from '../store.js';
import { canWrite, displayName, writeNote, readText, deviceSource, DEVICE_ID } from '../library.js';
import { openSheet, toast, el, closeTop, icon } from './overlay.js';
import {
  newNotePath,
  newNoteText,
  titleFromText,
  wikiLink,
  formatGardenNoteBody,
  addRelatedLink,
  parseFrontmatter,
  buildFrontmatter,
  resolveTitle,
  typeOf,
} from '../notefile.js';
import { newNotesHome, inboxState, highlightsFolder } from '../insights.js';
import { entries as indexEntries, resolve } from '../notes-index.js';
import { libraryTypes } from './types.js';
import { sheet as openCustomSheet } from './sheet.js';
import { pickNote, linkFor } from './reader.js';
import { setupAttachmentListeners } from '../attachments.js';

const NEW_TYPE = '\u0000new';
const STATUS_KEY = 'readover.statusByFolder';
const clean = (f) => String(f || '').trim().replace(/^\/+|\/+$/g, '');
const basename = (p) => String(p || '').split('/').pop();

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
  const composeTitle = document.getElementById('compose-title');
  const submitBtn = form.querySelector('.btn-save-note') || form.querySelector('[type=submit]');
  const typeField = document.getElementById('compose-type-field');
  const addType = document.getElementById('compose-add-type');
  const newType = document.getElementById('compose-new-type');
  const includeCitationBtn = document.getElementById('compose-include-citation') || document.getElementById('compose-include-insight');
  const linkNoteBtn = document.getElementById('compose-link-note');

  let allItems = [];
  let activeSourceItem = null;
  let currentExistingItem = null;
  let onSavedCallback = null;
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

  /* ---------- Intent-Aware Draft Signature & Citation Scorer ---------- */

  /**
   * Silently inspects the active draft editor in memory and extracts
   * a lightweight signature: normalized WikiLinks and #tags without heavy NLP.
   */
  function extractDraftSignature(bodyText, tagsText) {
    const linkSet = new Set();
    const tagSet = new Set();
    const text = String(bodyText || '');

    // Extract [[WikiLinks]]
    for (const m of text.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
      const rawTarget = m[1].trim().toLowerCase().replace(/\.(md|markdown|txt)$/i, '');
      linkSet.add(rawTarget);
      const leaf = rawTarget.split('/').pop();
      if (leaf) linkSet.add(leaf);
    }

    // Extract tags from form field and markdown #tags
    const rawTags = String(tagsText || '').split(/[,#\s]+/).filter(Boolean);
    for (const t of rawTags) {
      const cleanT = t.toLowerCase().replace(/^#/, '').trim();
      if (cleanT) tagSet.add(cleanT);
    }
    for (const m of text.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-]+)/g)) {
      tagSet.add(m[1].toLowerCase());
    }

    return { linkSet, tagSet };
  }

  /**
   * Fast in-memory Set scoring (<5ms) ranking candidate citations
   * using a weighted composite of direct tag overlap, 1-hop neighbors, and 2-hop bridge notes.
   */
  function scoreCandidateCitations(candidates, draftSig, allEntries) {
    if (!draftSig.linkSet.size && !draftSig.tagSet.size) {
      return candidates.map((c) => ({ ...c, score: 0, reason: '' }));
    }

    // 1-hop: find all entries that match draft links
    const oneHopKeys = new Set();
    const oneHopNames = new Map();

    for (const e of allEntries) {
      const path = e.item.path.toLowerCase().replace(/\.(md|markdown|txt)$/i, '');
      const leaf = e.item.path.split('/').pop().toLowerCase().replace(/\.(md|markdown|txt)$/i, '');
      const title = (e.title || '').toLowerCase();
      if (draftSig.linkSet.has(path) || draftSig.linkSet.has(leaf) || draftSig.linkSet.has(title)) {
        oneHopKeys.add(e.item.key);
        oneHopNames.set(e.item.key, e.title || leaf);
      }
    }

    // 2-hop: peers and cross-domain bridge notes connected via 1-hop notes
    const twoHopKeys = new Map(); // key -> bridge note title
    for (const e of allEntries) {
      if (oneHopKeys.has(e.item.key)) {
        for (const l of e.links || []) {
          const target = resolve(l, e, allEntries);
          if (target && !oneHopKeys.has(target.item.key)) {
            if (!twoHopKeys.has(target.item.key)) {
              twoHopKeys.set(target.item.key, e.title || oneHopNames.get(e.item.key));
            }
          }
        }
      } else {
        for (const l of e.links || []) {
          const target = resolve(l, e, allEntries);
          if (target && oneHopKeys.has(target.item.key)) {
            if (!twoHopKeys.has(e.item.key)) {
              twoHopKeys.set(e.item.key, oneHopNames.get(target.item.key) || target.title);
            }
          }
        }
      }
    }

    // Weighted composite: tag overlap (3x) + 1-hop neighbor (4x) + 2-hop bridge (2x)
    const scored = candidates.map((c) => {
      let score = 0;
      const reasons = [];

      // Extract candidate tags
      const cTags = new Set();
      const metaTags = c.itemMeta?.tags || c.item?.tags || [];
      const tagList = Array.isArray(metaTags) ? metaTags : String(metaTags).split(/[,#\s]+/);
      for (const t of tagList) {
        const cleanT = String(t).toLowerCase().replace(/^#/, '').trim();
        if (cleanT) cTags.add(cleanT);
      }
      for (const m of (c.thought + ' ' + c.quote).matchAll(/(?:^|\s)#([a-zA-Z0-9_\-]+)/g)) {
        cTags.add(m[1].toLowerCase());
      }

      let tagMatches = 0;
      const matchedTagNames = [];
      for (const t of draftSig.tagSet) {
        if (cTags.has(t)) {
          tagMatches++;
          matchedTagNames.push(`#${t}`);
        }
      }
      if (tagMatches > 0) {
        score += tagMatches * 3;
        reasons.push(matchedTagNames.slice(0, 2).join(' '));
      }

      if (oneHopKeys.has(c.item.key)) {
        score += 4;
        reasons.push('Direct peer');
      } else if (twoHopKeys.has(c.item.key)) {
        score += 2;
        reasons.push(`Bridge via [[${twoHopKeys.get(c.item.key)}]]`);
      }

      return {
        ...c,
        score,
        reason: reasons.join(' · '),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /* ---------- Dynamic Dual-State "Include Citation" Picker ---------- */

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
          itemMeta: e.meta,
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
              itemMeta: {},
            });
          }
        }
      }
    }

    const allCitations = [...itemsMap.values()];

    // Silently extract draft signature and score candidate citations in memory (<5ms)
    const draftSig = extractDraftSignature(f.body.value, f.tags.value);
    const scoredCitations = scoreCandidateCitations(allCitations, draftSig, all);

    // Keep search input completely clean and blank for manual typing
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

    /**
     * Dual-state rendering:
     * State A (empty query): Displays top 3-5 contextual suggestions / 2-hop bridge notes.
     * State B (active query): Instantly collapses into standard fuzzy search.
     */
    function renderList(query = '') {
      const q = query.toLowerCase().trim();
      let displayed = [];
      let isContextualState = false;

      if (!q) {
        // State A: Empty input -> top contextual suggestions
        const highScored = scoredCitations.filter((c) => c.score > 0);
        if (highScored.length > 0) {
          displayed = highScored.slice(0, 5);
          isContextualState = true;
        } else {
          displayed = scoredCitations.slice(0, 20);
        }
      } else {
        // State B: Active query -> instant fuzzy match
        displayed = allCitations.filter((ins) =>
          ins.quote.toLowerCase().includes(q) ||
          ins.title.toLowerCase().includes(q) ||
          ins.source.toLowerCase().includes(q) ||
          ins.thought.toLowerCase().includes(q)
        );
      }

      if (!displayed.length) {
        emptyNotice.hidden = false;
        listContainer.replaceChildren(emptyNotice);
        return;
      }
      emptyNotice.hidden = true;

      const headerEl = !q && isContextualState
        ? el('div', { class: 'citation-suggestions-header' }, 'Contextual bridge citations for this draft')
        : null;

      const cards = displayed.map((ins) => {
        const card = el('div', { class: 'insight-picker-card', role: 'button', tabindex: '0' });
        const titleEl = el('span', { class: 'insight-picker-title' }, ins.title);
        const sourceEl = ins.source ? el('span', { class: 'insight-picker-source' }, ins.source) : null;
        const reasonBadge = ins.reason
          ? el('span', { class: 'citation-intent-badge' }, ins.reason)
          : null;

        const headMeta = el('div', { class: 'insight-picker-meta' }, reasonBadge, sourceEl);
        const head = el('div', { class: 'insight-picker-head' }, titleEl, headMeta);
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

      listContainer.replaceChildren(...(headerEl ? [headerEl, ...cards] : cards));
    }

    // Insert as an Obsidian citation callout block with [[TargetPath|DisplayTitle]] wiki link
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

  /* ---------- Header [[ ]] Wiki-Link Button ---------- */

  if (linkNoteBtn) {
    linkNoteBtn.onclick = async () => {
      const picked = await pickNote('Link to a note', currentExistingItem);
      if (!picked) return;
      const insert = await linkFor(picked);
      const start = f.body.selectionStart ?? f.body.value.length;
      const end = f.body.selectionEnd ?? start;
      f.body.setRangeText(insert, start, end, 'end');
      f.body.focus();
    };
  }

  /* ---------- Inline [[ Autocomplete Engine with Mobile Cleanup ---------- */

  let autocompleteEl = null;
  let autocompleteMatches = [];
  let autocompleteSelectedIdx = 0;
  let bracketTriggerStart = -1;

  function dismissAutocomplete() {
    if (autocompleteEl) {
      autocompleteEl.remove();
      autocompleteEl = null;
    }
    window.removeEventListener('pointerdown', handleAutocompleteOutside);
    bracketTriggerStart = -1;
    autocompleteMatches = [];
    autocompleteSelectedIdx = 0;
  }

  function handleAutocompleteOutside(e) {
    if (autocompleteEl && !autocompleteEl.contains(e.target) && e.target !== f.body) {
      dismissAutocomplete();
    }
  }

  async function checkAutocomplete() {
    const text = f.body.value;
    const cursorPos = f.body.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);
    const lastOpen = beforeCursor.lastIndexOf('[[');
    if (lastOpen < 0) {
      dismissAutocomplete();
      return;
    }

    const querySegment = beforeCursor.slice(lastOpen + 2);
    // Unmount if brackets closed, newline encountered, or piped
    if (querySegment.includes('\n') || querySegment.includes(']]') || querySegment.includes('|')) {
      dismissAutocomplete();
      return;
    }

    bracketTriggerStart = lastOpen;
    const query = querySegment.trim().toLowerCase();

    const all = await indexEntries().catch(() => []);
    if (!all.length) {
      dismissAutocomplete();
      return;
    }

    const matches = all
      .filter((e) => {
        if (currentExistingItem && e.item.key === currentExistingItem.key) return false;
        if (!query) return true;
        const titleMatch = e.title.toLowerCase().includes(query);
        const pathMatch = e.item.path.toLowerCase().includes(query);
        const aliasMatch = e.aliases?.some((a) => a.toLowerCase().includes(query));
        return titleMatch || pathMatch || aliasMatch;
      })
      .slice(0, 6);

    if (!matches.length) {
      dismissAutocomplete();
      return;
    }

    autocompleteMatches = matches;
    autocompleteSelectedIdx = Math.min(autocompleteSelectedIdx, matches.length - 1);
    if (autocompleteSelectedIdx < 0) autocompleteSelectedIdx = 0;

    renderAutocompletePopup();
  }

  function renderAutocompletePopup() {
    if (!autocompleteEl) {
      autocompleteEl = el('div', { class: 'wiki-autocomplete-menu', role: 'listbox' });
      // Dock cleanly relative to the editor field
      const fieldFill = f.body.closest('.field-fill') || form;
      fieldFill.style.position = 'relative';
      fieldFill.appendChild(autocompleteEl);
      window.addEventListener('pointerdown', handleAutocompleteOutside);
    }

    const items = autocompleteMatches.map((entry, idx) => {
      const isSelected = idx === autocompleteSelectedIdx;
      const cleanPath = entry.item.path.split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
      const pathDiffers = cleanPath.toLowerCase() !== entry.title.toLowerCase();

      const row = el(
        'button',
        {
          type: 'button',
          class: `wiki-autocomplete-item ${isSelected ? 'active' : ''}`,
          role: 'option',
          'aria-selected': String(isSelected),
        },
        el('div', { class: 'wiki-autocomplete-title' }, entry.title),
        pathDiffers ? el('div', { class: 'wiki-autocomplete-path' }, cleanPath) : null
      );

      row.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        chooseAutocomplete(entry);
      };
      return row;
    });

    autocompleteEl.replaceChildren(...items);
  }

  function chooseAutocomplete(entry) {
    if (bracketTriggerStart < 0) return;
    // Align with [[TargetPath|DisplayTitle]] convention
    const insert = wikiLink(entry.item.path, entry.title);
    const end = f.body.selectionStart;
    f.body.setRangeText(insert, bracketTriggerStart, end, 'end');
    dismissAutocomplete();
    f.body.focus();
  }

  f.body.addEventListener('input', () => {
    checkAutocomplete();
  });

  f.body.addEventListener('keydown', (e) => {
    if (!autocompleteEl || !autocompleteMatches.length) {
      if (e.key === 'Escape') dismissAutocomplete();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteSelectedIdx = (autocompleteSelectedIdx + 1) % autocompleteMatches.length;
      renderAutocompletePopup();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteSelectedIdx = (autocompleteSelectedIdx - 1 + autocompleteMatches.length) % autocompleteMatches.length;
      renderAutocompletePopup();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const chosen = autocompleteMatches[autocompleteSelectedIdx];
      if (chosen) chooseAutocomplete(chosen);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissAutocomplete();
    }
  });

  f.body.addEventListener('blur', () => {
    // Delay slightly to allow tap/click on virtual keyboards
    setTimeout(() => {
      if (document.activeElement !== f.body && !autocompleteEl?.contains(document.activeElement)) {
        dismissAutocomplete();
      }
    }, 180);
  });

  setupAttachmentListeners(f.body, {
    getContext: () => ({
      sourceId: f.source.value,
      title: f.title.value.trim() || 'diagram',
    }),
  });

  /* ---------- Unified Form Submit (New & Existing Notes) ---------- */

  form.onsubmit = async (e) => {
    e.preventDefault();
    dismissAutocomplete();

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
    const btn = submitBtn;
    btn.disabled = true;

    try {
      if (currentExistingItem) {
        // --- EDITING EXISTING NOTE ---
        const item = currentExistingItem;
        const src = store.getSource(item.sourceId);
        const rawOld = await readText(item).catch(() => '');
        const { meta: oldMeta } = parseFrontmatter(rawOld);

        const tagArr = f.tags.value
          .split(/[,#\s]+/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean);

        const patch = {
          ...oldMeta,
          title: title || null,
          status: status || null,
          tags: tagArr.length ? tagArr : null,
        };

        const updatedText = `${buildFrontmatter(patch)}\n${body}\n`;
        let savedItem = item;

        // If folder changed, move the note to new location
        if (clean(folder) !== clean(item.folder)) {
          const newPath = [folder, basename(item.path)].filter(Boolean).join('/');
          savedItem = await library.moveNote(item, newPath, {
            message: `Readover: move ${item.path} to ${newPath}`,
          });
        }

        savedItem = await writeNote(src, savedItem.path, updatedText, {
          message: `Readover: edit ${savedItem.path}`,
        });

        // Reciprocal backlinks for newly cited insights
        for (const targetItem of citedInsights) {
          try {
            const targetSrc = store.getSource(targetItem.sourceId);
            if (canWrite(targetSrc)) {
              const targetText = await readText(targetItem);
              const myLink = wikiLink(savedItem.path, title || basename(savedItem.path));
              const updatedTargetText = addRelatedLink(targetText, myLink);
              if (updatedTargetText !== targetText) {
                await writeNote(targetSrc, targetItem.path, updatedTargetText, {
                  message: `Readover: reciprocal link from ${savedItem.path}`,
                });
              }
            }
          } catch (err) {
            console.warn('Could not write reciprocal backlink', targetItem.path, err);
          }
        }

        window.dispatchEvent(new CustomEvent('readover:notes-changed'));
        rememberStatus(folder, status);

        const savedCallback = onSavedCallback;
        currentExistingItem = null;
        onSavedCallback = null;
        citedInsights.clear();
        form.reset();
        closeTop();

        toast('Changes saved');
        if (savedCallback) {
          await savedCallback(savedItem, updatedText);
        }
      } else {
        // --- CREATING NEW NOTE ---
        const chosenSourceId = f.source.value;
        if (chosenSourceId) {
          try {
            localStorage.setItem('readover.lastNoteSource', chosenSourceId);
          } catch {}
        }
        const src = chosenSourceId === DEVICE_ID ? deviceSource(true) : store.getSource(chosenSourceId);
        const name = title || titleFromText(body).replace(/…$/, '');
        const path = await newNotePath(folder, name, async (p) => Boolean(await store.items.get(store.keyOf(src.id, p))));
        const text = newNoteText({ title, body, status, tags: f.tags.value });
        const item = await writeNote(src, path, text, { message: `Readover: add ${path}` });

        // Automated Reciprocal Linking & Graph Synchronization:
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
      }
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Ctrl/Cmd+Enter saves from anywhere in the form
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Keep an unsent draft per device (only when not working on an existing note or populated insight)
  form.addEventListener('input', () => {
    if (activeSourceItem || currentExistingItem) return;
    try {
      localStorage.setItem('readover.draft', JSON.stringify({ title: f.title.value, body: f.body.value, tags: f.tags.value }));
    } catch {}
  });

  return {
    /**
     * presets: { existingItem, onSaved, sourceId, folder, title, body, thought, quote, attribution, tags, status, sourceItem, sourceTitle }
     * opens the unified editor sheet for either creating a new note or editing an existing note.
     */
    async open(presets = {}) {
      dismissAutocomplete();
      activeSourceItem = presets.sourceItem || null;
      currentExistingItem = presets.existingItem || null;
      onSavedCallback = presets.onSaved || null;
      citedInsights.clear();

      allItems = await store.items.all();

      // Repos and folders you can write to, then this device (always available).
      const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
      const sel = f.source;
      sel.replaceChildren(...writable.map((s) => el('option', { value: s.id }, displayName(s))), el('option', { value: DEVICE_ID }, 'This device'));

      if (currentExistingItem) {
        // Mode: Edit existing note
        composeTitle.textContent = 'Edit note';
        submitBtn.textContent = 'Save changes';
        sel.value = currentExistingItem.sourceId;
        sel.disabled = true;

        const rawText = await readText(currentExistingItem).catch(() => '');
        const { meta, body } = parseFrontmatter(rawText);

        f.title.value = meta.title || resolveTitle(meta, body, currentExistingItem.path) || '';
        f.body.value = body || '';
        f.tags.value = Array.isArray(meta.tags) ? meta.tags.join(', ') : meta.tags || '';

        const initialFolder = currentExistingItem.folder != null ? clean(currentExistingItem.folder) : '';
        fillTypes(initialFolder);
        sel.onchange = () => fillTypes(clean(currentExistingItem.folder || ''));
        applyStatus(meta.status ?? '');
      } else {
        // Mode: New note
        composeTitle.textContent = 'New note';
        submitBtn.textContent = 'Save note';
        sel.disabled = false;

        let targetSourceId = null;
        if (presets.sourceId && [...sel.options].some((o) => o.value === presets.sourceId)) {
          targetSourceId = presets.sourceId;
        } else {
          const prefs = store.getPrefs();
          const lastSource = localStorage.getItem('readover.lastNoteSource');
          if (prefs.newNotesHome && [...sel.options].some((o) => o.value === prefs.newNotesHome)) {
            targetSourceId = prefs.newNotesHome;
          } else if (lastSource && [...sel.options].some((o) => o.value === lastSource)) {
            targetSourceId = lastSource;
          } else {
            targetSourceId = newNotesHome().id;
          }
        }
        sel.value = targetSourceId && [...sel.options].some((o) => o.value === targetSourceId) ? targetSourceId : DEVICE_ID;

        const initialFolder = presets.folder != null ? clean(presets.folder) : '';
        fillTypes(initialFolder);
        sel.onchange = () => {
          if (sel.value) {
            try {
              localStorage.setItem('readover.lastNoteSource', sel.value);
            } catch {}
          }
          fillTypes(clean(presets.folder || ''));
        };

        applyStatus(presets.status ?? '');

        if (presets.title) {
          f.title.value = presets.title;
        }
        if (presets.tags) {
          f.tags.value = Array.isArray(presets.tags) ? presets.tags.join(', ') : presets.tags;
        }

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
      }

      const done = openSheet(sheet);
      if (f.title.value) {
        f.body.focus();
        f.body.setSelectionRange(0, 0);
      } else {
        f.title.focus();
      }
      await done;
      dismissAutocomplete();
    },
  };
}
