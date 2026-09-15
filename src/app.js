// src/app.js
import {
  initVaultDB,
  getActiveDB,
  getDeckQueue,
  markSeen,
  toggleStar,
  deleteVaultDB,
} from './db.js';

import {
  getVaultProfiles,
  getActiveVaultId,
  setActiveVaultId,
  saveVaultProfile,
  deleteVaultProfile,
  getGlobalToken,
  setGlobalToken,
  getActiveVaultConfig,
  checkRemoteUpdates,
  syncRepoManifest,
  fetchNoteContent,
  saveNoteFile,
  preloadBatchContent,
} from './github.js';

import { parseMarkdownToCard } from './parser.js';
import { createCardElement } from './components/card.js';

class AppController {
  constructor() {
    this.deckQueue = [];
    this.activeFolder = 'ALL';
    this.filterMode = 'all';
    this.isLoading = false;
    this.hasMore = true;

    this.viewport = document.getElementById('feed-viewport');
    this.statusEl = document.getElementById('status-indicator');

    this.initTheme();
    this.initElements();
    this.initObserver();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.initAutoSyncWatcher();
    this.boot();
  }

  initTheme() {
    const savedTheme = localStorage.getItem('md_deck_theme') || 'light';
    this.setTheme(savedTheme);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('md_deck_theme', theme);
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) {
      themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#6c5ce7' : '#110f17');
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    this.setTheme(current === 'light' ? 'dark' : 'light');
    if ('vibrate' in navigator) navigator.vibrate(8);
  }

  initElements() {
    this.vaultSelect = document.getElementById('vault-select');
    this.folderSelect = document.getElementById('folder-select');
    this.settingsModal = document.getElementById('settings-modal');
    this.createModal = document.getElementById('create-modal');
    this.vaultListEl = document.getElementById('vault-profile-list');

    this.filterAllBtn = document.getElementById('filter-all-btn');
    this.filterStarredBtn = document.getElementById('filter-starred-btn');

    this.globalTokenInput = document.getElementById('cfg-global-token');
    this.globalTokenStatus = document.getElementById('global-token-status');

    this.fabCreateBtn = document.getElementById('fab-create-btn');
    this.confirmCreateBtn = document.getElementById('confirm-create-btn');
    this.newNotePathInput = document.getElementById('new-note-path');
    this.newNoteContentInput = document.getElementById('new-note-content');
  }

  initObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const cardEl = entry.target;
            const path = cardEl.dataset.path;
            if (path) {
              markSeen(path);
            }

            const allCards = this.viewport.querySelectorAll('.snap-card');
            const currentIndex = Array.from(allCards).indexOf(cardEl);
            if (currentIndex >= allCards.length - 3 && !this.isLoading && this.hasMore) {
              this.loadMoreCards();
            }
          }
        });
      },
      {
        root: this.viewport,
        threshold: 0.6,
      }
    );
  }

  initAutoSyncWatcher() {
    // Check for remote commits when the tab or PWA regains focus
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        const hasUpdates = await checkRemoteUpdates();
        if (hasUpdates) {
          this.statusEl.textContent = 'Remote changes detected. Auto-syncing...';
          await this.triggerSync(true);
        }
      }
    });
  }

  bindEvents() {
    document.getElementById('theme-btn').addEventListener('click', () => this.toggleTheme());
    document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
    document.getElementById('sync-btn').addEventListener('click', () => this.triggerSync());

    // Vault & Folder Switches
    this.vaultSelect.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      if (selectedId === '__NEW__') {
        this.openSettings();
        return;
      }
      setActiveVaultId(selectedId);
      await this.switchVault(selectedId);
    });

    this.folderSelect.addEventListener('change', (e) => {
      this.activeFolder = e.target.value;
      this.reloadFeed();
    });

    // All vs Starred Filters
    this.filterAllBtn.addEventListener('click', () => {
      if (this.filterMode === 'all') return;
      this.filterMode = 'all';
      this.filterAllBtn.classList.add('active');
      this.filterStarredBtn.classList.remove('active');
      this.reloadFeed();
    });

    this.filterStarredBtn.addEventListener('click', () => {
      if (this.filterMode === 'starred') return;
      this.filterMode = 'starred';
      this.filterStarredBtn.classList.add('active');
      this.filterAllBtn.classList.remove('active');
      this.reloadFeed();
    });

    // Create Note Modal Actions
    this.fabCreateBtn.addEventListener('click', () => {
      const activeFolder = this.activeFolder !== 'ALL' ? `${this.activeFolder}/` : '';
      this.newNotePathInput.value = activeFolder;
      this.newNoteContentInput.value = '';
      this.createModal.classList.add('open');
      this.newNotePathInput.focus();
    });

    this.confirmCreateBtn.addEventListener('click', () => this.handleCreateNote());

    // Global Token Input
    this.globalTokenInput.addEventListener('change', (e) => {
      setGlobalToken(e.target.value);
      this.updateGlobalTokenBadge();
    });

    // Settings Profile Actions
    document.getElementById('add-vault-btn').addEventListener('click', () => this.clearVaultForm());
    document.getElementById('save-vault-btn').addEventListener('click', () => this.saveCurrentVaultForm());

    // Modal Closures
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('open');
      });
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const readerModal = document.getElementById('reader-modal');
      const isReaderOpen = readerModal && readerModal.classList.contains('open');

      if (e.key === 'Escape') {
        if (isReaderOpen) readerModal.classList.remove('open');
        this.settingsModal.classList.remove('open');
        this.createModal.classList.remove('open');
        return;
      }

      if (isReaderOpen) return;

      const currentCard = this.getCurrentVisibleCard();

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          this.scrollToNextCard(1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          this.scrollToNextCard(-1);
          break;
        case 's':
        case 'S':
          e.preventDefault();
          if (currentCard) {
            const starBtn = currentCard.querySelector('.star-btn');
            if (starBtn) starBtn.click();
          }
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          this.fabCreateBtn.click();
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (currentCard) {
            const expandBtn = currentCard.querySelector('.expand-btn');
            if (expandBtn) expandBtn.click();
          }
          break;
      }
    });
  }

  getCurrentVisibleCard() {
    const cards = Array.from(this.viewport.querySelectorAll('.snap-card'));
    const viewCenter = this.viewport.scrollTop + this.viewport.clientHeight / 2;

    return cards.find((card) => {
      const top = card.offsetTop;
      const bottom = top + card.clientHeight;
      return viewCenter >= top && viewCenter <= bottom;
    });
  }

  scrollToNextCard(direction = 1) {
    const current = this.getCurrentVisibleCard();
    if (!current) return;
    const cards = Array.from(this.viewport.querySelectorAll('.snap-card'));
    const idx = cards.indexOf(current);
    const target = cards[idx + direction];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async boot() {
    const profiles = getVaultProfiles();
    let activeId = getActiveVaultId();

    if (profiles.length === 0) {
      this.openSettings();
      return;
    }

    if (!activeId || !profiles.some((p) => p.id === activeId)) {
      activeId = profiles[0].id;
      setActiveVaultId(activeId);
    }

    this.renderVaultDropdown();
    await this.switchVault(activeId);
  }

  renderVaultDropdown() {
    const profiles = getVaultProfiles();
    const activeId = getActiveVaultId();

    this.vaultSelect.innerHTML = '';
    profiles.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || `${p.owner}/${p.repo}`;
      if (p.id === activeId) opt.selected = true;
      this.vaultSelect.appendChild(opt);
    });

    const addOpt = document.createElement('option');
    addOpt.value = '__NEW__';
    addOpt.textContent = '+ Add Vault...';
    this.vaultSelect.appendChild(addOpt);
  }

  async switchVault(vaultId) {
    initVaultDB(vaultId);
    this.activeFolder = 'ALL';

    await this.populateFoldersFromDB();
    await this.reloadFeed();
  }

  async populateFoldersFromDB() {
    try {
      const db = getActiveDB();
      const records = await db.manifest.toArray();
      const folders = new Set();

      records.forEach((r) => {
        if (r.folder && r.folder !== 'Root') {
          folders.add(r.folder);
        }
      });

      this.folderSelect.innerHTML = '<option value="ALL">All Folders</option>';
      Array.from(folders)
        .sort()
        .forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = f;
          this.folderSelect.appendChild(opt);
        });
    } catch (err) {
      console.warn('Could not populate folders from DB:', err);
    }
  }

  async reloadFeed() {
    this.viewport.innerHTML = '';
    this.hasMore = true;
    this.isLoading = false;
    await this.loadMoreCards();
  }

  async loadMoreCards() {
    if (this.isLoading || !this.hasMore) return;
    this.isLoading = true;

    try {
      const db = getActiveDB();

      let candidates = [];
      if (this.filterMode === 'starred') {
        const starredStates = await db.state.where('starred').equals(1).toArray();
        const starMap = new Set(starredStates.map((s) => s.path));
        let manifest = await db.manifest.toArray();
        if (this.activeFolder !== 'ALL') {
          manifest = manifest.filter((m) => m.folder.startsWith(this.activeFolder));
        }
        candidates = manifest.filter((m) => starMap.has(m.path));
      } else {
        candidates = await getDeckQueue(this.activeFolder, 15);
      }

      const existingPaths = new Set(
        Array.from(this.viewport.querySelectorAll('.snap-card')).map((el) => el.dataset.path)
      );
      const newItems = candidates.filter((c) => !existingPaths.has(c.path));

      if (newItems.length === 0) {
        this.hasMore = false;
        this.isLoading = false;
        return;
      }

      preloadBatchContent(newItems.map((c) => c.path));

      for (const item of newItems) {
        const rawMarkdown = await fetchNoteContent(item.path);
        const cardData = parseMarkdownToCard(rawMarkdown, item.path);

        const state = await db.state.get(item.path);
        const isStarred = state ? state.starred === 1 : false;

        const cardEl = createCardElement(cardData, isStarred, {
          onStarToggle: async (path) => {
            await toggleStar(path);
          },
        });

        this.viewport.appendChild(cardEl);
        this.observer.observe(cardEl);
      }
    } catch (err) {
      console.error('Error loading cards:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async handleCreateNote() {
    let rawPath = this.newNotePathInput.value.trim();
    const content = this.newNoteContentInput.value;

    if (!rawPath) {
      alert('Please enter a note title or path.');
      return;
    }

    if (!rawPath.endsWith('.md')) {
      rawPath += '.md';
    }

    this.confirmCreateBtn.disabled = true;
    this.statusEl.textContent = 'Creating note on GitHub...';

    try {
      await saveNoteFile(rawPath, content, null);
      this.createModal.classList.remove('open');

      const cardData = parseMarkdownToCard(content, rawPath);
      const cardEl = createCardElement(cardData, false, {
        onStarToggle: async (path) => {
          await toggleStar(path);
        },
      });

      // Insert at very top and snap to it
      this.viewport.insertBefore(cardEl, this.viewport.firstChild);
      this.observer.observe(cardEl);
      cardEl.scrollIntoView({ behavior: 'smooth' });

      await this.populateFoldersFromDB();
      this.statusEl.textContent = 'Note created!';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
    } catch (err) {
      alert(`Could not create note: ${err.message}`);
      this.statusEl.textContent = 'Creation failed.';
    } finally {
      this.confirmCreateBtn.disabled = false;
    }
  }

  async triggerSync(silent = false) {
    if (!silent) this.statusEl.textContent = 'Syncing repository manifest...';
    try {
      await syncRepoManifest((msg) => {
        if (!silent) this.statusEl.textContent = msg;
      });

      await this.populateFoldersFromDB();
      if (!silent) {
        this.statusEl.textContent = 'Sync complete.';
        setTimeout(() => (this.statusEl.textContent = ''), 2000);
      } else {
        this.statusEl.textContent = '';
      }
      this.reloadFeed();
    } catch (err) {
      if (!silent) alert(`Sync failed: ${err.message}`);
      this.statusEl.textContent = 'Sync error.';
    }
  }

  /* --- Settings & Hierarchical Auth --- */

  openSettings() {
    this.renderSettingsProfileList();
    this.clearVaultForm();
    this.globalTokenInput.value = getGlobalToken();
    this.updateGlobalTokenBadge();
    this.settingsModal.classList.add('open');
  }

  updateGlobalTokenBadge() {
    const token = getGlobalToken();
    if (token) {
      this.globalTokenStatus.textContent = '✓ Active (5,000 req/hr)';
      this.globalTokenStatus.style.color = 'var(--primary)';
    } else {
      this.globalTokenStatus.textContent = 'Optional';
      this.globalTokenStatus.style.color = 'var(--text-muted)';
    }
  }

  renderSettingsProfileList() {
    const profiles = getVaultProfiles();
    const activeId = getActiveVaultId();

    this.vaultListEl.innerHTML = '';
    profiles.forEach((p) => {
      const hasCustomToken = Boolean(p.token && p.token.trim());
      const row = document.createElement('div');
      row.className = `vault-item ${p.id === activeId ? 'active-vault' : ''}`;
      row.innerHTML = `
        <div class="vault-info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.owner)}/${escapeHtml(p.repo)} · ${hasCustomToken ? 'Custom Token' : 'Default Auth'}</span>
        </div>
        <div class="vault-actions">
          <button class="edit-btn">Edit</button>
          <button class="delete-btn">Delete</button>
        </div>
      `;

      row.querySelector('.edit-btn').addEventListener('click', () => {
        this.loadVaultIntoForm(p);
      });

      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (confirm(`Delete vault profile "${p.name}" and its cached data?`)) {
          deleteVaultProfile(p.id);
          await deleteVaultDB(p.id);
          this.renderSettingsProfileList();
          this.renderVaultDropdown();
          const nextActive = getActiveVaultId();
          if (nextActive) {
            await this.switchVault(nextActive);
          } else {
            this.viewport.innerHTML = '';
            this.folderSelect.innerHTML = '<option value="ALL">All Folders</option>';
          }
        }
      });

      this.vaultListEl.appendChild(row);
    });
  }

  clearVaultForm() {
    document.getElementById('cfg-id').value = '';
    document.getElementById('cfg-name').value = '';
    document.getElementById('cfg-owner').value = '';
    document.getElementById('cfg-repo').value = '';
    document.getElementById('cfg-branch').value = 'main';
    document.getElementById('cfg-token').value = '';
    document.querySelector('.vault-override-details').removeAttribute('open');
  }

  loadVaultIntoForm(profile) {
    document.getElementById('cfg-id').value = profile.id;
    document.getElementById('cfg-name').value = profile.name || '';
    document.getElementById('cfg-owner').value = profile.owner;
    document.getElementById('cfg-repo').value = profile.repo;
    document.getElementById('cfg-branch').value = profile.branch || 'main';
    document.getElementById('cfg-token').value = profile.token || '';

    if (profile.token && profile.token.trim()) {
      document.querySelector('.vault-override-details').setAttribute('open', '');
    } else {
      document.querySelector('.vault-override-details').removeAttribute('open');
    }
  }

  async saveCurrentVaultForm() {
    const existingId = document.getElementById('cfg-id').value;
    const name = document.getElementById('cfg-name').value.trim();
    const owner = document.getElementById('cfg-owner').value.trim();
    const repo = document.getElementById('cfg-repo').value.trim();
    const branch = document.getElementById('cfg-branch').value.trim() || 'main';
    const token = document.getElementById('cfg-token').value.trim();

    if (!owner || !repo) {
      alert('Owner and Repository fields are required.');
      return;
    }

    const id = existingId || `vault_${Date.now()}`;
    const profile = {
      id,
      name: name || `${owner}/${repo}`,
      owner,
      repo,
      branch,
      token,
    };

    saveVaultProfile(profile);
    setActiveVaultId(id);

    this.renderSettingsProfileList();
    this.renderVaultDropdown();
    this.settingsModal.classList.remove('open');

    await this.switchVault(id);
    await this.triggerSync();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
