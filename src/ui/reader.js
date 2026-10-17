// Full-screen note reader: read, edit, and work on a note (add a thought, link it
// to other notes, rename or move it, delete it). Opened from the feed and from Notes.
import { readText, writeNote, canWrite, renameNote, deleteNote, notePath, displayName } from '../library.js';
import { parseNote } from '../markdown.js';
import { getSource, items as itemStore } from '../store.js';
import { connections, backlinks, findByLink, search, entries, related, excerptOf, resolve, downloadAll } from '../notes-index.js';
import { pushOverlay, closeAll, el, icon, toast } from './overlay.js';
import { resolveImages } from './card.js';
import { sheet, menu } from './sheet.js';
import { wikiLink, updateFrontmatter } from '../notefile.js';
import { growthOf, isArchived } from '../garden.js';
import { growthTag, openGrowthSheet } from './growth.js';
import { askNote } from './highlight-note.js';
import { showStagingBanner } from './staging-banner.js';
import { setReaderMounted } from '../utils/wakelock.js';
import { setupImageAttachments } from '../attachments.js';

const today = () => new Date().toISOString().slice(0, 10);
const linkName = (item) => item.path.split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
/** [[file-name|Title]] for a note, using the title Readover shows for it. */
export async function linkFor(item) {
  const e = (await entries()).find((x) => x.item.key === item.key);
  return wikiLink(item.path, e?.title);
}

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
 * Transforms Obsidian citation callouts ([!quote], [!cite]) or blockquotes with source
 * attribution links into bounded, styled evidence cards with distinct typography and direct links.
 */
function transformCitationCards(root, noteAnchor = null, noteMeta = null) {

  const bqs = [...root.querySelectorAll('blockquote')];
  for (const bq of bqs) {
    if (bq.closest('.citation-card')) continue;

    const rawText = bq.textContent || '';
    const isCallout = /\[!(?:quote|cite)\]/i.test(rawText);
    const linkEl = bq.querySelector('a.wikilink, a[data-wikilink], a[href]');
    const hasAttributionLink = !isCallout && linkEl && /^(?:—|–|--)\s*/.test(linkEl.parentElement?.textContent?.trim() || '');

    if (!isCallout && !hasAttributionLink) continue;

    let targetLink = '';
    let targetTitle = '';
    if (linkEl) {
      targetLink = linkEl.getAttribute('data-wikilink') || linkEl.getAttribute('href') || '';
      targetTitle = linkEl.textContent.trim();
    }

    const clone = bq.cloneNode(true);
    let attributionHtml = '';
    const paragraphs = [...clone.querySelectorAll('p, div, li')];

    if (paragraphs.length) {
      for (const p of paragraphs) {
        if (/\[!(?:quote|cite)\]/i.test(p.textContent)) {
          const headLink = p.querySelector('a.wikilink, a[data-wikilink], a[href]');
          if (headLink) {
            targetLink = targetLink || headLink.getAttribute('data-wikilink') || headLink.getAttribute('href') || '';
            targetTitle = targetTitle || headLink.textContent.trim();
          }
          p.innerHTML = p.innerHTML.replace(/\[!(?:quote|cite)\][+-]?/i, '').trim();
          if (!p.textContent.replace(targetTitle, '').trim()) {
            p.remove();
          }
        }
        const pText = p.textContent.trim();
        if (/^(?:—|–|--)\s*\S/.test(pText)) {
          attributionHtml = p.innerHTML.replace(/^(?:—|–|--)\s*/, '').trim();
          p.remove();
        }
      }
    }

    const card = document.createElement('figure');
    card.className = 'citation-card';
    if (targetLink) card.setAttribute('data-wikilink', targetLink);

    const head = document.createElement('div');
    head.className = 'citation-card-head';

    const label = document.createElement('div');
    label.className = 'citation-card-label';
    label.innerHTML = '<span class="citation-glyph" aria-hidden="true">“</span><span class="citation-kicker">Cited Evidence</span>';
    head.appendChild(label);

    if (targetLink) {
      const sourceLink = document.createElement('a');
      sourceLink.className = 'citation-source-link wikilink';
      sourceLink.setAttribute('role', 'link');
      sourceLink.setAttribute('tabindex', '0');
      sourceLink.setAttribute('data-wikilink', targetLink);
      sourceLink.setAttribute('title', `Open original note: ${targetTitle || targetLink}`);
      sourceLink.innerHTML = `<span class="citation-source-title">${targetTitle || targetLink}</span><span class="citation-arrow" aria-hidden="true">↗</span>`;
      head.appendChild(sourceLink);
    }
    card.appendChild(head);

    const quoteBody = document.createElement('blockquote');
    quoteBody.className = 'citation-card-quote';
    quoteBody.innerHTML = clone.innerHTML.trim() || rawText.trim();
    card.appendChild(quoteBody);

    if (attributionHtml) {
      const meta = document.createElement('figcaption');
      meta.className = 'citation-card-meta';
      meta.innerHTML = `<span class="citation-dash">—</span> <span class="citation-attribution">${attributionHtml}</span>`;
      card.appendChild(meta);
    }

    // Provenance Jump-to-Source action
    const bookRef = noteAnchor?.book || noteMeta?.book_ref;
    if (bookRef) {
      const bookAt = noteAnchor?.at || noteMeta?.locator?.cfi || (noteMeta?.locator?.page ? `page=${noteMeta.locator.page}` : '');
      const bookTitle = noteMeta?.book_title || targetTitle || 'Book';
      const locDetail = noteMeta?.locator?.page ? `p. ${noteMeta.locator.page}` : (noteAnchor?.chapter || '');
      const jumpRow = document.createElement('div');
      jumpRow.className = 'citation-jump-wrap';
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'btn btn-sm btn-jump-source';
      jumpBtn.setAttribute('data-book', bookRef);
      jumpBtn.setAttribute('data-at', bookAt);
      jumpBtn.innerHTML = `<span class="jump-icon" aria-hidden="true">📖</span> Jump to passage in <b>${bookTitle}</b>${locDetail ? ` <small>(${locDetail})</small>` : ''} <span class="jump-arrow" aria-hidden="true">↗</span>`;
      jumpRow.appendChild(jumpBtn);
      card.appendChild(jumpRow);
    }

    bq.replaceWith(card);
  }
}


/**
 * @param item  the note
 * @param opts  { starred, onStar(bool), highlight?, onSaved(item, text), openItem(item), createNote(title),
 *                makeInsight?(note, { text, thought, title, h }) → Promise,
 *                prune?(title) → Promise<item|null>, replant?() → Promise }
 */
export async function openNote(item, opts = {}) {
  setReaderMounted(true).catch?.(() => {});
  const opener = document.activeElement; // focus goes back here on close
  let src = getSource(item.sourceId);
  let text = await readText(item);
  let note = parseNote(text, item.path);
  let starred = Boolean(opts.starred);
  const writable = canWrite(src);
  const star = el('button', { class: 'icon-btn star-btn', 'aria-pressed': String(starred), title: 'Favourite' }, icon('star'));
  const discardBtn = el('button', { class: 'btn btn-quiet discard-btn', hidden: true, title: 'Discard changes' }, 'Discard');
  const linkBtn = el('button', { class: 'btn btn-quiet', hidden: true, title: 'Insert a link to another note' }, '[[ ]]');
  const saveBtn = el('button', { class: 'btn btn-primary save-btn', hidden: true, title: 'Save changes' }, 'Save');
  const moreBtn = el('button', { class: 'icon-btn', 'aria-label': 'More', title: 'More' }, '⋯');
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Back (Hold to return to Feed)', title: 'Back (Hold to return to Feed)' }, icon('back'));
  const status = el('span', { class: 'status' });
  const titleEl = el('span', { class: 'title' }, note.title);
  const bar = el('div', { class: 'reader-bar' }, back, titleEl, status, star, linkBtn, discardBtn, saveBtn, moreBtn);

  const dockWater = el('button', { type: 'button', class: 'reader-dock-btn', id: 'reader-dock-water', 'aria-label': 'Water: add a thought' },
    icon('drop', 'i i-sm'),
    el('span', {}, 'Water')
  );
  const dockGraft = el('button', { type: 'button', class: 'reader-dock-btn', id: 'reader-dock-graft', 'aria-label': 'Graft: link to another note', title: 'Graft: link to another note' },
    icon('graft', 'i i-sm'),
    el('span', {}, 'Graft')
  );
  const dockEdit = el('button', { type: 'button', class: 'reader-dock-btn reader-dock-btn-primary', id: 'reader-dock-edit', 'aria-label': 'Edit note' },
    icon('pen', 'i i-sm'),
    el('span', {}, 'Edit')
  );

  const readerDock = el('nav', { class: 'reader-dock', 'aria-label': 'Note actions' },
    dockWater,
    el('span', { class: 'reader-dock-divider', 'aria-hidden': 'true' }),
    dockGraft,
    el('span', { class: 'reader-dock-divider', 'aria-hidden': 'true' }),
    dockEdit
  );
  if (!writable || note.imported) {
    readerDock.hidden = true;
  }

  const scroll = el('div', { class: 'reader-scroll', tabindex: '-1' });
  const root = el('div', { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': note.title }, bar, scroll, readerDock);
  let prose = null;

  const githubUrl = () =>
    src?.type === 'github'
      ? `https://github.com/${src.owner}/${src.repo}/blob/${encodeURIComponent(src.branch || 'main')}/${item.path.split('/').map(encodeURIComponent).join('/')}`
      : null;

  const renderArticle = () => {
    const prose = el('div', { class: 'prose' });
    // Where the note stands in the garden; tap for Water / Graft / Prune.
    const growthSlot = el('div', { class: 'reader-grow' });
    growthOf(item)
      .then((g) => {
        const tag = growthTag(g, () => openGrowth(g));
        if (tag) growthSlot.replaceChildren(tag);
      })
      .catch(() => {});
    prose.innerHTML = note.html;
    resolveImages(prose, item);
    transformCitationCards(prose, note.anchor, note.meta);
    const crumbs = item.folder ? item.folder.split('/') : [];
    const linked = el('section', { class: 'backlinks', hidden: true });
    const article = el(
      'article',
      { class: 'reader-article' },
      el('div', { class: 'card-where' }, el('span', {}, ...[src?.name || displayName(src), ...crumbs].map((c) => el('span', { class: 'crumb' }, c)))),
      el('h1', { class: 'card-title' }, note.title),
      growthSlot,
      prose,
      linked,
      el('p', { class: 'reader-foot' }, item.path)
    );
    scroll.replaceChildren(article);
    titleEl.textContent = note.title;
    showConnections(linked);
    return prose;
  };

  async function showConnections(section) {
    const conn = await connections(item);
    const hasMutual = conn.mutual?.length > 0;
    const hasPureOut = conn.pureOutgoing?.length > 0;
    const hasPureIn = conn.pureBacklinks?.length > 0;

    if (!hasMutual && !hasPureOut && !hasPureIn) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    section.hidden = false;

    const children = [];

    // 1. Related Notes (Mutual: Outbound ∩ Inbound)
    // Rendered as a single card per note with a subtle muted reciprocal badge: ⇄ Mutual
    if (hasMutual) {
      children.push(el('h2', {}, 'Related Notes'));
      for (const m of conn.mutual) {
        const head = el('div', { class: 'backlink-head' },
          el('b', {}, m.title),
          el('span', { class: 'conn-mutual', title: 'Reciprocal link: both notes cite each other' }, '⇄ Mutual')
        );
        const btn = el('button', { class: 'backlink', type: 'button' },
          head,
          m.excerpt ? el('span', {}, m.excerpt) : null
        );
        btn.onclick = () => opts.openItem?.(m.item);
        children.push(el('div', { class: 'backlink-row' }, btn));
      }
    }

    // 2. Referenced in Text (Pure Outbound: Outbound \ Mutual)
    // Notes cited here in passing
    if (hasPureOut) {
      children.push(el('h2', { class: hasMutual ? 'connections-subhead' : '' }, 'Referenced in Text'));
      for (const o of conn.pureOutgoing) {
        const head = el('div', { class: 'backlink-head' },
          el('b', {}, o.title)
        );
        const btn = el('button', { class: 'backlink', type: 'button' },
          head,
          o.excerpt ? el('span', {}, o.excerpt) : null
        );
        btn.onclick = () => opts.openItem?.(o.item);
        children.push(el('div', { class: 'backlink-row' }, btn));
      }
    }

    // 3. Referenced By (Pure Inbound: Inbound \ Mutual)
    // Notes elsewhere citing this note; hide entirely if empty
    if (hasPureIn) {
      children.push(el('h2', { class: (hasMutual || hasPureOut) ? 'connections-subhead' : '' }, 'Referenced By'));
      for (const b of conn.pureBacklinks) {
        const head = el('div', { class: 'backlink-head' },
          el('b', {}, b.title)
        );
        let snippet = b.excerpt;
        if (b.context) {
          const rawSnippet = b.context
            .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => {
              const label = alias || t.split('/').pop().replace(/\.(md|markdown)$/i, '');
              try { return decodeURIComponent(label); } catch { return label; }
            })
            .replace(/\[(.*?)\]\([^)]*\)/g, (_m, anchor) => {
              try { return decodeURIComponent(anchor); } catch { return anchor; }
            })
            .replace(/^\s*[-*+]\s+/, '')
            .replace(/[#>*_`=~]/g, '')
            .trim();
          if (rawSnippet && rawSnippet.length > 20) {
            snippet = rawSnippet.slice(0, 160);
          }
        }

        const btn = el('button', { class: 'backlink', type: 'button' },
          head,
          snippet ? el('span', {}, snippet) : null
        );
        btn.onclick = () => opts.openItem?.(b.item);

        let linkBackBtn = null;
        if (writable) {
          linkBackBtn = el('button', { type: 'button', class: 'btn btn-quiet link-back-btn', title: 'Add graft under ## Related' }, '+ Graft back');
          linkBackBtn.onclick = async (e) => {
            e.stopPropagation();
            linkBackBtn.disabled = true;
            try {
              const myLink = await linkFor(b.item);
              const newText = addToSection(text, 'Related', myLink);
              if (await save(newText)) {
                text = newText;
                note = parseNote(text, item.path);
                prose = renderArticle();
                toast(`Grafted back to ${b.title}`);
              }
            } catch (err) {
              toast(err.message);
              linkBackBtn.disabled = false;
            }
          };
        }

        children.push(el('div', { class: 'backlink-row' }, btn, linkBackBtn));
      }
    }

    section.replaceChildren(...children);
  }

  prose = renderArticle();
  document.body.classList.add('has-reader');
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) tabbar.setAttribute('aria-hidden', 'true');
  document.body.append(root);

  if (opts.stagingBanner) {
    showStagingBanner({ ...opts.stagingBanner, container: root });
  }

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

  // Links and Jump-to-source in Readover.
  scroll.addEventListener('click', async (e) => {
    // 1. Jump-to-source action button or deep link
    const jumpBtn = e.target.closest('.btn-jump-source, a[href^="readover://open"]');
    if (jumpBtn) {
      e.preventDefault();
      let bookRef = jumpBtn.dataset.book;
      let at = jumpBtn.dataset.at;
      if (!bookRef && jumpBtn.getAttribute('href')) {
        try {
          const u = new URL(jumpBtn.getAttribute('href'));
          bookRef = u.searchParams.get('book');
          at = u.searchParams.get('at');
        } catch {}
      }
      if (bookRef && opts.openBookRef) {
        opts.openBookRef(bookRef, at);
      } else {
        toast("Unable to open book locator from this note");
      }
      return;
    }

    // 2. Links to other notes
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
    setReaderMounted(false).catch?.(() => {});
    document.removeEventListener('selectionchange', onSelection);
    root.remove();
    if (!document.querySelector('.reader')) {
      document.body.classList.remove('has-reader', 'has-book-reader');
      const tabbar = document.querySelector('.tabbar');
      if (tabbar) tabbar.removeAttribute('aria-hidden');
    }
  }, { element: root, opener });

  let holdTimer = null;
  let didHold = false;
  let pressTime = 0;

  const startHold = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    didHold = false;
    pressTime = Date.now();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      didHold = true;
      closeAll();
    }, 400);
  };

  const clearHold = () => {
    clearTimeout(holdTimer);
  };

  back.addEventListener('pointerdown', startHold);
  back.addEventListener('pointerup', clearHold);
  back.addEventListener('pointercancel', clearHold);
  back.addEventListener('pointerleave', clearHold);
  back.addEventListener('mousedown', startHold);
  back.addEventListener('mouseup', clearHold);
  back.addEventListener('touchstart', startHold, { passive: true });
  back.addEventListener('touchend', clearHold);

  back.onclick = (e) => {
    clearTimeout(holdTimer);
    if (didHold) {
      didHold = false;
      return;
    }
    if (pressTime && Date.now() - pressTime >= 400) {
      pressTime = 0;
      closeAll();
      return;
    }
    pressTime = 0;
    if (editing && textarea?.value !== text && !confirm('Discard your changes?')) return;
    close();
  };

  root.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    }
  });

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
    saveBtn.hidden = true;
    linkBtn.hidden = true;
    discardBtn.hidden = true;
    if (writable && !note.imported) {
      readerDock.hidden = false;
    }
  };

  discardBtn.onclick = () => {
    stopEditing();
    prose = renderArticle();
    toast('Changes discarded');
  };

  async function startEdit() {
    if (opts.editNote) {
      return opts.editNote(item, {
        onSaved: async (savedItem, updatedText) => {
          Object.assign(item, savedItem);
          text = updatedText;
          note = parseNote(text, item.path);
          titleEl.textContent = note.title;
          root.setAttribute('aria-label', note.title);
          prose = renderArticle();
          try {
            const conn = await connections(item);
            showConnections(conn);
          } catch {}
          opts.onSaved?.(item, text);
        },
      });
    }
    if (!editing) {
      editing = true;
      readerDock.hidden = true;
      textarea = el('textarea', { spellcheck: 'true', 'aria-label': 'Note source' });
      textarea.value = text;
      setupImageAttachments(textarea, { getSource: () => src, folder: item.folder });
      scroll.replaceChildren(el('div', { class: 'editor' }, textarea));

      textarea.addEventListener('input', () => fitEditor(textarea, scroll));
      fitEditor(textarea, scroll);
      saveBtn.hidden = false;
      linkBtn.hidden = false;
      discardBtn.hidden = false;
      // Start at the top of the note, not with the cursor (and view) at the end.
      textarea.setSelectionRange(0, 0);
      textarea.focus({ preventScroll: true });
      scroll.scrollTop = 0;
    }
  }

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    if (textarea.value !== text) {
      if (await save(textarea.value)) stopEditing();
    } else {
      stopEditing();
      prose = renderArticle();
    }
    saveBtn.disabled = false;
  };

  dockWater.onclick = () => addThought();
  dockGraft.onclick = () => linkTo();
  dockEdit.onclick = () => startEdit();

  // While editing: insert a [[link]] at the cursor.
  linkBtn.onclick = async () => {
    const picked = await pickNote('Link to a note', item);
    if (!picked || !textarea) return;
    const insert = await linkFor(picked);
    const { selectionStart: s, selectionEnd: e } = textarea;
    textarea.setRangeText(insert, s, e, 'end');
    fitEditor(textarea, scroll);
    textarea.focus({ preventScroll: true });
  };

  moreBtn.onclick = async () => {
    const group1 = [];
    if (writable && !editing) {
      group1.push({ id: 'graft', label: 'Graft: link to another note', icon: 'graft' });
      group1.push({ id: 'move', label: 'Rename or move', icon: 'feed' });
      const archived = isArchived(item.path);
      if (opts.replant && archived) group1.push({ id: 'replant', label: 'Replant note', icon: 'feed' });
      else if (opts.prune && !archived) group1.push({ id: 'prune', label: 'Prune: move to Archive', icon: 'hide' });
    }
    if (githubUrl()) group1.push({ id: 'github', label: 'View on GitHub', icon: 'open' });

    const group2 = [];
    if (!editing) {
      group2.push({ id: 'share', label: 'Share via OS', icon: 'share' });
      group2.push({ id: 'copy-publish', label: 'Copy for Publishing', icon: 'clipboard' });
      group2.push({ id: 'print', label: 'Print / Save as PDF', icon: 'printer' });
    }

    const group3 = [];
    if (writable && !editing) {
      group3.push({ id: 'delete', label: 'Delete note', icon: 'close', danger: true });
    }

    const actions = [];
    if (group1.length) actions.push(...group1);
    if (group2.length) {
      if (actions.length) actions.push({ type: 'divider' });
      actions.push(...group2);
    }
    if (group3.length) {
      if (actions.length) actions.push({ type: 'divider' });
      actions.push(...group3);
    }

    if (!actions.length) {
      toast(`“${displayName(src)}” is read-only`);
      return;
    }
    const choice = await menu(note.title, actions);
    if (choice === 'thought') addThought();
    if (choice === 'graft' || choice === 'link') linkTo();
    if (choice === 'move') renameOrMove();
    if (choice === 'prune') prune();
    if (choice === 'replant') replant();
    if (choice === 'github') window.open(githubUrl(), '_blank', 'noopener');
    if (choice === 'share') {
      if (navigator.share) {
        navigator.share({
          title: note.title,
          text: `${note.title}\n\n${text || note.body || ''}`,
        }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(`${note.title}\n\n${text || note.body || ''}`);
        toast('Copied note text to clipboard');
      }
    }
    if (choice === 'copy-publish') {
      const md = `${note.title ? `# ${note.title}\n\n` : ''}${text || note.body || ''}`;
      const titleEscaped = (note.title || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
      const envelopedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${titleEscaped}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, serif; line-height: 1.65; color: #1c1917; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; }
h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-weight: 700; color: #0c0a09; }
h1 { font-size: 2rem; margin-bottom: 1.5rem; }
blockquote { border-left: 3px solid #78716c; margin: 1.5em 0; padding: 0.5em 0 0.5em 1.25em; font-style: italic; color: #44403c; background: #fafaf9; }
figure.citation-card { border: 1px solid #d6d3d1; border-radius: 8px; padding: 1rem 1.25rem; margin: 1.5rem 0; background: #fafaf9; }
.citation-card-head { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; color: #78716c; margin-bottom: 0.5rem; }
img { max-width: 100%; height: auto; border-radius: 6px; }
a { color: #0284c7; text-decoration: underline; }
p { margin-bottom: 1.2em; }
</style>
</head>
<body>
${note.title ? `<h1>${titleEscaped}</h1>` : ''}
${prose.innerHTML}
</body>
</html>`;
      try {
        const blobHtml = new Blob([envelopedHtml], { type: 'text/html' });
        const blobText = new Blob([md], { type: 'text/plain' });
        const clipItem = new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText,
        });
        await navigator.clipboard.write([clipItem]);
        toast('Copied rich text + Markdown for publishing');
      } catch {
        await navigator.clipboard.writeText(md);
        toast('Copied Markdown note to clipboard');
      }
    }
    if (choice === 'print') {
      window.print();
    }
    if (choice === 'delete') remove();
  };

  /* ---------- Select text → a new insight ---------- */

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
    const text = inside ? sel.toString().replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim() : '';
    if (text.length < 3) {
      selection = null;
      dropBar();
      return;
    }
    // In an export, which highlight is this from? (Its book and place go with it.)
    const flat = (x) => x.replace(/[*_`=>[\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const h = note.highlights.find((x) => flat(x.text).includes(flat(text)) || flat(text).includes(flat(x.text))) || null;
    selection = { text, h: note.imported || h?.at?.book ? h : null };
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
    keep.onclick = () => makeInsight(selection, {});
    withNote.onclick = async () => {
      const sel = selection;
      const asked = await askNote(sel?.text || '');
      if (asked) makeInsight(sel, asked);
    };
  }
  if (opts.makeInsight) document.addEventListener('selectionchange', onSelection);

  async function makeInsight(sel, { thought = '', title = '', tags = '' }) {
    if (!sel) return;
    document.getSelection().removeAllRanges();
    dropBar();
    try {
      await opts.makeInsight(note, { text: sel.text, thought, title, tags, h: sel.h });
    } catch (err) {
      toast(err.message);
    }
  }

  function openGrowth(g) {
    return openGrowthSheet(note.title, g, {
      water: writable ? addThought : null,
      graft: writable ? linkTo : null,
      prune: writable && opts.prune ? prune : null,
      replant: writable && opts.replant ? replant : null,
      status: writable ? (v) => save(updateFrontmatter(text, { status: v || null }), v ? 'Marked done: it rests now' : 'Back in progress', `Readover: mark ${item.path} ${v ? 'done' : 'in progress'}`) : null,
      canonical: writable ? (url) => save(updateFrontmatter(text, { canonical_url: url || null }), url ? 'Published link saved' : 'Published link removed', `Readover: published link for ${item.path}`) : null,
    });
  }
  async function prune() {
    try {
      if (await opts.prune(note.title)) close();
    } catch (err) {
      toast(err.message);
    }
  }
  async function replant() {
    try {
      await opts.replant();
      close();
    } catch (err) {
      toast(err.message);
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
    const picked = await pickNote(`Graft “${note.title}” to…`, item);
    if (!picked) return;
    const myLink = await linkFor(picked);
    const theirLink = await linkFor(item);
    await save(addToSection(text, 'Related', `- ${myLink}`), 'Grafted', `Readover: graft ${item.path} to ${picked.path}`);

    try {
      const pickedSrc = getSource(picked.sourceId);
      if (canWrite(pickedSrc)) {
        const pickedText = await readText(picked);
        const newPickedText = addToSection(pickedText, 'Related', `- ${theirLink}`);
        await writeNote(pickedSrc, picked.path, newPickedText, { message: `Readover: reciprocal graft from ${item.path}` });
      }
    } catch (err) {
      console.warn('Could not write reciprocal graft', err);
    }
  }

  /**
   * Rename or move: title, file name (following the title) and folder. Links to the
   * note across the library are found first and updated in the same commit.
   */
  async function renameOrMove() {
    const { renamedStem } = await import('../notefile.js');
    const { planRename } = await import('../relink.js');
    const root = String(src.root || '').replace(/^\/+|\/+$/g, '');
    const ext = /\.(md|markdown|txt)$/i.exec(item.path)?.[0] || '.md';
    const stem = linkName(item);
    const folders = [...new Set((await itemStore.byIndex('sourceId', src.id)).filter((i) => i.kind === 'note' && i.folder && !/(^|\/)\./.test(i.folder)).map((i) => i.folder))].filter((f) => !root || f === root || f.startsWith(`${root}/`)).sort();
    const NEW = '\u0000new';
    const title = el('input', { name: 'title', required: true, value: note.title, autocomplete: 'off' });
    const name = el('input', { name: 'name', required: true, value: stem, autocapitalize: 'off', spellcheck: 'false' });
    const label = (f) => (f === root ? 'Unsorted' : f.slice(root ? root.length + 1 : 0).split('/').join(' / '));
    const folder = el('select', { name: 'folder' }, ...[root, ...folders.filter((f) => f !== root)].map((f) => el('option', { value: f }, label(f))), el('option', { value: NEW }, 'New type…'));
    folder.value = item.folder;
    const newType = el('input', { name: 'newType', placeholder: 'A folder name, e.g. Essays', autocapitalize: 'words', spellcheck: 'false' });
    const newField = el('label', { class: 'field', hidden: true }, 'New type', newType);
    const links = el('div', { class: 'relink', 'aria-live': 'polite' }, el('p', { class: 'hint' }, 'Checking links…'));
    let nameTouched = false;
    let plan = null;
    let ready = false;
    let timer = null;
    let submitBtn = null;

    const target = () => {
      const dir = folder.value === NEW ? [root, newType.value.trim().replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/') : folder.value;
      return notePath(dir, `${name.value.trim().replace(/\.(md|markdown|txt)$/i, '')}${ext}`);
    };
    const showPlan = async () => {
      if (!ready) return;
      const to = target();
      // Never over another note: say so before Save, not after.
      if (to !== item.path && (await itemStore.get(`${src.id}|${to}`))) {
        plan = null;
        links.replaceChildren(el('p', { class: 'hint relink-taken' }, `There’s already a note called “${to.split('/').pop()}” there. Choose another name or type.`));
        if (submitBtn) submitBtn.disabled = true;
        return;
      }
      try {
        plan = await planRename(item, { newPath: to, newTitle: title.value.trim() });
      } catch (err) {
        links.replaceChildren(el('p', { class: 'hint' }, err.message));
        return;
      }
      const rows = [];
      if (plan.count) {
        const list = el('ul', {}, ...plan.edits.map((e) => el('li', {}, e.title, e.count > 1 ? el('small', {}, ` · ${e.count} links`) : null)));
        rows.push(el('details', { class: 'how relink-list' }, el('summary', {}, `Updates ${plan.count} ${plan.count === 1 ? 'link' : 'links'} in ${plan.notes} ${plan.notes === 1 ? 'note' : 'notes'}`), list));
      } else rows.push(el('p', { class: 'hint' }, 'No links to update.'));
      if (plan.unchecked) rows.push(el('p', { class: 'hint relink-taken' }, `${plan.unchecked} ${plan.unchecked === 1 ? 'note' : 'notes'} couldn’t be downloaded to check, so links in ${plan.unchecked === 1 ? 'it' : 'them'} won’t be updated. Try again when you’re online.`));
      if (plan.elsewhere) rows.push(el('p', { class: 'hint' }, `${plan.elsewhere} ${plan.elsewhere === 1 ? 'link' : 'links'} from other libraries won’t be updated.`));
      links.replaceChildren(...rows);
      if (submitBtn) submitBtn.disabled = false;
    };
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(showPlan, 250);
    };
    title.addEventListener('input', () => {
      if (!nameTouched) name.value = renamedStem(item.path, title.value) || stem;
      refresh();
    });
    name.addEventListener('input', () => {
      nameTouched = true;
      refresh();
    });
    folder.addEventListener('change', () => {
      newField.hidden = folder.value !== NEW;
      if (!newField.hidden) newType.focus();
      refresh();
    });
    newType.addEventListener('input', refresh);

    const { value } = await sheet({
      title: 'Rename or move',
      fields: [el('label', { class: 'field' }, 'Title', title), el('label', { class: 'field' }, 'File name', name), el('label', { class: 'field' }, 'Type', folder), newField, links],
      submit: 'Save',
      onOpen: (form) => {
        submitBtn = form.querySelector('button[value=ok]');
        submitBtn.disabled = true;
        // Every note in the library has to be on the device to find links to this one.
        downloadAll(() => {}, { sourceId: item.sourceId })
          .catch(() => {})
          .then(() => {
            ready = true;
            showPlan();
          });
      },
    });
    clearTimeout(timer);
    if (value !== 'ok' || !plan) return;
    if (folder.value === NEW && !newType.value.trim()) return toast('Name the new type, or pick one');
    const to = target();
    plan = await planRename(item, { newPath: to, newTitle: title.value.trim() });
    if (to === item.path && !plan.self.fmPatch && !plan.self.subs.length && !plan.edits.length) return;
    const wasMoved = to !== item.path;
    status.textContent = 'Saving…';
    try {
      const moved = await renameNote(item, to, plan);
      Object.assign(item, moved);
      src = getSource(item.sourceId);
      text = await readText(item);
      note = parseNote(text, item.path);
      titleEl.textContent = note.title;
      prose = renderArticle();
      toast(plan.count ? `Saved, and ${plan.count} ${plan.count === 1 ? 'link' : 'links'} updated` : wasMoved ? `Moved to ${to}` : 'Saved');
      opts.onSaved?.(item, text);
    } catch (err) {
      toast(err.message);
    } finally {
      status.textContent = '';
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

  if (opts.startInEditor && writable && !note.imported) {
    startEdit();
  }
  if (opts.startMove) {
    setTimeout(() => renameOrMove(), 50);
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
    const link = el('button', { type: 'button', class: `btn ${isLinked ? 'btn-quiet' : ''} pick-link`, disabled: isLinked }, isLinked ? 'Grafted' : 'Graft');
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
