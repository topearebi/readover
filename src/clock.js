// The honest clock: when did each note last change? For health in the garden.
//
// GitHub: the date of the last commit that touched the file. Asked in batches through
// GitHub's GraphQL API (about 50 files a request); if that isn't available (no token,
// or the browser is refused), one REST request per file instead, a few at a time.
// Answers are kept on the item with the version they belong to, so a note is only
// asked about again after it changes.
// Local folders: the file's own modified time. This device: when it was saved.
import * as store from './store.js';
import { tokenFor, lastCommitDate } from './sources/github.js';

const BATCH = 50;
const REST_PER_RUN = 1000; // per app open; GitHub allows 5,000 requests an hour
let graphqlWorks = true; // until it fails once in this session

/** The last change for an item, if known for its current version: a timestamp, or null. */
export function changedAt(item) {
  if (!item) return null;
  const sha = String(item.sha || '');
  // The version string of a local file or an on-device note already holds its time.
  const local = /^fs:\d+:(\d+)$/.exec(sha);
  if (local) return Number(local[1]);
  const device = /^dev:(\d+)$/.exec(sha);
  if (device) return Number(device[1]);
  // 0 means "asked, but GitHub had no date": known, and not asked again.
  if (item.changedSha === sha) return item.changedAt || 0;
  return null;
}

async function remember(item, at) {
  const current = await store.items.get(item.key);
  if (current && current.sha === item.sha) await store.items.put({ ...current, changedAt: at, changedSha: item.sha });
}

const gql = (s) => JSON.stringify(String(s));

/** Ask GitHub's GraphQL API for the last commit date of each path. Map path → time. */
async function batchDates(src, paths) {
  const fields = paths.map((p, i) => `f${i}: history(path: ${gql(p)}, first: 1) { nodes { committedDate } }`).join('\n');
  const query = `query { repository(owner: ${gql(src.owner)}, name: ${gql(src.repo)}) { object(expression: ${gql(src.branch || 'main')}) { ... on Commit { ${fields} } } } }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor(src)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const data = await res.json();
  const obj = data?.data?.repository?.object;
  if (!obj) throw new Error(data?.errors?.[0]?.message || 'GraphQL: nothing returned');
  const out = new Map();
  paths.forEach((p, i) => {
    const iso = obj[`f${i}`]?.nodes?.[0]?.committedDate;
    if (iso) out.set(p, Date.parse(iso));
  });
  return out;
}

/**
 * Fill in the clock for notes that don't have it yet. Runs in the background; safe to
 * call often. `onProgress(done, total)`. Returns how many were learned.
 */
let running = null;
export function fill(opts = {}) {
  running = running || run(opts).finally(() => (running = null));
  return running;
}

async function run({ onProgress = () => {} } = {}) {
  const notes = (await store.items.all()).filter((i) => i.kind === 'note' && changedAt(i) === null);
  const bySource = new Map();
  for (const it of notes) {
    const src = store.getSource(it.sourceId);
    if (src?.type !== 'github' || !tokenFor(src) || String(it.sha).startsWith('local:')) continue;
    if (!bySource.has(src.id)) bySource.set(src.id, { src, items: [] });
    bySource.get(src.id).items.push(it);
  }
  const total = [...bySource.values()].reduce((n, g) => n + g.items.length, 0);
  let done = 0;
  let restLeft = REST_PER_RUN;
  for (const { src, items } of bySource.values()) {
    let i = 0;
    while (i < items.length) {
      const chunk = items.slice(i, i + BATCH);
      if (graphqlWorks) {
        try {
          const dates = await batchDates(src, chunk.map((x) => x.path));
          for (const it of chunk) await remember(it, dates.get(it.path) || 0);
          done += chunk.length;
          onProgress(done, total);
          i += BATCH;
          continue;
        } catch (err) {
          if (/rate limit/i.test(err.message)) return done;
          graphqlWorks = false; // fall back to one request per file
        }
      }
      // REST: a few at a time, within this run's allowance.
      const slice = items.slice(i, i + Math.min(restLeft, BATCH));
      if (!slice.length) return done;
      let stop = false;
      await Promise.all(
        [0, 1, 2].map(async (w) => {
          for (let k = w; k < slice.length && !stop; k += 3) {
            try {
              await remember(slice[k], (await lastCommitDate(src, slice[k].path)) || 0);
            } catch (err) {
              if (/rate limit|rejected the token/i.test(err.message)) stop = true;
            }
            done++;
            onProgress(done, total);
          }
        })
      );
      restLeft -= slice.length;
      i += slice.length;
      if (stop || restLeft <= 0) return done;
    }
  }
  return done;
}

/** For tests: forget that GraphQL failed. */
export const resetForTests = () => {
  graphqlWorks = true;
};
