// Knowledge Observatory: In-memory meta analytics, graph topology,
// macro garden maturity, literature provenance, and topical landscape.

import * as store from './store.js';
import { entries, resolve } from './notes-index.js';
import { garden, isArchived } from './garden.js';
import { typeOf } from './notefile.js';

const ARCHIVE_RE = /(^|\/)archive\//i;

/** Is the line containing this character offset a quote citation line ("> — ...")? */
function inSourceLine(text, at) {
  if (!text || at == null || at < 0) return false;
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  return /^\s*>\s*(—|–|--)\s/.test(text.slice(start, end < 0 ? undefined : end));
}

/** Normalized plain title of a book item */
export function plainBookTitle(item) {
  if (!item?.name) return 'Untitled Book';
  return item.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
}

/** Extract all tags (frontmatter + inline `#tags`) from a note */
export function extractNoteTags(meta, body = '') {
  const tags = new Set();
  const rawList = meta?.tags || meta?.tag;
  if (Array.isArray(rawList)) {
    for (const t of rawList) {
      const clean = String(t || '').trim().replace(/^#/, '').toLowerCase();
      if (clean) tags.add(clean);
    }
  } else if (typeof rawList === 'string' && rawList.trim()) {
    const parts = rawList.replace(/[[\]]/g, '').split(/[,\s]+/);
    for (const p of parts) {
      const clean = p.trim().replace(/^#/, '').toLowerCase();
      if (clean) tags.add(clean);
    }
  }

  // Inline #tags (excluding headings and markdown anchors)
  for (const m of String(body || '').matchAll(/(?:^|\s)#([A-Za-z][\w/-]{1,40})/g)) {
    const t = m[1].trim().toLowerCase();
    if (t) tags.add(t);
  }

  return [...tags];
}

/**
 * Computes deep sequential pathways (longest directed chain of notes)
 * using memoized DFS with cycle avoidance.
 */
export function computeLongestChain(activeKeys, outgoingMap, entryMap, gardenMap) {
  const memo = new Map();
  const visiting = new Set();

  function dfs(key) {
    if (visiting.has(key)) return []; // cycle guard
    if (memo.has(key)) return memo.get(key);

    visiting.add(key);
    const targets = outgoingMap.get(key) || new Set();
    let bestSub = [];

    for (const targetKey of targets) {
      const sub = dfs(targetKey);
      if (sub.length > bestSub.length) {
        bestSub = sub;
      }
    }
    visiting.delete(key);

    const result = [key, ...bestSub];
    memo.set(key, result);
    return result;
  }

  let longestKeys = [];
  for (const key of activeKeys) {
    const path = dfs(key);
    if (path.length > longestKeys.length) {
      longestKeys = path;
    }
  }

  return longestKeys.map((k) => {
    const e = entryMap.get(k);
    const g = gardenMap.get(k);
    return {
      key: k,
      item: e?.item || { key: k, path: k },
      title: e?.title || k.split('|').pop() || 'Untitled',
      folder: g?.type || 'Unsorted',
      stage: g?.stage || 'seed',
    };
  });
}

/**
 * Pure in-memory calculation of all observatory analytics.
 */
export function computeObservatoryMetrics({ allNotes, gardenMap, allBooks = [], progressList = [], thumbsList = [] }) {
  const progressMap = new Map(progressList.map((p) => [p.key, p]));
  const thumbsMap = new Map(thumbsList.map((t) => [t.key, t]));
  const entryMap = new Map(allNotes.map((e) => [e.item.key, e]));

  // 1. Separate Active vs Pruned/Archived
  const activeEntries = [];
  const prunedEntries = [];

  for (const e of allNotes) {
    if (!e.aliases) e.aliases = [];
    const isPruned = ARCHIVE_RE.test(e.item.path) || Boolean(e.meta?.pruned);
    if (isPruned) {
      prunedEntries.push(e);
    } else {
      activeEntries.push(e);
    }
  }

  const activeKeys = new Set(activeEntries.map((e) => e.item.key));
  const activeCount = activeEntries.length;

  // 2. Build Link Graph (Directed and Undirected)
  const outgoingMap = new Map(); // key -> Set<targetKey>
  const incomingMap = new Map(); // key -> Set<sourceKey>
  const undirectedMap = new Map(); // key -> Set<neighborKey>

  for (const key of activeKeys) {
    outgoingMap.set(key, new Set());
    incomingMap.set(key, new Set());
    undirectedMap.set(key, new Set());
  }

  for (const e of activeEntries) {
    const fromKey = e.item.key;
    for (const link of e.links || []) {
      if (inSourceLine(e.text, link.at)) continue;
      const target = resolve(link, e, allNotes);
      if (!target) continue;
      const toKey = target.item.key;
      if (toKey === fromKey || !activeKeys.has(toKey)) continue;

      outgoingMap.get(fromKey).add(toKey);
      incomingMap.get(toKey).add(fromKey);
      undirectedMap.get(fromKey).add(toKey);
      undirectedMap.get(toKey).add(fromKey);
    }
  }

  // 3. Macro Garden Maturity & Health
  const stages = { seed: [], sprout: [], sapling: [], tree: [] };
  const healths = { healthy: [], thirsty: [], wilting: [], resting: [] };

  for (const e of activeEntries) {
    const g = gardenMap.get(e.item.key) || { stage: 'seed', health: null, resting: false, type: '' };
    const stage = ['seed', 'sprout', 'sapling', 'tree'].includes(g.stage) ? g.stage : 'seed';
    const noteInfo = {
      key: e.item.key,
      item: e.item,
      title: e.title,
      folder: g.type || 'Unsorted',
      days: g.days,
      connections: undirectedMap.get(e.item.key)?.size || 0,
      stage,
      health: g.health,
    };

    stages[stage].push(noteInfo);

    if (g.resting || g.status === 'done') {
      healths.resting.push(noteInfo);
    } else if (g.health === 'healthy') {
      healths.healthy.push(noteInfo);
    } else if (g.health === 'thirsty') {
      healths.thirsty.push(noteInfo);
    } else if (g.health === 'wilting') {
      healths.wilting.push(noteInfo);
    }
  }

  const maturityProportions = {
    seeds: { count: stages.seed.length, pct: activeCount ? Math.round((stages.seed.length / activeCount) * 100) : 0 },
    sprouts: { count: stages.sprout.length, pct: activeCount ? Math.round((stages.sprout.length / activeCount) * 100) : 0 },
    saplings: { count: stages.sapling.length, pct: activeCount ? Math.round((stages.sapling.length / activeCount) * 100) : 0 },
    trees: { count: stages.tree.length, pct: activeCount ? Math.round((stages.tree.length / activeCount) * 100) : 0 },
  };

  const healthProportions = {
    healthy: { count: healths.healthy.length, pct: activeCount ? Math.round((healths.healthy.length / activeCount) * 100) : 0 },
    thirsty: { count: healths.thirsty.length, pct: activeCount ? Math.round((healths.thirsty.length / activeCount) * 100) : 0 },
    wilting: { count: healths.wilting.length, pct: activeCount ? Math.round((healths.wilting.length / activeCount) * 100) : 0 },
    resting: { count: healths.resting.length, pct: activeCount ? Math.round((healths.resting.length / activeCount) * 100) : 0 },
  };

  // Editorial velocity diagnosis
  let velocityDiagnosis = 'Balanced Ecosystem: Steady synthesis and cultivation.';
  let velocityStatus = 'healthy';
  const thirstyWiltingRatio = activeCount ? (healths.thirsty.length + healths.wilting.length) / activeCount : 0;
  const treesRatio = activeCount ? stages.tree.length / activeCount : 0;
  const seedsRatio = activeCount ? stages.seed.length / activeCount : 0;

  if (activeCount === 0) {
    velocityDiagnosis = 'Empty Garden: Add or write your first notes to begin cultivation.';
    velocityStatus = 'resting';
  } else if (thirstyWiltingRatio >= 0.35) {
    velocityDiagnosis = `Cultivation Needed: ${Math.round(thirstyWiltingRatio * 100)}% of notes are thirsty or wilting. Revisit older ideas to water them.`;
    velocityStatus = 'thirsty';
  } else if (treesRatio >= 0.25) {
    velocityDiagnosis = `Synthesis-Dense: ${Math.round(treesRatio * 100)}% of your garden is anchored by mature evergreen tree notes.`;
    velocityStatus = 'healthy';
  } else if (seedsRatio >= 0.5) {
    velocityDiagnosis = `High Capture Velocity: Over half of your notes are seeds waiting for initial grafts and thoughts.`;
    velocityStatus = 'healthy';
  }

  // 4. Topological Graph Insights
  let totalEdges = 0;
  for (const set of undirectedMap.values()) {
    totalEdges += set.size;
  }
  totalEdges = Math.floor(totalEdges / 2);

  const averageConnectivity = activeCount ? (totalEdges * 2 / activeCount).toFixed(1) : '0.0';
  const density = activeCount > 1 ? ((2 * totalEdges) / (activeCount * (activeCount - 1)) * 100).toFixed(1) + '%' : '0%';

  // 4.1 Orphans: 0 incoming, 0 outgoing
  const orphans = [];
  for (const e of activeEntries) {
    const k = e.item.key;
    if ((undirectedMap.get(k)?.size || 0) === 0) {
      const g = gardenMap.get(k);
      orphans.push({
        key: k,
        item: e.item,
        title: e.title,
        folder: g?.type || 'Unsorted',
        days: g?.days ?? 0,
        stage: g?.stage || 'seed',
      });
    }
  }
  orphans.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

  // 4.2 Conceptual Bridges: Notes connecting 2+ distinct categories
  const bridges = [];
  for (const e of activeEntries) {
    const k = e.item.key;
    const g = gardenMap.get(k);
    const ownFolder = g?.type || 'Unsorted';
    const neighbors = undirectedMap.get(k) || new Set();
    if (!neighbors.size) continue;

    const crossFolders = new Set();
    for (const nKey of neighbors) {
      const nG = gardenMap.get(nKey);
      const nFolder = nG?.type || 'Unsorted';
      if (nFolder !== ownFolder) {
        crossFolders.add(nFolder);
      }
    }

    if (crossFolders.size >= 1) {
      const breadth = crossFolders.size;
      const score = breadth * 10 + neighbors.size;
      bridges.push({
        key: k,
        item: e.item,
        title: e.title,
        ownFolder,
        bridgedFolders: [...crossFolders],
        connections: neighbors.size,
        score,
      });
    }
  }
  bridges.sort((a, b) => b.score - a.score || b.connections - a.connections);

  // 4.3 Deepest Associative Chain
  const longestChain = computeLongestChain(activeKeys, outgoingMap, entryMap, gardenMap);

  // 5. Literature Harvest & Provenance
  const booksHarvest = [];
  for (const book of allBooks) {
    const p = progressMap.get(book.key);
    const m = thumbsMap.get(book.key);
    const bookTitle = m?.title || plainBookTitle(book);
    const plainTitleNorm = plainBookTitle(book).toLowerCase().trim();
    const titleNorm = bookTitle.toLowerCase().trim();
    const inBookHighlights = p?.highlights || [];

    // Find notes referencing this book
    const citingNotes = [];
    for (const e of activeEntries) {
      let isMatch = false;
      const meta = e.meta || {};

      // Match 1: book_ref
      if (meta.book_ref) {
        const ref = String(meta.book_ref);
        if (ref === book.key || ref.endsWith(book.path) || (book.name && ref.endsWith(book.name))) {
          isMatch = true;
        }
      }

      // Match 2: meta.source or meta.book_title
      if (!isMatch && (meta.source || meta.book_title)) {
        const srcStr = String(meta.source || meta.book_title).toLowerCase().trim();
        if (srcStr === titleNorm || srcStr === plainTitleNorm) {
          isMatch = true;
        }
      }

      // Match 3: <!-- readover {"book":"..."} --> anchor
      if (!isMatch && e.text.includes('readover')) {
        const match = /<!--\s*readover\s*(\{[\s\S]*?\})\s*-->/.exec(e.text);
        if (match) {
          try {
            const anchor = JSON.parse(match[1]);
            if (anchor.book && (anchor.book === book.key || anchor.book.endsWith(book.path) || (book.name && anchor.book.endsWith(book.name)))) {
              isMatch = true;
            }
          } catch {}
        }
      }

      // Match 4: [[Book Title]] wikilink citation callout
      if (!isMatch) {
        const quoteCallout = `[[${bookTitle}]]`.toLowerCase();
        const quotePlain = `[[${plainBookTitle(book)}]]`.toLowerCase();
        if (e.lower.includes(quoteCallout) || e.lower.includes(quotePlain)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        citingNotes.push({
          key: e.item.key,
          item: e.item,
          title: e.title,
          connections: undirectedMap.get(e.item.key)?.size || 0,
        });
      }
    }

    const highlightsCount = inBookHighlights.length;
    const literatureNotesCount = citingNotes.length;
    const totalHarvest = highlightsCount + literatureNotesCount;

    // Downstream citation yield: sum of 1 + connections of each citing note
    const citationYield = citingNotes.reduce((sum, n) => sum + 1 + n.connections, 0);

    const ext = (book.path || book.name || '').split('.').pop().toLowerCase();
    const format = (book.kind === 'pdf' || ext === 'pdf') ? 'PDF' : 'EPUB';

    if (totalHarvest > 0 || p?.updatedAt) {
      booksHarvest.push({
        key: book.key,
        item: book,
        title: bookTitle,
        author: m?.author || '',
        blob: m?.blob || null,
        format,
        highlightsCount,
        literatureNotesCount,
        totalHarvest,
        citationYield,
        citingNotes,
      });
    }
  }

  booksHarvest.sort((a, b) => b.totalHarvest - a.totalHarvest || b.citationYield - a.citationYield);

  // 6. Vocabulary & Domain Distribution
  const folderCounts = new Map();
  for (const e of activeEntries) {
    const g = gardenMap.get(e.item.key);
    const folder = g?.type || 'Unsorted';
    folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
  }

  const folderDistribution = [...folderCounts.entries()]
    .map(([folder, count]) => ({
      folder,
      count,
      pct: activeCount ? Math.round((count / activeCount) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Tag landscape and concept co-occurrence clusters
  const tagCounts = new Map(); // tag -> { count, noteKeys: Set }
  const pairCounts = new Map(); // "tagA|tagB" -> count

  for (const e of activeEntries) {
    const tags = extractNoteTags(e.meta, e.text);
    for (const t of tags) {
      let entry = tagCounts.get(t);
      if (!entry) {
        entry = { tag: t, count: 0, noteKeys: new Set() };
        tagCounts.set(t, entry);
      }
      entry.count++;
      entry.noteKeys.add(e.item.key);
    }

    // Co-occurrence
    if (tags.length > 1) {
      const sortedTags = [...new Set(tags)].sort();
      for (let i = 0; i < sortedTags.length; i++) {
        for (let j = i + 1; j < sortedTags.length; j++) {
          const pairKey = `${sortedTags[i]}|${sortedTags[j]}`;
          pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        }
      }
    }
  }

  const tagLandscape = [...tagCounts.values()]
    .map((t) => ({ tag: t.tag, count: t.count }))
    .sort((a, b) => b.count - a.count);

  const conceptClusters = [...pairCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([pair, count]) => {
      const [tagA, tagB] = pair.split('|');
      return { tagA, tagB, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const sourcesCount = new Set([
    ...allNotes.map((n) => n.item?.sourceId).filter(Boolean),
    ...allBooks.map((b) => b.sourceId).filter(Boolean),
  ]).size;

  return {
    totalNotes: allNotes.length,
    activeCount,
    prunedCount: prunedEntries.length,
    totalBooks: allBooks.length,
    sourcesCount,
    stages,
    healths,
    maturityProportions,
    healthProportions,
    velocityDiagnosis,
    velocityStatus,
    totalGrafts: totalEdges,
    averageConnectivity,
    density,
    orphans,
    bridges,
    longestChain,
    booksHarvest,
    folderDistribution,
    tagLandscape,
    conceptClusters,
  };
}

/**
 * Loads all stores and builds full observatory analytics asynchronously.
 */
export async function getObservatoryMetrics() {
  const [allNotesRaw, gardenMap, allItems, progressList, thumbsList] = await Promise.all([
    entries(),
    garden().catch(() => new Map()),
    store.items.all(),
    store.progress.all().catch(() => []),
    store.thumbs.all().catch(() => []),
  ]);

  const allNotes = allNotesRaw.filter((e) => store.getSource(e.item.sourceId));
  const allBooks = allItems.filter((i) => i.kind !== 'note' && store.getSource(i.sourceId));

  return computeObservatoryMetrics({
    allNotes,
    gardenMap,
    allBooks,
    progressList,
    thumbsList,
  });
}
