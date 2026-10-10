// When was a note written? Used for "On this day" and "From 3 years ago".
// In order of trust: frontmatter (date / created), a date in the file name
// (2023-10-10, 20231010, or a Zettelkasten id like 202310101200), a year folder
// (Journal/2019), and for GitHub notes the date it last changed (one request,
// cached until the note changes).
import { items } from './store.js';
import * as store from './store.js';
import * as github from './sources/github.js';

const DAY = 86400000;
const valid = (y, m, d) => y >= 1970 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= 31;

export function fromText(s) {
  const iso = /(?:^|[^\d])((?:19|20)\d\d)-(\d\d)-(\d\d)(?!\d)/.exec(s);
  if (iso && valid(+iso[1], +iso[2], +iso[3])) return { at: Date.UTC(+iso[1], +iso[2] - 1, +iso[3]), precision: 'day' };
  const compact = /(?:^|[^\d])((?:19|20)\d\d)(\d\d)(\d\d)(?:\d{4})?(?!\d)/.exec(s);
  if (compact && valid(+compact[1], +compact[2], +compact[3])) return { at: Date.UTC(+compact[1], +compact[2] - 1, +compact[3]), precision: 'day' };
  return null;
}

export function fromPath(path) {
  const name = path.split('/').pop();
  const d = fromText(name);
  if (d) return { ...d, kind: 'written' };
  const year = path.split('/').slice(0, -1).reverse().find((p) => /^(19|20)\d\d$/.test(p));
  if (year && +year <= new Date().getFullYear()) return { at: Date.UTC(+year, 6, 1), precision: 'year', kind: 'written' };
  return null;
}

export function fromMeta(meta = {}) {
  for (const k of ['date', 'created', 'created_at', 'creation date', 'date created']) {
    if (!meta[k]) continue;
    const d = fromText(String(meta[k]));
    if (d) return { ...d, kind: 'written' };
    const t = Date.parse(meta[k]);
    if (!Number.isNaN(t)) return { at: t, precision: 'day', kind: 'written' };
  }
  return null;
}

/** What's known without downloading anything. */
export function knownDate(item) {
  if (item.dateAt && item.dateSha === item.sha) return { at: item.dateAt, precision: item.datePrecision, kind: item.dateKind };
  return fromPath(item.path);
}

/** Work out (and remember) a note's date once its text is loaded. */
export async function learnDate(item, note) {
  if (item.dateSha === item.sha) return knownDate(item);
  let d = fromMeta(note?.meta) || fromPath(item.path);
  if (!d) {
    const src = store.getSource(item.sourceId);
    if (src?.type === 'github' && github.canWrite(src) && !String(item.sha).startsWith('local:')) {
      try {
        const at = await github.lastCommitDate(src, item.path);
        if (at) d = { at, precision: 'day', kind: 'touched' };
      } catch {}
    }
  }
  const current = await items.get(item.key);
  if (current && current.sha === item.sha) {
    await items.put({ ...current, dateAt: d?.at || 0, datePrecision: d?.precision || '', dateKind: d?.kind || '', dateSha: item.sha });
  }
  return d;
}

/** "On this day in 2023", "From 3 years ago", "Last changed 2 years ago", or ''. */
export function memoryLine(d, now = Date.now()) {
  if (!d?.at || now - d.at < 330 * DAY) return '';
  const then = new Date(d.at);
  const today = new Date(now);
  const years = Math.max(1, Math.floor((now - d.at) / (365.25 * DAY)));
  if (d.precision === 'day' && d.kind === 'written' && then.getUTCMonth() === today.getMonth() && then.getUTCDate() === today.getDate()) {
    return `On this day in ${then.getUTCFullYear()}`;
  }
  if (d.precision === 'year') return `From ${then.getUTCFullYear()}`;
  const ago = years === 1 ? 'a year ago' : `${years} years ago`;
  return d.kind === 'touched' ? `Last changed ${ago}` : `From ${ago}`;
}

export const isOnThisDay = (d, now = Date.now()) => memoryLine(d, now).startsWith('On this day');
