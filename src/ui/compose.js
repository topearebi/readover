// Full-page botanical authoring canvas and sliding research drawer.
// Readover is read-first, organic, and distraction-free: 68ch writing measure,
// tactile paper tones (#fbf9f5), forest green save actions, instant research citations,
// inline [[ wikilink autocomplete, and seamless reciprocal backlinks.

import * as store from '../store.js';
import { canWrite, displayName, writeNote, readText, deviceSource, DEVICE_ID, moveNote } from '../library.js';
import { pushOverlay, toast, el, closeTop, icon } from './overlay.js';
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
import { setupAttachmentListeners, processAndSaveImage, insertAtCursor } from '../attachments.js';

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
  // Main canvas elements
  const canvas = document.getElementById('writer-canvas');
  const backBtn = document.getElementById('writer-back');
  const crumbsBtn = document.getElementById('writer-crumbs');
  const crumbSrc = document.getElementById('writer-crumb-src');
  const crumbFolder = document.getElementById('writer-crumb-folder');
  const statusEl = document.getElementById('writer-status');
  const doneBtn = document.getElementById('writer-done');
  const scrollEl = document.getElementById('writer-scroll');
  const titleInput = document.getElementById('writer-title');
  const bodyInput = document.getElementById('writer-body');

  // Sticky accessory bar elements
  const btnCite = document.getElementById('writer-btn-cite');
  const btnGraft = document.getElementById('writer-btn-graft');
  const btnImage = document.getElementById('compose-attach-image');
  const imageInput = document.getElementById('compose-image-input');
  const btnTag = document.getElementById('writer-btn-tag');
  const btnMeta = document.getElementById('writer-btn-meta');
  const metaLabel = document.getElementById('writer-meta-label');
  const btnPaste = document.getElementById('compose-paste');
  const legacyCiteBtn = document.getElementById('compose-include-citation');

  // Sliding research drawer elements
  const drawer = document.getElementById('research-drawer');
  const drawerClose = document.getElementById('research-drawer-close');
  const drawerSearch = document.getElementById('research-drawer-search');
  const drawerList = document.getElementById('research-drawer-list');

  let allItems = [];
  let activeSourceItem = null;
  let currentExistingItem = null;
  let onSavedCallback = null;
  const citedInsights = new Set();

  let currentSourceId = DEVICE_ID;
  let currentFolder = '';
  let currentStatus = '';
  let currentTags = '';
  let closeOverlayFn = null;

  let initialState = {
    title: '',
    body: '',
    sourceId: DEVICE_ID,
    folder: '',
    status: '',
    tags: '',
  };

  const srcOf = (id) => (id === DEVICE_ID ? deviceSource(false) || { id: DEVICE_ID, type: 'device', root: '' } : store.getSource(id));
  const rootOf = (src) => clean(src?.root);

  // Auto-resize textarea to fit content and avoid double scrollbars
  function autoResize() {
    if (!bodyInput) return;
    bodyInput.style.height = 'auto';
    bodyInput.style.height = `${Math.max(360, bodyInput.scrollHeight)}px`;
  }
  bodyInput?.addEventListener('input', autoResize);

  function updateBreadcrumbs() {
    const src = srcOf(currentSourceId);
    if (crumbSrc) {
      crumbSrc.textContent = currentSourceId === DEVICE_ID ? 'This device' : (displayName(src) || 'Library');
    }
    const cleanF = clean(currentFolder);
    const folderDisplay = cleanF ? cleanF.split('/').pop() : 'Unsorted';
    if (crumbFolder) {
      crumbFolder.textContent = folderDisplay;
    }
    if (metaLabel) {
      metaLabel.textContent = folderDisplay;
    }
  }

  function isDirty() {
    return (
      (titleInput?.value || '') !== initialState.title ||
      (bodyInput?.value || '') !== initialState.body ||
      currentSourceId !== initialState.sourceId ||
      currentFolder !== initialState.folder ||
      currentStatus !== initialState.status ||
      currentTags !== initialState.tags
    );
  }

  function closeCanvas() {
    if (closeOverlayFn) {
      const fn = closeOverlayFn;
      closeOverlayFn = null;
      fn();
    } else {
      if (canvas) canvas.hidden = true;
      drawer?.classList.remove('open');
      document.body.classList.remove('has-writer');
      dismissAutocomplete();
    }
  }

  // Back / Discard with dirty checking
  if (backBtn) {
    backBtn.onclick = () => {
      if (isDirty() && !confirm('Discard your changes?')) return;
      closeCanvas();
    };
  }

  // Auto-save draft for new notes
  let autoSaveTimer = null;
  function triggerAutoSave() {
    if (currentExistingItem || activeSourceItem) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          'readover.draft',
          JSON.stringify({
            title: titleInput.value,
            body: bodyInput.value,
            tags: currentTags,
            sourceId: currentSourceId,
            folder: currentFolder,
            status: currentStatus,
          })
        );
        if (statusEl) {
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          statusEl.textContent = `Draft saved ${timeStr}`;
        }
      } catch {}
    }, 400);
  }
  titleInput?.addEventListener('input', triggerAutoSave);
  bodyInput?.addEventListener('input', triggerAutoSave);

  // Metadata / Folder / Status Sheet
  async function openMetadataSheet() {
    const src = srcOf(currentSourceId);
    const root = rootOf(src);
    const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));

    const sourceOpts = [
      el('option', { value: DEVICE_ID }, 'This device'),
      ...writable.map((s) => el('option', { value: s.id }, displayName(s))),
    ];
    const sourceSelect = el('select', { name: 'source', class: 'field-input', disabled: Boolean(currentExistingItem) }, ...sourceOpts);
    sourceSelect.value = currentSourceId;

    const sourceField = el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Library / Storage'), sourceSelect);

    const folderFieldWrapper = el('div', { class: 'folder-field-wrapper' });
    const newFolderInput = el('input', {
      type: 'text',
      name: 'newType',
      class: 'field-input',
      placeholder: 'New folder name…',
      hidden: true,
      style: 'margin-top: 8px;',
    });

    let folderSelect = null;
    function refreshFolderOptions(forSrc) {
      const r = rootOf(forSrc);
      const types = libraryTypes(allItems, forSrc);
      const opts = [
        el('option', { value: r }, 'Unsorted'),
        ...types.map((t) => el('option', { value: [r, t].filter(Boolean).join('/') }, t)),
      ];
      if (currentFolder && !opts.some((o) => o.value === currentFolder)) {
        opts.push(el('option', { value: currentFolder }, currentFolder));
      }
      opts.push(el('option', { value: NEW_TYPE }, 'New folder…'));

      folderSelect = el('select', { name: 'folder', class: 'field-input' }, ...opts);
      folderSelect.value = currentFolder && opts.some((o) => o.value === currentFolder) ? currentFolder : r;
      folderSelect.onchange = () => {
        newFolderInput.hidden = folderSelect.value !== NEW_TYPE;
        if (!newFolderInput.hidden) newFolderInput.focus();
      };
      folderFieldWrapper.replaceChildren(
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Folder / Type'), folderSelect),
        newFolderInput
      );
    }

    refreshFolderOptions(src);
    sourceSelect.onchange = () => {
      const selectedSrc = srcOf(sourceSelect.value);
      refreshFolderOptions(selectedSrc);
    };

    const statusSelect = el(
      'select',
      { name: 'status', class: 'field-input' },
      el('option', { value: '' }, 'None (standard note)'),
      el('option', { value: 'seed' }, 'Seed 🌱'),
      el('option', { value: 'budding' }, 'Budding 🌿'),
      el('option', { value: 'evergreen' }, 'Evergreen 🌲')
    );
    statusSelect.value = currentStatus || '';
    const statusField = el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Garden Status'), statusSelect);

    const tagsInputField = el('input', {
      type: 'text',
      name: 'tags',
      class: 'field-input',
      placeholder: 'philosophy, architecture...',
      value: currentTags,
    });
    const tagsField = el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Tags'), tagsInputField);

    const { value } = await openCustomSheet({
      title: 'Note destination & status',
      fields: [sourceField, folderFieldWrapper, statusField, tagsField],
      submit: 'Apply',
    });

    if (value === 'ok') {
      currentSourceId = sourceSelect.value;
      if (folderSelect.value === NEW_TYPE) {
        const typed = clean(newFolderInput.value);
        const activeRoot = rootOf(srcOf(currentSourceId));
        currentFolder = typed ? [activeRoot, typed].filter(Boolean).join('/') : activeRoot;
      } else {
        currentFolder = folderSelect.value;
      }
      currentStatus = statusSelect.value;
      currentTags = tagsInputField.value.trim();

      updateBreadcrumbs();
      rememberStatus(currentFolder, currentStatus);
      triggerAutoSave();
    }
  }

  crumbsBtn?.addEventListener('click', openMetadataSheet);
  btnMeta?.addEventListener('click', openMetadataSheet);

  /* ---------- Intent-Aware Draft Signature & Citation Scorer ---------- */

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

  /* ---------- Sliding Research Drawer Controller ---------- */

  let cachedCitations = null;
  let scoredCitations = [];

  async function loadResearchCitations() {
    const all = await indexEntries().catch(() => []);
    const inbox = await inboxState().catch(() => null);
    const hlFolder = clean(highlightsFolder()).toLowerCase();

    const inHighlightsFolder = (item) => {
      if (!item) return false;
      const f = clean(item.folder).toLowerCase();
      if (hlFolder) {
        return f === hlFolder || f.startsWith(`${hlFolder}/`);
      }
      return item.path.toLowerCase().includes('highlight') || item.kind === 'highlight';
    };

    const itemsMap = new Map();

    for (const e of all) {
      if (!e.hasText) continue;
      if (!inHighlightsFolder(e.item)) continue;

      const rawText = (await store.content.get(e.item.key))?.text || '';
      const quotes = [];
      for (const m of rawText.matchAll(/(?:^|\n)((?:\s*>.*(?:\n|$))+)/g)) {
        const lines = m[1].split('\n').map((l) => l.replace(/^\s*>\s?/, '')).filter((l) => l.trim() && !/^\s*(—|–|--)\s*\S/.test(l));
        if (lines.length) quotes.push(lines.join(' ').trim());
      }

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

    cachedCitations = [...itemsMap.values()];

    const draftSig = extractDraftSignature(bodyInput.value, currentTags);
    scoredCitations = scoreCandidateCitations(cachedCitations, draftSig, all);
  }

  function renderDrawerList(query = '') {
    if (!drawerList) return;
    const q = query.toLowerCase().trim();
    let displayed = [];
    let isContextualState = false;

    if (!q) {
      const highScored = scoredCitations.filter((c) => c.score > 0);
      if (highScored.length > 0) {
        displayed = highScored.slice(0, 5);
        isContextualState = true;
      } else {
        displayed = (cachedCitations || []).slice(0, 20);
      }
    } else {
      displayed = (cachedCitations || []).filter(
        (ins) =>
          ins.quote.toLowerCase().includes(q) ||
          ins.title.toLowerCase().includes(q) ||
          ins.source.toLowerCase().includes(q) ||
          ins.thought.toLowerCase().includes(q)
      );
    }

    if (!displayed.length) {
      drawerList.replaceChildren(
        el('p', { class: 'insight-picker-empty', style: 'padding: 16px; color: var(--muted); text-align: center;' }, 'No matching citations found.')
      );
      return;
    }

    const headerEl =
      !q && isContextualState
        ? el('div', { class: 'citation-suggestions-header', style: 'font-size: 0.8125rem; font-weight: 600; color: var(--healthy); margin-bottom: 6px;' }, 'Contextual bridge citations for this draft')
        : null;

    const cards = displayed.map((ins) => {
      const card = el('div', { class: 'insight-picker-card', role: 'button', tabindex: '0' });
      const titleEl = el('span', { class: 'insight-picker-title' }, ins.title);
      const sourceEl = ins.source ? el('span', { class: 'insight-picker-source' }, ins.source) : null;
      const reasonBadge = ins.reason ? el('span', { class: 'citation-intent-badge' }, ins.reason) : null;

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
      };

      card.onclick = insertAction;
      insertBtn.onclick = insertAction;
      card.onkeydown = (e) => {
        if (e.key === 'Enter') insertAction(e);
      };
      return card;
    });

    drawerList.replaceChildren(...(headerEl ? [headerEl, ...cards] : cards));
  }

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

    insertAtCursor(bodyInput, `\n\n${insertionText}\n\n`);
    citedInsights.add(ins.item);
    autoResize();
    bodyInput.focus();
    toast('Citation inserted');

    if (window.innerWidth < 1024) {
      drawer?.classList.remove('open');
    }
  }

  async function toggleResearchDrawer() {
    if (!drawer) return;
    const isCurrentlyOpen = drawer.classList.contains('open');
    if (isCurrentlyOpen) {
      drawer.classList.remove('open');
      bodyInput.focus();
    } else {
      drawer.classList.add('open');
      if (drawerSearch) drawerSearch.value = '';
      if (drawerList) {
        drawerList.replaceChildren(el('p', { class: 'hint', style: 'padding: 16px; text-align: center;' }, 'Loading citations…'));
      }
      await loadResearchCitations();
      renderDrawerList('');
      setTimeout(() => drawerSearch?.focus(), 60);
    }
  }

  btnCite?.addEventListener('click', toggleResearchDrawer);
  legacyCiteBtn?.addEventListener('click', toggleResearchDrawer);
  drawerClose?.addEventListener('click', () => {
    drawer?.classList.remove('open');
    bodyInput.focus();
  });
  drawerSearch?.addEventListener('input', () => {
    renderDrawerList(drawerSearch.value);
  });

  /* ---------- Graft Button (Wiki-Link) ---------- */
  btnGraft?.addEventListener('click', async () => {
    const picked = await pickNote('Graft a note', currentExistingItem);
    if (!picked) return;
    const insert = await linkFor(picked);
    insertAtCursor(bodyInput, insert);
    autoResize();
    bodyInput.focus();
  });

  /* ---------- Tag Button ---------- */
  btnTag?.addEventListener('click', () => {
    insertAtCursor(bodyInput, '#');
    autoResize();
    bodyInput.focus();
  });

  /* ---------- Attach Image Button & File Input ---------- */
  if (btnImage && imageInput) {
    btnImage.onclick = () => {
      imageInput.value = '';
      imageInput.click();
    };
    imageInput.onchange = async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      try {
        await processAndSaveImage(file, bodyInput, () => currentSourceId);
        autoResize();
      } catch (err) {
        console.error('Failed to attach image:', err);
      }
    };
  }

  /* ---------- Inline [[ Autocomplete Engine ---------- */

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
    if (autocompleteEl && !autocompleteEl.contains(e.target) && e.target !== bodyInput) {
      dismissAutocomplete();
    }
  }

  async function checkAutocomplete() {
    if (!bodyInput) return;
    const text = bodyInput.value;
    const cursorPos = bodyInput.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);
    const lastOpen = beforeCursor.lastIndexOf('[[');
    if (lastOpen < 0) {
      dismissAutocomplete();
      return;
    }

    const querySegment = beforeCursor.slice(lastOpen + 2);
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
      const parentContainer = bodyInput?.parentElement || canvas;
      parentContainer.style.position = 'relative';
      parentContainer.appendChild(autocompleteEl);
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
    if (bracketTriggerStart < 0 || !bodyInput) return;
    const insert = wikiLink(entry.item.path, entry.title);
    const end = bodyInput.selectionStart;
    bodyInput.setRangeText(insert, bracketTriggerStart, end, 'end');
    dismissAutocomplete();
    autoResize();
    bodyInput.focus();
  }

  bodyInput?.addEventListener('input', () => {
    checkAutocomplete();
  });

  bodyInput?.addEventListener('keydown', (e) => {
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

  bodyInput?.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== bodyInput && !autocompleteEl?.contains(document.activeElement)) {
        dismissAutocomplete();
      }
    }, 180);
  });

  if (bodyInput) {
    setupAttachmentListeners(bodyInput, {
      getSource: () => currentSourceId,
      getContext: () => ({
        sourceId: currentSourceId,
        title: titleInput?.value.trim() || 'diagram',
      }),
    });
  }

  /* ---------- Unified Save Handler ---------- */

  async function handleDoneSave() {
    dismissAutocomplete();
    drawer?.classList.remove('open');

    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title && !body) {
      toast('Write something first');
      bodyInput.focus();
      return;
    }

    const folder = clean(currentFolder);
    const status = currentStatus || '';
    doneBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';

    try {
      if (currentExistingItem) {
        // --- EDITING EXISTING NOTE ---
        const item = currentExistingItem;
        const src = store.getSource(item.sourceId);
        const rawOld = await readText(item).catch(() => '');
        const { meta: oldMeta } = parseFrontmatter(rawOld);

        const tagArr = currentTags
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

        if (clean(folder) !== clean(item.folder)) {
          const newPath = [folder, basename(item.path)].filter(Boolean).join('/');
          savedItem = await moveNote(item, newPath, {
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
        closeCanvas();

        toast('Changes saved');
        if (savedCallback) {
          await savedCallback(savedItem, updatedText);
        }
      } else {
        // --- CREATING NEW NOTE ---
        const chosenSourceId = currentSourceId;
        if (chosenSourceId) {
          try {
            localStorage.setItem('readover.lastNoteSource', chosenSourceId);
          } catch {}
        }
        const src = chosenSourceId === DEVICE_ID ? deviceSource(true) : store.getSource(chosenSourceId);
        const name = title || titleFromText(body).replace(/…$/, '');
        const path = await newNotePath(folder, name, async (p) => Boolean(await store.items.get(store.keyOf(src.id, p))));
        const text = newNoteText({ title, body, status, tags: currentTags });
        const item = await writeNote(src, path, text, { message: `Readover: add ${path}` });

        // Automated Reciprocal Linking
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
        closeCanvas();
        toast(src.type === 'device' ? 'Garden note saved on this device' : `Garden note saved to ${displayName(src)}`);
        if (src.type === 'device') navigator.storage?.persist?.().catch(() => {});
        app.showFirst(item);
      }
    } catch (err) {
      toast(err.message);
      if (statusEl) statusEl.textContent = 'Error saving';
    } finally {
      doneBtn.disabled = false;
    }
  }

  doneBtn?.addEventListener('click', handleDoneSave);

  // Ctrl/Cmd+Enter saves from anywhere in the canvas
  canvas?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleDoneSave();
    }
  });

  return {
    async open(presets = {}) {
      dismissAutocomplete();
      drawer?.classList.remove('open');
      if (imageInput) imageInput.value = '';
      activeSourceItem = presets.sourceItem || null;
      currentExistingItem = presets.existingItem || null;
      onSavedCallback = presets.onSaved || null;
      citedInsights.clear();
      cachedCitations = null;

      allItems = await store.items.all();

      if (currentExistingItem) {
        // Mode: Edit existing note
        currentSourceId = currentExistingItem.sourceId;
        currentFolder = currentExistingItem.folder != null ? clean(currentExistingItem.folder) : '';

        const rawText = await readText(currentExistingItem).catch(() => '');
        const { meta, body } = parseFrontmatter(rawText);

        titleInput.value = meta.title || resolveTitle(meta, body, currentExistingItem.path) || '';
        bodyInput.value = body || '';
        currentTags = Array.isArray(meta.tags) ? meta.tags.join(', ') : meta.tags || '';
        currentStatus = meta.status ?? '';
      } else {
        // Mode: New note
        let targetSourceId = null;
        const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
        const validIds = new Set([DEVICE_ID, ...writable.map((s) => s.id)]);

        if (presets.sourceId && validIds.has(presets.sourceId)) {
          targetSourceId = presets.sourceId;
        } else {
          const prefs = store.getPrefs();
          const lastSource = localStorage.getItem('readover.lastNoteSource');
          if (prefs.newNotesHome && validIds.has(prefs.newNotesHome)) {
            targetSourceId = prefs.newNotesHome;
          } else if (lastSource && validIds.has(lastSource)) {
            targetSourceId = lastSource;
          } else {
            targetSourceId = newNotesHome().id;
          }
        }
        currentSourceId = targetSourceId && validIds.has(targetSourceId) ? targetSourceId : DEVICE_ID;
        currentFolder = presets.folder != null ? clean(presets.folder) : '';
        currentStatus = presets.status ?? lastStatus(currentFolder);
        currentTags = Array.isArray(presets.tags) ? presets.tags.join(', ') : presets.tags || '';

        if (presets.title) {
          titleInput.value = presets.title;
        } else {
          titleInput.value = '';
        }

        if (presets.body) {
          bodyInput.value = presets.body;
        } else if (presets.quote || presets.thought || presets.sourceItem) {
          const relatedLink = presets.sourceItem
            ? wikiLink(presets.sourceItem.path, presets.sourceTitle || presets.title)
            : '';
          bodyInput.value = formatGardenNoteBody({
            thought: presets.thought,
            quote: presets.quote,
            attribution: presets.attribution,
            relatedLink,
          });
        } else {
          try {
            const draft = JSON.parse(localStorage.getItem('readover.draft') || 'null');
            if (draft) {
              titleInput.value = draft.title || '';
              bodyInput.value = draft.body || '';
              currentTags = draft.tags || '';
              if (draft.folder != null) currentFolder = draft.folder;
              if (draft.status != null) currentStatus = draft.status;
              if (draft.sourceId && validIds.has(draft.sourceId)) currentSourceId = draft.sourceId;
            } else {
              titleInput.value = '';
              bodyInput.value = '';
            }
          } catch {
            titleInput.value = '';
            bodyInput.value = '';
          }
        }
      }

      initialState = {
        title: titleInput.value,
        body: bodyInput.value,
        sourceId: currentSourceId,
        folder: currentFolder,
        status: currentStatus,
        tags: currentTags,
      };

      updateBreadcrumbs();
      if (statusEl) statusEl.textContent = '';
      if (canvas) canvas.hidden = false;
      document.body.classList.add('has-writer');

      closeOverlayFn = pushOverlay(
        () => {
          if (canvas) canvas.hidden = true;
          drawer?.classList.remove('open');
          document.body.classList.remove('has-writer');
          dismissAutocomplete();
          closeOverlayFn = null;
        },
        { element: canvas, opener: document.activeElement }
      );

      autoResize();

      if (titleInput.value) {
        bodyInput.focus();
        bodyInput.setSelectionRange(bodyInput.value.length, bodyInput.value.length);
      } else {
        titleInput.focus();
      }
    },
  };
}
