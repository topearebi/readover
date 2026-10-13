// Feed cards: note, highlight, book. A card is created as a skeleton and hydrated
// when it comes near the viewport, so the feed appears instantly.
import { readText, readRelative } from '../library.js';
import { parseNote, escapeHtml, renderMarkdown } from '../markdown.js';
import { getCover } from '../covers.js';
import { learnDate, memoryLine } from '../dates.js';
import { progress, getSource } from '../store.js';
import { el, icon } from './overlay.js';
import { isInbox, seedsOf } from '../insights.js';
import { growthOf } from '../garden.js';
import { growthTag, glyph } from './growth.js';

/** @param ctx { states: Map, mix: number, actions: { star, hide, share, openNote, openBook } } */
export function createCard(item, ctx) {
  const card = el('section', { class: 'card', 'data-key': item.key, 'aria-roledescription': 'card' });
  card._item = item;
  card._ctx = ctx;
  card.append(el('div', { class: 'skeleton', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'), el('i')));
  return card;
}

export async function hydrateCard(card) {
  if (card._hydrated) return;
  card._hydrated = true;
  const item = card._item;
  try {
    if (item.kind === 'note') {
      await renderNote(card, item);
      await addGrowth(card, item);
    } else await renderBook(card, item);
    const reason = card._ctx.reasons?.get(item.key);
    if (reason) setReason(card, reason);
    else if (item.kind === 'note' && card._note) {
      // Dates found in the note (or its history) can make it a memory: "From 3 years ago".
      learnDate(item, card._note).then((d) => {
        const line = memoryLine(d);
        if (line && !card.querySelector('.card-reason')) setReason(card, line);
      });
    }
  } catch (err) {
    console.warn('Card failed', item.path, err);
    renderError(card, item, err);
  }
}

function where(item) {
  const src = getSource(item.sourceId);
  const crumbs = item.folder ? item.folder.split('/') : [];
  return el(
    'div',
    { class: 'card-where' },
    el('span', {}, ...[src?.name || 'Library', ...crumbs].map((c) => el('span', { class: 'crumb' }, c)))
  );
}

function rail(card, item) {
  const { actions, states } = card._ctx;
  const st = states.get(item.key);
  const starred = Boolean(st?.starred);
  const starBtn = el(
    'button',
    { class: 'star-btn', 'aria-pressed': String(starred), title: 'Favourite (S)', 'aria-label': 'Favourite' },
    icon('star')
  );
  starBtn.onclick = (e) => {
    e.stopPropagation();
    actions.star(card);
  };

  const moreBtn = item.kind === 'note' && actions.cardMenu
    ? el('button', { class: 'more-btn', title: 'Note actions (⋯)', 'aria-label': 'Note actions' }, el('span', { class: 'rail-more-dots', 'aria-hidden': 'true' }, '⋯'))
    : null;
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      actions.cardMenu(card);
    };
  }

  const hideBtn = el('button', { title: 'Hide from feed (X)', 'aria-label': 'Hide from feed' }, icon('hide'));
  hideBtn.onclick = (e) => {
    e.stopPropagation();
    actions.hide(card);
  };
  const shareBtn = el('button', { title: 'Share', 'aria-label': 'Share' }, icon('share'));
  shareBtn.onclick = (e) => {
    e.stopPropagation();
    actions.share(card);
  };
  const openBtn = el('button', { class: 'open-btn', title: 'Open (Enter)', 'aria-label': 'Open' }, icon('open'));
  openBtn.onclick = (e) => {
    e.stopPropagation();
    actions.open(card);
  };

  const buttons = item.kind === 'note'
    ? [starBtn, moreBtn, hideBtn, openBtn].filter(Boolean)
    : [starBtn, hideBtn, shareBtn, openBtn];

  return el('div', { class: 'rail' }, ...buttons);
}

function setReason(card, text) {
  const body = card.querySelector('.card-body');
  if (!body) return;
  const p = el('p', { class: 'card-reason' }, text);
  const tag = body.querySelector(':scope > .grow, :scope > .grow-row');
  if (tag) tag.after(p);
  else body.prepend(p);
}

/**
 * The garden on a card: the growth tag at the top, and a one-line "Water" field at the
 * bottom for adding a thought without leaving the feed.
 */
async function addGrowth(card, item) {
  if (card.classList.contains('card-seed')) return; // inbox seeds have their own Water
  const g = card._ctx.growth?.get(item.key) || (await growthOf(item).catch(() => null));
  card._growth = g;
  const body = card.querySelector('.card-body');
  if (!body || !g) return;
  const tag = growthTag(g, () => card._ctx.actions.growth?.(card));
  if (tag) body.prepend(tag);
  if (g.stage === 'pruned' || !card._ctx.actions.waterNote) return;
  body.append(waterField(card));
}

function waterField(card) {
  const box = el('div', { class: 'water-field' });
  const closed = () => {
    const b = el('button', { type: 'button', class: 'water-open' }, glyph('drop'), el('span', {}, 'Water: add a thought…'));
    b.onclick = (e) => {
      e.stopPropagation();
      open();
    };
    box.replaceChildren(b);
  };
  const open = () => {
    const input = el('textarea', { rows: '3', 'aria-label': 'Your thought', placeholder: 'What do you make of it now?' });
    const save = el('button', { type: 'button', class: 'btn btn-primary' }, 'Save thought');
    const cancel = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Cancel');
    for (const x of [input, save, cancel]) x.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => e.stopPropagation()); // typing isn't a feed shortcut
    cancel.onclick = closed;
    save.onclick = async () => {
      if (!input.value.trim()) return closed();
      save.disabled = true;
      const ok = await card._ctx.actions.waterNote(card, input.value);
      if (ok) {
        box.replaceChildren(el('p', { class: 'water-done' }, glyph('drop'), 'Watered'));
      } else save.disabled = false;
    };
    box.replaceChildren(input, el('div', { class: 'water-row' }, cancel, save));
    input.focus();
  };
  closed();
  return box;
}

/** "[Title](url)" and "[[file|Title]]" read as just "Title" on a card. */
const plainLinks = (s) => String(s).replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

const normText = (s) => (s || '').replace(/[*_`=>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function renderNote(card, item) {
  const text = await readText(item);
  const note = parseNote(text, item.path);
  card._note = note;
  const { mix } = card._ctx;
  const forced = card._ctx.forced?.get(item.key); // a highlight the feed is bringing back

  // Inboxes (exports, old grouped highlight files) show one seed at a time: a
  // highlight not yet turned into an insight.
  const inbox = isInbox(text, item.path);
  const seeds = inbox ? (await seedsOf(item)) || note.highlights : null;
  const pool = seeds?.length ? seeds : note.highlights;
  const useHighlight = pool.length > 0 && (forced || inbox || note.imported || Math.random() < mix);
  card.replaceChildren();

  if (useHighlight) {
    const wanted = forced && pool.find((x) => normText(x.text) === normText(forced.text));
    const h = wanted || pool[Math.floor(Math.random() * pool.length)];
    card._highlight = h;
    card.classList.add('card-highlight');
    if (inbox) card.classList.add('card-seed');
    const html = renderMarkdown(h.text);
    const quote = el('blockquote', { class: `hl-quote${h.text.length > 320 ? ' long' : ''}` });
    quote.innerHTML = html;
    // Wrap each paragraph's contents in the highlighter swipe
    quote.querySelectorAll('p, li').forEach((p) => {
      const span = el('span', { class: 'swipe' });
      span.append(...p.childNodes);
      p.append(span);
    });
    if (!quote.querySelector('.swipe')) {
      const span = el('span', { class: 'swipe' });
      span.append(...quote.childNodes);
      quote.append(span);
    }
    // Highlights saved from a book open the book at that passage; clips open the page
    // there; others open the note.
    const inBook = Boolean(h.at?.book);
    const onWeb = !inBook && /^https?:/i.test(h.at?.url || '');
    const from = el(
      'button',
      { class: 'hl-from', title: inBook ? 'Open the book at this passage' : onWeb ? 'Open the page at this passage' : 'Open the note' },
      el('b', {}, h.source || note.meta?.source || note.title),
      inBook || onWeb ? 'Open at this passage' : item.folder ? item.folder.replace(/\//g, ' / ') : getSource(item.sourceId)?.name || ''
    );
    from.onclick = () => (inBook ? card._ctx.actions.openAt(card, h.at) : onWeb ? window.open(h.at.url, '_blank', 'noopener') : card._ctx.actions.open(card));
    card.append(
      el(
        'div',
        { class: 'card-body' },
        quote,
        h.note ? el('p', { class: 'hl-note' }, plainLinks(h.note)) : null,
        h.comment ? el('p', { class: 'hl-comment' }, h.comment) : null,
        from,
        inbox ? seedActions(card, seeds?.length || 0) : null
      ),
      rail(card, item)
    );
    fitText(quote);
  } else if (sectionsOf(note).length >= 3) {
    renderSections(card, item, note);
  } else {
    card.classList.add('card-note');
    const preview = el('div', { class: 'preview prose' });
    preview.innerHTML = note.html;
    const more = el('button', { class: 'more', hidden: true }, `Keep reading (${note.minutes} min)`);
    more.onclick = () => card._ctx.actions.open(card);
    const title = el('h2', { class: 'card-title' }, note.title);
    const body = el('div', { class: 'card-body' }, where(item), title, preview, more);
    card.append(body, rail(card, item));
    resolveImages(preview, item);
    requestAnimationFrame(() => {
      if (preview.scrollHeight > preview.clientHeight + 4) {
        preview.classList.add('clipped');
        more.hidden = false;
      }
    });
    preview.addEventListener('click', (e) => {
      if (!e.target.closest('a')) card._ctx.actions.open(card);
    });
    title.addEventListener('click', () => card._ctx.actions.open(card));
  }
}

/** On a seed: what it is, and Water (write a thought and it becomes an insight). */
function seedActions(card, left) {
  const water = el('button', { class: 'btn btn-mark water-btn' }, 'Water');
  water.onclick = (e) => {
    e.stopPropagation();
    card._ctx.actions.water(card);
  };
  return el(
    'div',
    { class: 'seed-actions' },
    el('span', { class: 'seed-label' }, `Seed${left > 1 ? ` · ${left} waiting here` : ''}`),
    water
  );
}

/* ---------- Long notes: one section per slide ---------- */

/** Split a note at its "## " headings. The part before the first heading counts if it has words. */
export function sectionsOf(note) {
  if (note.imported || note.words < 220) return [];
  const parts = note.body.split(/^(?=##\s)/m).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  return parts.filter((p) => p.replace(/^##.*$/m, '').trim().split(/\s+/).length >= 8);
}

function renderSections(card, item, note) {
  const sections = sectionsOf(note);
  card.classList.add('card-note', 'card-sections');
  // Start somewhere different each time, so a long note shows a new side of itself.
  const start = Math.floor(Math.random() * sections.length);
  const track = el('div', { class: 'slides', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': `${note.title}, ${sections.length} sections` });
  const slides = sections.map((md, i) => {
    const slide = el('div', { class: 'slide prose', role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${sections.length}` });
    slide.innerHTML = renderMarkdown(md);
    resolveImages(slide, item);
    slide.addEventListener('click', (e) => {
      if (!e.target.closest('a')) card._ctx.actions.open(card, { section: slide.querySelector('h2')?.textContent || '' });
    });
    return slide;
  });
  track.append(...slides);
  const dots = el('div', { class: 'slide-dots', 'aria-hidden': 'true' }, ...sections.map(() => el('i')));
  const counter = el('span', { class: 'slide-count' });
  const prev = el('button', { class: 'slide-nav', 'aria-label': 'Previous section' }, '‹');
  const next = el('button', { class: 'slide-nav', 'aria-label': 'Next section' }, '›');
  const go = (i) => {
    const target = slides[Math.max(0, Math.min(slides.length - 1, i))];
    track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  };
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const update = () => {
    const i = current();
    card._slide = i;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
    counter.textContent = `${i + 1} of ${sections.length}`;
    prev.disabled = i === 0;
    next.disabled = i === sections.length - 1;
  };
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  prev.onclick = () => go(current() - 1);
  next.onclick = () => go(current() + 1);
  card._slideBy = (d) => go(current() + d);

  const title = el('h2', { class: 'card-title' }, note.title);
  title.addEventListener('click', () => card._ctx.actions.open(card));
  card.append(
    el('div', { class: 'card-body' }, where(item), title, track, el('div', { class: 'slide-bar' }, prev, dots, counter, next)),
    rail(card, item)
  );
  requestAnimationFrame(() => {
    track.scrollLeft = slides[start].offsetLeft - track.offsetLeft;
    update();
  });
}

/* ---------- Connections: two notes that link to each other ---------- */

export function createConnectionCard(pair, actions) {
  const side = (e) => {
    const b = el('button', { class: 'conn-note' }, el('b', {}, e.title), el('span', {}, e.excerpt));
    b.onclick = () => actions.openItem(e.item);
    return b;
  };
  return el(
    'section',
    { class: 'card card-connection' },
    el(
      'div',
      { class: 'card-body' },
      el('p', { class: 'card-reason' }, 'Connected'),
      side(pair.a),
      el('div', { class: 'conn-link', 'aria-hidden': 'true' }, el('i'), 'links to', el('i')),
      side(pair.b)
    )
  );
}

export function createHubCard(hub, actions) {
  const hubBtn = el('button', { class: 'conn-note conn-hub-main' }, el('b', {}, hub.title), el('span', {}, hub.excerpt));
  hubBtn.onclick = () => actions.openItem(hub.item);

  const backlinkItems = (hub.links || []).map((link) => {
    const b = el(
      'button',
      { class: 'conn-backlink-item' },
      el('strong', {}, link.title),
      el('span', {}, link.context.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => alias || t).replace(/^[#>*_`\s-]+/, '').slice(0, 120))
    );
    b.onclick = () => actions.openItem(link.item);
    return b;
  });

  return el(
    'section',
    { class: 'card card-connection card-hub' },
    el(
      'div',
      { class: 'card-body' },
      el('p', { class: 'card-reason' }, `Garden Hub · Linked from ${hub.count} notes`),
      hubBtn,
      el('div', { class: 'conn-link', 'aria-hidden': 'true' }, el('i'), 'referenced by', el('i')),
      el('div', { class: 'conn-hub-list' }, ...backlinkItems)
    )
  );
}

/** Shrink very long highlights until they fit the card. */
function fitText(node) {
  requestAnimationFrame(() => {
    let size = parseFloat(getComputedStyle(node).fontSize);
    let guard = 12;
    while (node.scrollHeight > node.clientHeight + 2 && size > 15 && guard--) {
      size *= 0.9;
      node.style.fontSize = `${size}px`;
    }
  });
}

async function renderBook(card, item) {
  card.classList.add('card-book');
  const prog = await progress.get(item.key);
  const pct = prog ? Math.round((prog.pct || 0) * 100) : 0;
  const fallbackTitle = item.name.replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' ');

  const coverBtn = el('button', { class: 'cover', 'aria-label': `Open ${fallbackTitle}` }, plainCover(fallbackTitle, ''));
  const titleEl = el('h2', { class: 'book-title' }, fallbackTitle);
  const authorEl = el('p', { class: 'book-author' }, item.name.split('.').pop().toUpperCase());
  const readBtn = el('button', { class: 'btn btn-primary btn-read' }, pct > 0 ? `Continue at ${pct}%` : 'Start reading');
  const open = () => card._ctx.actions.open(card);
  coverBtn.onclick = open;
  readBtn.onclick = open;

  card.replaceChildren(
    el(
      'div',
      { class: 'card-body' },
      coverBtn,
      titleEl,
      authorEl,
      pct > 0 ? el('div', { class: 'book-progress' }, el('i', { style: `width:${pct}%` })) : null,
      readBtn
    ),
    rail(card, item)
  );

  try {
    const meta = await getCover(item);
    if (meta.title) titleEl.textContent = meta.title;
    if (meta.author) authorEl.textContent = meta.author;
    card._bookTitle = meta.title || fallbackTitle;
    if (meta.blob) {
      const img = el('img', { alt: '', src: URL.createObjectURL(meta.blob) });
      coverBtn.replaceChildren(img);
    } else {
      coverBtn.replaceChildren(plainCover(meta.title || fallbackTitle, meta.author));
    }
  } catch (err) {
    console.warn('Cover unavailable', item.path, err.message);
  }
}

function plainCover(title, author) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tones = ['#2e5b4f', '#5a4632', '#3b4a63', '#6b3b3b', '#4a5530', '#40384f'];
  return el(
    'div',
    { class: 'cover-plain', style: `--tone:${tones[h % tones.length]}` },
    el('strong', {}, title),
    el('span', {}, author || '')
  );
}

function renderError(card, item, err) {
  card.classList.add('card-message', 'card-error');
  const retry = el('button', { class: 'btn' }, 'Try again');
  retry.onclick = () => {
    card._hydrated = false;
    card.classList.remove('card-message', 'card-error');
    hydrateCard(card);
  };
  card.replaceChildren(
    el(
      'div',
      { class: 'card-body' },
      where(item),
      el('h2', {}, item.name),
      el('p', { class: 'error-text' }, err.message || 'This item could not be loaded.'),
      el('div', { class: 'row-actions' }, retry)
    ),
    rail(card, item)
  );
}

/** Notes often embed images with relative paths; load them from the same source. */
export function resolveImages(container, item) {
  container.querySelectorAll('img').forEach(async (img) => {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|\/\/)/i.test(src)) {
      // Web images: drop any that fail rather than show a broken icon.
      // index.html sets no-referrer, which many sites need before they'll serve them.
      if (img.complete && !img.naturalWidth) img.remove();
      else img.addEventListener('error', () => img.remove(), { once: true });
      return;
    }
    if (!src || /^(data:|blob:)/i.test(src)) return;
    img.removeAttribute('src');
    try {
      const blob = await readRelative(item, src.split('#')[0].split('?')[0]);
      img.src = URL.createObjectURL(blob);
    } catch {
      img.alt = img.alt || src;
    }
  });
}

export { escapeHtml };
