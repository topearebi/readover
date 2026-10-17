// Knowledge Observatory UI: Systemic health, graph topology,
// macro garden maturity, literature provenance, and topical landscape.

import { el, icon, toast, pushOverlay } from './overlay.js';
import { glyph } from './growth.js';
import { getObservatoryMetrics, plainBookTitle } from '../observatory.js';

let activePopover = null;

export async function openObservatory(app) {
  let dialog = document.getElementById('observatory-sheet');
  if (!dialog) {
    dialog = el('dialog', {
      id: 'observatory-sheet',
      class: 'sheet sheet-tall observatory-sheet',
      'aria-labelledby': 'observatory-title',
    });
    document.body.append(dialog);
  }

  // Loading state
  dialog.replaceChildren(
    el(
      'div',
      { class: 'sheet-inner observatory-inner' },
      el(
        'div',
        { class: 'sheet-head observatory-head' },
        el(
          'div',
          { class: 'sheet-head-titles' },
          el(
            'h2',
            { id: 'observatory-title', class: 'sheet-title' },
            icon('observatory', 'i i-sm'),
            el('span', {}, 'Knowledge Observatory')
          ),
          el('p', { class: 'sheet-subtitle hint' }, 'Systemic health, graph topology & intellectual harvest')
        ),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close Observatory', title: 'Close', 'data-close': '' }, icon('close'))
      ),
      el(
        'div',
        { class: 'observatory-loading' },
        el('div', { class: 'observatory-spinner', 'aria-hidden': 'true' }),
        el('p', { class: 'hint' }, 'Scanning garden topology and calculating graph metrics…')
      )
    )
  );

  let closing = false;
  dialog.showModal();
  const close = pushOverlay(() => {
    closing = true;
    if (dialog.open) dialog.close();
  });

  const onCancel = (e) => {
    e.preventDefault();
    close();
  };
  const onClick = (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) close();
  };
  const onClose = () => {
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('click', onClick);
    dialog.removeEventListener('close', onClose);
  };
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('close', onClose);

  async function loadAndRender() {
    try {
      const metrics = await getObservatoryMetrics();
      if (closing || !dialog.open) return;
      renderObservatory(dialog, metrics, app, { refresh: loadAndRender, close });
    } catch (err) {
      if (closing || !dialog.open) return;
      dialog.querySelector('.observatory-inner')?.replaceChildren(
        el(
          'div',
          { class: 'sheet-head observatory-head' },
          el(
            'div',
            { class: 'sheet-head-titles' },
            el(
              'h2',
              { class: 'sheet-title' },
              icon('observatory', 'i i-sm'),
              el('span', {}, 'Knowledge Observatory')
            ),
            el('p', { class: 'sheet-subtitle hint' }, 'Systemic health, graph topology & intellectual harvest')
          ),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close Observatory', title: 'Close', 'data-close': '' }, icon('close'))
        ),
        el(
          'div',
          { class: 'observatory-error' },
          el('p', {}, `Failed to load metrics: ${err.message}`),
          el('button', { class: 'btn btn-primary', onclick: () => loadAndRender() }, 'Retry')
        )
      );
    }
  }

  await loadAndRender();
}

/**
 * Renders the full Knowledge Observatory dashboard inside the dialog.
 */
export function renderObservatory(dialog, metrics, app, { refresh, close }) {
  let activeTab = 'macro'; // 'macro' | 'topology' | 'harvest' | 'domains'

  const head = el(
    'div',
    { class: 'sheet-head observatory-head' },
    el(
      'div',
      { class: 'sheet-head-titles' },
      el(
        'h2',
        { id: 'observatory-title', class: 'sheet-title' },
        icon('observatory', 'i i-sm'),
        el('span', {}, 'Knowledge Observatory')
      ),
      el('p', { class: 'sheet-subtitle hint' }, 'Systemic health, graph topology & intellectual harvest')
    ),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close Observatory', title: 'Close', onclick: close }, icon('close'))
  );

  const tabs = [
    { id: 'macro', label: 'Macro Garden', iconName: 'cultivate' },
    { id: 'topology', label: 'Graph Topology', iconName: 'graft' },
    { id: 'harvest', label: 'Literature Harvest', iconName: 'book' },
    { id: 'domains', label: 'Domain Landscape', iconName: 'cards' },
  ];

  const nav = el(
    'nav',
    { class: 'observatory-nav observatory-tabs', role: 'tablist', 'aria-label': 'Observatory sections' },
    ...tabs.map((t) => {
      const btn = el(
        'button',
        {
          type: 'button',
          class: `observatory-tab ${t.id === activeTab ? 'is-active' : ''}`,
          role: 'tab',
          'aria-selected': String(t.id === activeTab),
          'data-tab': t.id,
        },
        icon(t.iconName, 'i i-sm'),
        el('span', {}, t.label)
      );
      btn.onclick = () => {
        activeTab = t.id;
        nav.querySelectorAll('.observatory-tab').forEach((b) => {
          const isActive = b.dataset.tab === activeTab;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-selected', String(isActive));
        });
        renderSection();
      };
      return btn;
    })
  );

  const bodyContainer = el('div', { class: 'observatory-body', role: 'region', 'aria-live': 'polite' });

  function renderSection() {
    bodyContainer.replaceChildren();

    if (activeTab === 'macro') {
      bodyContainer.append(buildMacroGardenSection(metrics, app, close));
    } else if (activeTab === 'topology') {
      bodyContainer.append(buildTopologySection(metrics, app, close));
    } else if (activeTab === 'harvest') {
      bodyContainer.append(buildHarvestSection(metrics, app, close));
    } else if (activeTab === 'domains') {
      bodyContainer.append(buildDomainsSection(metrics, app, close));
    }
  }

  renderSection();

  dialog.replaceChildren(
    el(
      'div',
      { class: 'sheet-inner observatory-inner' },
      head,
      nav,
      bodyContainer
    )
  );
}

/* ---------------- Section 1: Macro Garden ---------------- */

function buildMacroGardenSection(metrics, app, close) {
  const container = el('div', { class: 'observatory-section observatory-macro' });

  // 1. Garden Velocity & Health Diagnosis Card
  const diagCard = el(
    'div',
    { class: `observatory-card observatory-diagnosis-card status-${metrics.velocityStatus}` },
    el(
      'div',
      { class: 'diagnosis-header' },
      glyph(metrics.velocityStatus === 'healthy' ? 'cultivate' : metrics.velocityStatus === 'thirsty' ? 'drop' : 'seed'),
      el('b', { class: 'diagnosis-title' }, 'Garden Velocity & Cultivation State')
    ),
    el('p', { class: 'diagnosis-narrative' }, metrics.velocityDiagnosis),
    // Proportional health bar
    el(
      'div',
      { class: 'health-bar', 'aria-label': 'Health distribution bar' },
      metrics.healthProportions.healthy.pct > 0 ? el('span', { class: 'health-segment seg-healthy', style: `width:${metrics.healthProportions.healthy.pct}%`, title: `Healthy: ${metrics.healthProportions.healthy.count} (${metrics.healthProportions.healthy.pct}%)` }) : null,
      metrics.healthProportions.thirsty.pct > 0 ? el('span', { class: 'health-segment seg-thirsty', style: `width:${metrics.healthProportions.thirsty.pct}%`, title: `Thirsty: ${metrics.healthProportions.thirsty.count} (${metrics.healthProportions.thirsty.pct}%)` }) : null,
      metrics.healthProportions.wilting.pct > 0 ? el('span', { class: 'health-segment seg-wilting', style: `width:${metrics.healthProportions.wilting.pct}%`, title: `Wilting: ${metrics.healthProportions.wilting.count} (${metrics.healthProportions.wilting.pct}%)` }) : null,
      metrics.healthProportions.resting.pct > 0 ? el('span', { class: 'health-segment seg-resting', style: `width:${metrics.healthProportions.resting.pct}%`, title: `Resting: ${metrics.healthProportions.resting.count} (${metrics.healthProportions.resting.pct}%)` }) : null
    ),
    el(
      'div',
      { class: 'health-legend' },
      el('span', { class: 'health-chip chip-healthy' }, `Healthy: ${metrics.healthProportions.healthy.count} (${metrics.healthProportions.healthy.pct}%)`),
      el('span', { class: 'health-chip chip-thirsty' }, `Thirsty: ${metrics.healthProportions.thirsty.count} (${metrics.healthProportions.thirsty.pct}%)`),
      el('span', { class: 'health-chip chip-wilting' }, `Wilting: ${metrics.healthProportions.wilting.count} (${metrics.healthProportions.wilting.pct}%)`),
      el('span', { class: 'health-chip chip-resting' }, `Resting (Done): ${metrics.healthProportions.resting.count} (${metrics.healthProportions.resting.pct}%)`)
    )
  );

  // 2. Lifecycle Maturity Ratios
  const stagesData = [
    { id: 'seeds', stage: 'seed', name: 'Seeds', desc: 'Raw capture / fleeting thoughts', data: metrics.maturityProportions.seeds, list: metrics.stages.seed },
    { id: 'sprouts', stage: 'sprout', name: 'Sprouts', desc: 'Developing with initial thought or link', data: metrics.maturityProportions.sprouts, list: metrics.stages.sprout },
    { id: 'saplings', stage: 'sapling', name: 'Saplings', desc: 'Deepening concepts with 2+ links', data: metrics.maturityProportions.saplings, list: metrics.stages.sapling },
    { id: 'trees', stage: 'tree', name: 'Trees', desc: 'Substantial evergreen hubs (5+ links)', data: metrics.maturityProportions.trees, list: metrics.stages.tree },
  ];

  const maturityGrid = el(
    'div',
    { class: 'observatory-maturity-grid' },
    ...stagesData.map((s) => {
      const card = el(
        'div',
        { class: `maturity-card stage-${s.stage}` },
        el(
          'div',
          { class: 'maturity-card-head' },
          glyph(s.stage),
          el('span', { class: 'maturity-name' }, s.name),
          el('span', { class: 'maturity-count tabular' }, String(s.data.count))
        ),
        el('div', { class: 'maturity-bar-wrap' }, el('div', { class: 'maturity-bar', style: `width:${s.data.pct}%` })),
        el('div', { class: 'maturity-card-foot' }, el('span', { class: 'maturity-pct tabular' }, `${s.data.pct}% of active notes`), el('span', { class: 'maturity-desc hint' }, s.desc))
      );
      return card;
    })
  );

  // 3. Quick Stats Ribbon
  const statsRibbon = el(
    'div',
    { class: 'observatory-stats-ribbon' },
    el('div', { class: 'ribbon-stat' }, el('b', { class: 'tabular' }, String(metrics.activeCount)), el('span', { class: 'hint' }, 'Active Notes')),
    el('div', { class: 'ribbon-stat' }, el('b', { class: 'tabular' }, String(metrics.prunedCount)), el('span', { class: 'hint' }, 'Pruned (Archive)')),
    el('div', { class: 'ribbon-stat' }, el('b', { class: 'tabular' }, String(metrics.sourcesCount || metrics.totalGrafts)), el('span', { class: 'hint' }, metrics.sourcesCount ? 'Sources' : 'Total Grafts')),
    el('div', { class: 'ribbon-stat' }, el('b', { class: 'tabular' }, `${metrics.averageConnectivity}`), el('span', { class: 'hint' }, 'Links / Note'))
  );

  container.append(diagCard, maturityGrid, statsRibbon);
  return container;
}

/* ---------------- Section 2: Graph Topology ---------------- */

function buildTopologySection(metrics, app, close) {
  const container = el('div', { class: 'observatory-section observatory-topology' });

  // 1. Metric Overview Cards
  const overview = el(
    'div',
    { class: 'topology-metrics-row' },
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Average Connectivity'), el('span', { class: 'stat-val tabular' }, `${metrics.averageConnectivity}`), el('span', { class: 'stat-sub hint' }, 'links per note')),
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Network Density'), el('span', { class: 'stat-val tabular' }, metrics.density), el('span', { class: 'stat-sub hint' }, 'potential links realized')),
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Orphan Ratio'), el('span', { class: 'stat-val tabular' }, `${metrics.activeCount ? Math.round((metrics.orphans.length / metrics.activeCount) * 100) : 0}%`), el('span', { class: 'stat-sub hint' }, `${metrics.orphans.length} isolated notes`)),
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Longest Chain'), el('span', { class: 'stat-val tabular' }, `${metrics.longestChain.length}`), el('span', { class: 'stat-sub hint' }, 'sequential thoughts'))
  );

  // 2. Orphan Detection & Actionable Triage Card
  const orphanItems = metrics.orphans.slice(0, 8).map((o) => {
    const rowMain = el(
      'div',
      { class: 'row-main clickable', title: `Open note: ${o.title}` },
      glyph(o.stage),
      el('span', { class: 'row-title' }, o.title),
      el('span', { class: 'row-folder badge' }, o.folder || 'Unsorted')
    );
    rowMain.onclick = async () => {
      await close();
      if (app.openItem) app.openItem(o.item);
      else if (app.open) app.open({ _item: o.item });
    };

    const graftBtn = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-sm btn-quiet',
        title: `Graft “${o.title}” to another note`,
        onclick: async (e) => {
          e.stopPropagation();
          const { pickNote, linkFor, addToSection } = await import('./reader.js');
          const { readText, writeNote, canWrite } = await import('../library.js');
          const { getSource } = await import('../store.js');

          const picked = await pickNote(`Graft “${o.title}” to…`, o.item);
          if (!picked) return;

          try {
            const src = getSource(o.item.sourceId);
            if (!canWrite(src)) {
              toast('Cannot edit note in read-only library');
              return;
            }
            const text = await readText(o.item);
            const myLink = await linkFor(picked);
            const theirLink = await linkFor(o.item);
            const newText = addToSection(text, 'Related', `- ${myLink}`);
            await writeNote(src, o.item.path, newText, { message: `Readover: graft ${o.item.path} to ${picked.path}` });

            try {
              const pickedSrc = getSource(picked.sourceId);
              if (canWrite(pickedSrc)) {
                const pickedText = await readText(picked);
                const newPickedText = addToSection(pickedText, 'Related', `- ${theirLink}`);
                await writeNote(pickedSrc, picked.path, newPickedText, { message: `Readover: reciprocal graft from ${o.item.path}` });
              }
            } catch (err) {
              console.warn('Could not write reciprocal graft', err);
            }

            toast(`Grafted “${o.title}” to “${picked.name || picked.path}”`);
            await close();
            if (app.openItem) app.openItem(o.item);
          } catch (err) {
            toast(`Graft failed: ${err.message}`);
          }
        },
      },
      icon('graft', 'i i-sm'),
      el('span', {}, 'Graft')
    );

    const row = el(
      'div',
      { class: 'observatory-list-row' },
      rowMain,
      el(
        'div',
        { class: 'row-actions' },
        el('span', { class: 'row-age hint' }, `${o.days != null ? `${o.days}d untended` : ''}`),
        graftBtn
      )
    );
    return row;
  });

  const orphanCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, `Orphan Detection (${metrics.orphans.length})`),
      el('span', { class: 'badge' }, 'Needs Tending')
    ),
    el('p', { class: 'card-desc hint' }, 'Notes with zero incoming or outgoing connections. High-leverage opportunities to graft into existing clusters or prune to archive.'),
    metrics.orphans.length
      ? el('div', { class: 'observatory-list' }, ...orphanItems)
      : el('p', { class: 'hint observatory-empty-notice' }, 'Excellent! No orphaned notes found. Every idea is connected to the garden.')
  );

  // 3. Conceptual Bridges Card
  const bridgeItems = metrics.bridges.slice(0, 6).map((b) => {
    const rowMain = el(
      'div',
      { class: 'row-main clickable', title: `Open note: ${b.title}` },
      icon('graft', 'i i-sm bridge-glyph'),
      el('div', { class: 'bridge-info' },
        el('span', { class: 'row-title' }, b.title),
        el('div', { class: 'bridge-tags' },
          el('span', { class: 'badge own-folder' }, b.ownFolder),
          el('span', { class: 'bridge-arrow' }, '↔'),
          ...b.bridgedFolders.map((f) => el('span', { class: 'badge bridged-folder' }, f))
        )
      )
    );
    rowMain.onclick = async () => {
      await close();
      if (app.openItem) app.openItem(b.item);
      else if (app.open) app.open({ _item: b.item });
    };

    const row = el(
      'div',
      { class: 'observatory-list-row bridge-row' },
      rowMain,
      el(
        'div',
        { class: 'row-actions' },
        el('span', { class: 'badge connections-badge tabular' }, `${b.connections} links`),
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm btn-quiet',
            title: `Open note: ${b.title}`,
            onclick: async () => {
              await close();
              if (app.openItem) app.openItem(b.item);
              else if (app.open) app.open({ _item: b.item });
            },
          },
          'Open'
        )
      )
    );
    return row;
  });

  const bridgeCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, `Conceptual Bridges (${metrics.bridges.length})`),
      el('span', { class: 'badge' }, 'Cross-Domain Hubs')
    ),
    el('p', { class: 'card-desc hint' }, 'Notes connecting multiple distinct top-level categories. These nexus notes are prime candidates for long-form essays or cross-disciplinary synthesis.'),
    metrics.bridges.length
      ? el('div', { class: 'observatory-list' }, ...bridgeItems)
      : el('p', { class: 'hint observatory-empty-notice' }, 'Add links between notes in different folders to reveal cross-domain conceptual bridges.')
  );

  // 4. Deepest Associative Pathway
  const chainNodes = metrics.longestChain.map((node, i) => {
    const nodeEl = el(
      'button',
      {
        type: 'button',
        class: 'chain-node',
        title: `Open ${node.title}`,
        onclick: async () => {
          await close();
          if (app.openItem) app.openItem(node.item);
          else if (app.open) app.open({ _item: node.item });
        },
      },
      glyph(node.stage),
      el('span', { class: 'chain-node-title' }, node.title),
      el('span', { class: 'chain-node-folder badge' }, node.folder)
    );

    if (i < metrics.longestChain.length - 1) {
      return el('div', { class: 'chain-step' }, nodeEl, el('span', { class: 'chain-arrow', 'aria-hidden': 'true' }, '→'));
    }
    return el('div', { class: 'chain-step' }, nodeEl);
  });

  const chainCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, `Deepest Associative Pathway (${metrics.longestChain.length} steps)`),
      el('span', { class: 'badge' }, 'Idea Branching')
    ),
    el('p', { class: 'card-desc hint' }, 'Traces the longest sequential path of linked thoughts across your graph, showing how deeply your concepts evolve.'),
    metrics.longestChain.length > 1
      ? el('div', { class: 'chain-track' }, ...chainNodes)
      : el('p', { class: 'hint observatory-empty-notice' }, 'Link notes together to trace sequential associative pathways.')
  );

  container.append(overview, orphanCard, bridgeCard, chainCard);
  return container;
}

/* ---------------- Section 3: Literature Harvest ---------------- */

function buildHarvestSection(metrics, app, close) {
  const container = el('div', { class: 'observatory-section observatory-harvest' });

  const totalHarvestCount = metrics.booksHarvest.reduce((acc, b) => acc + b.totalHarvest, 0);
  const totalYieldCount = metrics.booksHarvest.reduce((acc, b) => acc + b.citationYield, 0);

  const summary = el(
    'div',
    { class: 'topology-metrics-row' },
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Connected Books'), el('span', { class: 'stat-val tabular' }, String(metrics.booksHarvest.length)), el('span', { class: 'stat-sub hint' }, 'titles harvested')),
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Total Extracted Passages'), el('span', { class: 'stat-val tabular' }, String(totalHarvestCount)), el('span', { class: 'stat-sub hint' }, 'highlights & insights')),
    el('div', { class: 'topology-stat-card' }, el('span', { class: 'stat-label' }, 'Downstream Citation Yield'), el('span', { class: 'stat-val tabular' }, String(totalYieldCount)), el('span', { class: 'stat-sub hint' }, 'networked links spawned'))
  );

  const bookRows = metrics.booksHarvest.map((b) => {
    const coverSwatch = el('div', { class: 'book-swatch' });
    if (b.blob) {
      coverSwatch.append(el('img', { alt: '', src: URL.createObjectURL(b.blob) }));
    } else {
      coverSwatch.append(icon('book', 'i i-sm'));
    }

    const formatBadge = el('span', { class: 'badge format-badge' }, b.format || (b.item?.kind === 'pdf' || b.item?.path?.endsWith('.pdf') ? 'PDF' : 'EPUB'));

    const openBookAction = async () => {
      await close();
      if (app.openBook) app.openBook(b.item);
      else if (app.openItem) app.openItem(b.item);
      else if (app.openBookRef) app.openBookRef(b.key || b.item.path);
    };

    const row = el(
      'div',
      { class: 'observatory-book-card' },
      el(
        'div',
        { class: 'book-card-main clickable', title: `Read ${b.title}`, onclick: openBookAction },
        coverSwatch,
        el(
          'div',
          { class: 'book-details' },
          el(
            'div',
            { class: 'book-title-row' },
            el('b', { class: 'book-title' }, b.title),
            formatBadge
          ),
          b.author ? el('span', { class: 'book-author hint' }, b.author) : null,
          el(
            'div',
            { class: 'book-metrics-pills' },
            el('span', { class: 'badge' }, icon('marker', 'i i-sm'), el('span', {}, `${b.highlightsCount} in-book highlights`)),
            el('span', { class: 'badge' }, icon('pen', 'i i-sm'), el('span', {}, `${b.literatureNotesCount} literature notes`)),
            el('span', { class: 'badge yield-badge' }, icon('graft', 'i i-sm'), el('span', {}, `${b.citationYield} citation yield`))
          )
        )
      ),
      el(
        'div',
        { class: 'book-card-actions' },
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm btn-primary',
            title: `Read ${b.title}`,
            onclick: openBookAction,
          },
          icon('open', 'i i-sm'),
          el('span', {}, 'Read Book')
        )
      )
    );
    return row;
  });

  const listCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, 'Top Harvested Books'),
      el('span', { class: 'badge' }, 'Provenance Ranking')
    ),
    el('p', { class: 'card-desc hint' }, 'Books that have provided the most citations, excerpts, and intellectual substrate to your notes.'),
    metrics.booksHarvest.length
      ? el('div', { class: 'observatory-books-list' }, ...bookRows)
      : el('p', { class: 'hint observatory-empty-notice' }, 'Read EPUBs or PDFs and highlight passages to start building your literature harvest.')
  );

  container.append(summary, listCard);
  return container;
}

/* ---------------- Section 4: Domain Landscape ---------------- */

function buildDomainsSection(metrics, app, close) {
  const container = el('div', { class: 'observatory-section observatory-domains' });

  // 1. Folder / Type Proportions
  const folderRows = metrics.folderDistribution.map((f) => {
    return el(
      'div',
      { class: 'domain-row' },
      el('div', { class: 'domain-row-label' }, el('b', {}, f.folder), el('span', { class: 'tabular hint' }, `${f.count} notes (${f.pct}%)`)),
      el('div', { class: 'domain-bar-bg' }, el('div', { class: 'domain-bar-fill', style: `width:${f.pct}%` }))
    );
  });

  const folderCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, 'Folder & Domain Proportions'),
      el('span', { class: 'badge' }, `${metrics.folderDistribution.length} Folders`)
    ),
    el('p', { class: 'card-desc hint' }, 'Distribution of your active notes across top-level types and organizational folders.'),
    el('div', { class: 'domain-list' }, ...folderRows)
  );

  // 2. Tag Landscape
  const tagChips = metrics.tagLandscape.slice(0, 30).map((t) => {
    const chip = el(
      'button',
      {
        type: 'button',
        class: 'tag-chip',
        title: `Filter notes tagged #${t.tag}`,
        onclick: async () => {
          await close();
          if (app.showView) app.showView('notes');
          const notesSearch = document.querySelector('.notes-search');
          if (notesSearch) {
            notesSearch.value = `#${t.tag}`;
            notesSearch.dispatchEvent(new Event('input', { bubbles: true }));
          }
        },
      },
      el('span', { class: 'tag-name' }, `#${t.tag}`),
      el('span', { class: 'tag-count tabular' }, String(t.count))
    );
    return chip;
  });

  const tagCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, 'Tag Landscape'),
      el('span', { class: 'badge' }, `${metrics.tagLandscape.length} Tags`)
    ),
    el('p', { class: 'card-desc hint' }, 'Most frequently occurring tags. Tap any tag to filter your notes view directly.'),
    metrics.tagLandscape.length
      ? el('div', { class: 'tag-cloud' }, ...tagChips)
      : el('p', { class: 'hint observatory-empty-notice' }, 'Use #tags in note bodies or frontmatter to visualize your concept landscape.')
  );

  // 3. Emergent Concept Clusters (Tag Co-occurrence)
  const clusterRows = metrics.conceptClusters.map((c) => {
    return el(
      'div',
      { class: 'cluster-row' },
      el('div', { class: 'cluster-tags' },
        el('span', { class: 'badge tag-badge' }, `#${c.tagA}`),
        el('span', { class: 'cluster-sym' }, '↔'),
        el('span', { class: 'badge tag-badge' }, `#${c.tagB}`)
      ),
      el('span', { class: 'cluster-count tabular hint' }, `${c.count} shared notes`)
    );
  });

  const clusterCard = el(
    'div',
    { class: 'observatory-card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', { class: 'card-title' }, 'Thematic Clusters (Tag Co-occurrence)'),
      el('span', { class: 'badge' }, 'Emergent Themes')
    ),
    el('p', { class: 'card-desc hint' }, 'Pairs of concepts that frequently appear together in the same note, revealing thematic intersection.'),
    metrics.conceptClusters.length
      ? el('div', { class: 'cluster-list' }, ...clusterRows)
      : el('p', { class: 'hint observatory-empty-notice' }, 'When multiple tags are used together on notes, co-occurrence clusters appear here.')
  );

  container.append(folderCard, tagCard, clusterCard);
  return container;
}

