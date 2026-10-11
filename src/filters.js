// Growth and type filters, shared by the feed ("What to show") and the Notes tab.
// Each works on a note's garden entry (garden.js). Books have none, so they only show
// when no filter is set; notes not on the device yet pass a type filter, not growth.
//
// Types are top-level folders. A type filter is a list of folder names ('' = the top
// level, shown as Unsorted); an empty list means any type. Folders with the same name
// in different libraries are one type.

export const GROWTH_FILTERS = [
  { id: 'any', label: 'Any', test: () => true },
  { id: 'seeds', label: 'Seeds', test: (g) => g.stage === 'seed' },
  { id: 'water', label: 'Needs water', test: (g) => g.health === 'thirsty' || g.health === 'wilting' },
  { id: 'wilting', label: 'Wilting', test: (g) => g.health === 'wilting' },
  { id: 'trees', label: 'Trees', test: (g) => g.stage === 'tree' },
  { id: 'done', label: 'Done', test: (g) => g.resting && g.stage !== 'pruned' },
  { id: 'pruned', label: 'Pruned', test: (g) => g.stage === 'pruned' },
];

export const UNSORTED_LABEL = 'Unsorted';
const low = (s) => String(s || '').toLowerCase();

export const growthFilter = (id) => GROWTH_FILTERS.find((f) => f.id === (id === 'resting' ? 'done' : id)) || GROWTH_FILTERS[0];
/** A saved type choice as a clean list (older versions saved a single id). */
export const typeList = (types) => (Array.isArray(types) ? types.map(String) : []);
export const isFiltered = (growth = 'any', types = []) => growthFilter(growth).id !== 'any' || typeList(types).length > 0;
const typeMatch = (g, types) => !types.length || types.some((t) => low(t) === low(g.type));

/**
 * Does a note's garden entry pass both filters? Pruned notes only pass the Pruned
 * filter (they're out of sight otherwise); notes without an entry only pass no filter.
 */
export function passes(g, growth = 'any', types = []) {
  const list = typeList(types);
  if (!isFiltered(growth, list)) return !g || g.stage !== 'pruned';
  if (!g) return false;
  const gf = growthFilter(growth);
  // Notes not on the device yet, and inboxes, have a type (their folder) but no growth.
  if (['pending', 'inbox'].includes(g.stage)) return gf.id === 'any' && typeMatch(g, list);
  if (g.stage === 'pruned' && gf.id !== 'pruned') return false;
  return gf.test(g) && typeMatch(g, list);
}

/**
 * The types in these garden entries, for a checklist: [{ id, label, count }], folders
 * A–Z then Unsorted. Counts honour the growth filter. Archive isn't a type.
 */
export function typeOptions(entries, growth = 'any') {
  const names = new Map(); // lower-case → first spelling seen
  const count = new Map();
  for (const g of entries) {
    if (!g || g.type == null) continue;
    if (low(g.type) === 'archive' || g.type.startsWith('.')) continue;
    const k = low(g.type);
    if (!names.has(k)) names.set(k, g.type);
    if (passes(g, growth, [g.type])) count.set(k, (count.get(k) || 0) + 1);
  }
  const out = [...names].filter(([k]) => k !== '').sort((a, b) => a[1].localeCompare(b[1])).map(([k, name]) => ({ id: name, label: name, count: count.get(k) || 0 }));
  if (names.has('')) out.push({ id: '', label: UNSORTED_LABEL, count: count.get('') || 0 });
  return out;
}

/** How many entries each growth option would show, given the types chosen. */
export function counts(entries, growth = 'any', types = []) {
  const list = [...entries];
  return {
    growth: Object.fromEntries(GROWTH_FILTERS.map((f) => [f.id, list.filter((g) => passes(g, f.id, types)).length])),
    types: typeOptions(list, growth),
  };
}

/** A short label for what's active, e.g. "Wilting · Essays, Journal". */
export function filterLabel(growth = 'any', types = []) {
  const list = typeList(types);
  const gf = growthFilter(growth);
  const t = list.length > 2 ? `${list.length} types` : list.map((x) => x || UNSORTED_LABEL).join(', ');
  return [gf.id !== 'any' ? gf.label : '', t].filter(Boolean).join(' · ');
}
