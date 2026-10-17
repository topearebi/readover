// The garden on screen: the growth tag (stage, time since tended, health colour) and
// the sheet it opens (where the note stands, and Water / Graft / Prune).
import { el, closeTop } from './overlay.js';
import { sheet } from './sheet.js';

const STAGES = ['seed', 'sprout', 'sapling', 'tree'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** 3d, 5w, 14mo, 2y. */
export function ageShort(days) {
  if (days == null) return '';
  if (days < 7) return `${days}d`;
  if (days < 56) return `${Math.round(days / 7)}w`;
  if (days < 730) return `${Math.round(days / 30.4)}mo`;
  return `${Math.floor(days / 365)}y`;
}
const daysSince = (t, now = Date.now()) => (t ? Math.max(0, Math.floor((now - t) / 86400000)) : null);

const GLYPHS = {
  seed: '<ellipse cx="8" cy="10" rx="4" ry="3.2" fill="currentColor"/><path d="M8 7c0-2 1-3 2.5-3.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  sprout: '<path d="M8 14V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 9C8 6 6 4.5 3 4.5 3 7.5 5 9 8 9zM8 8c0-3 2-4.5 5-4.5 0 3-2 4.5-5 4.5z" fill="currentColor"/>',
  sapling: '<path d="M8 15V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 11C8 8.5 6 7 3.5 7 3.5 9.5 5.5 11 8 11zM8 8c0-2.5 2-4 4.5-4 0 2.5-2 4-4.5 4zM8 6C8 4 7 2.5 5.5 2c0 2 1 3.5 2.5 4z" fill="currentColor"/>',
  tree: '<path d="M8 15v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="6.5" r="5" fill="currentColor"/>',
  pruned: '<circle cx="4.5" cy="11.5" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="11.5" cy="11.5" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M5.8 10L12 3M10.2 10L4 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  drop: '<path d="M8 2s4.5 5 4.5 8A4.5 4.5 0 0 1 3.5 10C3.5 7 8 2 8 2z" fill="currentColor"/>',
  graft: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  cultivate: '<path d="M8 14V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 9C8 6.5 6.2 5 3.5 5 3.5 7.8 5.2 9 8 9zM8 8.5c0-2.8 2.2-4.2 5-4.2 0 3-2 4.2-5 4.2z" fill="currentColor"/><path d="M3 14c2-.6 4-.6 5-.6s3 0 5 .6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
  note: '<rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
};
export function glyph(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'glyph');
  svg.innerHTML = GLYPHS[name] || '';
  return svg;
}

/** The words on a tag, e.g. "Seed · 31d", "Tree · done · read 14mo ago". */
export function tagText(g, now = Date.now()) {
  if (g.stage === 'pruned') return { main: 'Pruned', rest: '' };
  if (g.resting) {
    const read = daysSince(g.lastRead, now);
    return { main: cap(g.stage), rest: read == null ? 'done' : read === 0 ? 'done · read today' : `done · read ${ageShort(read)} ago` };
  }
  return { main: cap(g.stage), rest: g.days != null ? ageShort(g.days) : '' };
}

/** The pill shown on cards and in the reader. Null for notes without a garden state. */
export function growthTag(g, onOpen) {
  if (!g || ['pending', 'inbox'].includes(g.stage)) return null;
  const { main, rest } = tagText(g);
  const cls = g.stage === 'pruned' ? 'pruned' : g.resting ? 'resting' : g.health || 'unknown';
  const label = `${main}${rest ? `, ${rest}` : ''}${g.health ? `, ${g.health}` : ''}`;
  const btn = el(
    'button',
    { type: 'button', class: `grow ${cls}`, 'aria-label': `${label}. Where this note stands` },
    glyph(g.stage === 'pruned' ? 'pruned' : g.stage),
    el('b', {}, main),
    rest ? el('span', {}, ` · ${rest}`) : null
  );
  btn.onclick = (e) => {
    e.stopPropagation();
    onOpen?.();
  };
  return btn;
}

/**
 * The sheet a tag opens. `on` holds what to do: water(), graft(), prune(), replant(),
 * status('done' | ''), canonical(url). Resolves when closed.
 */
export async function openGrowthSheet(title, g, on) {
  let chosen = null;
  const pick = (fn) => async () => {
    chosen = fn;
    await closeTop();
  };
  const ladder = el(
    'div',
    { class: 'ladder', 'aria-label': `Stage: ${g.stage}` },
    ...STAGES.flatMap((s, i) => [i ? el('span', { 'aria-hidden': 'true' }, '›') : null, el('span', { class: s === g.stage ? 'on' : '' }, cap(s))]).filter(Boolean)
  );
  const since = g.resting ? daysSince(g.lastRead) : g.days;
  const stats = el(
    'div',
    { class: 'grow-stats' },
    el('div', {}, el('b', {}, String(g.thoughts ?? 0)), g.thoughts === 1 ? 'thought' : 'thoughts'),
    el('div', {}, el('b', {}, String(g.connections ?? 0)), g.connections === 1 ? 'graft' : 'grafts'),
    el('div', {}, el('b', {}, since == null ? '–' : ageShort(since)), g.resting ? 'since read' : 'since tended')
  );
  const health = g.stage === 'pruned' ? 'Pruned: kept in Archive, out of the feed.' : g.resting ? 'Done: it rests, so it doesn’t wilt.' : g.health ? `${cap(g.health)}.` : 'Checking when it last changed…';
  const act = (glyphName, name, hint, fn, cls = '') => {
    const b = el('button', { type: 'button', class: `grow-act ${cls}` }, glyph(glyphName), el('b', {}, name), el('span', {}, hint));
    b.onclick = pick(fn);
    return b;
  };
  const fields = [ladder, el('p', { class: 'hint grow-health' }, health), stats];
  if (g.stage !== 'pruned' && on.status) {
    // In progress (no status) or done (`status: done`, rests and doesn't wilt).
    const sel = el('select', { name: 'status', 'aria-label': 'Status' }, el('option', { value: '' }, 'In progress'), el('option', { value: 'done' }, 'Done'));
    sel.value = g.resting ? 'done' : '';
    sel.onchange = () => on.status(sel.value);
    const url = el('input', { type: 'url', name: 'canonical', value: g.canonical || '', placeholder: 'https://… where it was published', autocapitalize: 'off', spellcheck: 'false' });
    url.onchange = () => on.canonical?.(url.value.trim());
    const openLink = g.canonical ? el('a', { href: g.canonical, target: '_blank', rel: 'noopener', class: 'linklike' }, 'Open published version') : null;
    fields.push(el('div', { class: 'field-pair grow-field-pair' }, el('label', { class: 'field' }, 'Status', sel), el('label', { class: 'field' }, 'Published at', url)));
    if (openLink) fields.push(el('p', { class: 'grow-link' }, openLink));
  }
  const acts = el('div', { class: 'grow-acts' });
  if (g.stage === 'pruned') {
    if (on.replant) acts.append(act('sprout', 'Replant', 'back where it was', on.replant));
  } else {
    if (on.prune) acts.append(act('pruned', 'Prune', 'move to Archive', on.prune, 'prune'));
  }
  if (acts.children.length) fields.push(acts);
  const dropGlyph = glyph('drop');
  dropGlyph.style.width = '14px';
  dropGlyph.style.height = '14px';
  dropGlyph.style.verticalAlign = '-2px';
  dropGlyph.style.color = 'var(--healthy)';
  fields.push(
    el(
      'p',
      { class: 'hint grow-toolbar-tip', style: 'margin-top: 14px; font-size: 0.8125rem; color: var(--faint); line-height: 1.4;' },
      'Tip: Water notes using the droplet (',
      dropGlyph,
      ') on the card rail, or graft notes via note actions (⋯).'
    )
  );
  await sheet({ title, fields });
  if (chosen) await chosen();
}
