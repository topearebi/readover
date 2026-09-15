// src/app.js
import {
  initVaultDB,
  getActiveDB,
  getDBForSource,
  getDeckQueue,
  getAllSourcesDeckQueue,
  markSeen,
  toggleStar,
  deleteVaultDB,
  getCachedContent,
  getCachedThumbnail,
} from './db.js';

import {
  getVaultProfiles,
  getActiveVaultId,
  setActiveVaultId,
  saveVaultProfile,
  deleteVaultProfile,
  getGlobalToken,
  setGlobalToken,
  syncRepoManifest,
  fetchNoteContent,
  fetchBinaryBlob,
  saveNoteFile,
  preloadBatchContent,
} from './github.js';

import {
  getLocalProfiles,
  saveLocalProfile,
  deleteLocalProfile,
  pickLocalDirectory,
  scanLocalDirectory,
  getLocalFileBlob,
  indexFallbackDirectory,
} from './local-fs.js';

import { parseMarkdownToCard } from './parser.js';
import { createCardElement } from './components/card.js';
import { extractPdfCover } from './parsers/pdf-cover.js';
import { extractEpubCover } from './parsers/epub-cover.js';
import { openPdfViewer } from './viewers/pdf-viewer.js';
import { openEpubViewer } from './viewers/epub-viewer.js';

class AppController {
  constructor() {
    this.activeSourceId = 'ALL_SOURCES';
    this.activeFolder = 'ALL';
    this.mediaFilter = 'all'; // 'all' | 'starred'
    this.isLoading = false;
    this.hasMore = true;
    this.currentSourceType = 'aggregate'; // 'aggregate' | 'github' | 'local'

    this.viewport = document.getElementById('feed-viewport');
    this.statusEl = document.getElementById('status-indicator');

    this.initTheme();
    this.initElements();
    this.initObserver();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.startGamepadLoop();
    this.boot();
  }

  initTheme() {
    const savedTheme = localStorage.getItem('readover_theme') || 'dark';
    this.setTheme(savedTheme);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('readover_theme', theme);
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) {
      themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#f8f7fc' : '#110f17');
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    this.setTheme(current === 'light' ? 'dark' : 'light');
    if ('vibrate' in navigator) navigator.vibrate(8);
  }

  initElements() {
    this.sourceSelect = document.getElementById('source-select');
    this.folderSelect = document.getElementById('folder-select');
    this.settingsModal = document.getElementById('settings-modal');
    this.createModal = document.getElementById('create-modal');
    this.sourceListEl = document.getElementById('source-list');

    this.filterPills = document.querySelectorAll('.filter-pill');

    this.globalTokenInput = document.getElementById('cfg-global-token');
    this.globalTokenStatus = document.getElementById('global-token-status');

    this.fabCreateBtn = document.getElementById('fab-create-btn');
    this.confirmCreateBtn = document.getElementById('confirm-create-btn');
    this.newNotePathInput = document.getElementById('new-note-path');
    this.newNoteContentInput = document.getElementById('new-note-content');

    this.openLocalFolderBtn = document.getElementById('open-local-folder-btn');
    this.legacyFolderInput = document.getElementById('legacy-folder-input');
  }

  initObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const cardEl = entry.target;
            const path = cardEl.dataset.path;
            const sourceId = cardEl.dataset.sourceId;
            if (path) {
              const targetDb = sourceId ? getDBForSource(sourceId) : null;
              markSeen(path, targetDb);
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

  bindEvents() {
    document.getElementById('theme-btn').addEventListener('click', () => this.toggleTheme());
    document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
    document.getElementById('sync-btn').addEventListener('click', () => this.triggerSync());

    this.sourceSelect.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      if (selectedId === '__NEW__') {
        this.openSettings();
        return;
      }
      await this.switchSource(selectedId);
    });

    this.folderSelect.addEventListener('change', (e) => {
      this.activeFolder = e.target.value;
      this.reloadFeed();
    });

    this.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.mediaFilter = pill.dataset.filter;
        this.reloadFeed();
      });
    });

    this.openLocalFolderBtn.addEventListener('click', async () => {
      try {
        const { profile } = await pickLocalDirectory();
        this.settingsModal.classList.remove('open');
        this.renderSourceDropdown();
        await this.switchSource(profile.id);
        await this.triggerSync();
      } catch (err) {
        if (err.message === 'NATIVE_PICKER_UNSUPPORTED') {
          this.legacyFolderInput.click();
        } else if (err.name !== 'AbortError') {
          alert(`Directory access failed: ${err.message}`);
        }
      }
    });

    this.legacyFolderInput.addEventListener('change', async (e) => {
      if (e.target.files.length === 0) return;
      const profileId = `local_fallback_${Date.now()}`;
      const profile = { id: profileId, name: 'Local Import', type: 'local' };
      saveLocalProfile(profile);
      this.settingsModal.classList.remove('open');
      this.renderSourceDropdown();
      await this.switchSource(profile.id);

      this.statusEl.textContent = 'Indexing files...';
      const folders = await indexFallbackDirectory(e.target.files, (m) => (this.statusEl.textContent = m));
      await this.populateFolders(folders);
      this.reloadFeed();
    });

    this.fabCreateBtn.addEventListener('click', () => {
      if (this.activeSourceId === 'ALL_SOURCES') {
        const sources = this.getAllSources().filter((s) => s.type === 'github');
        if (sources.length === 0) {
          alert('Connect a GitHub vault in Settings to author new notes.');
          return;
        }
      }
      const activeFolder = this.activeFolder !== 'ALL' ? `${this.activeFolder}/` : '';
      this.newNotePathInput.value = activeFolder;
      this.newNoteContentInput.value = '';
      this.createModal.classList.add('open');
      this.newNotePathInput.focus();
    });

    this.confirmCreateBtn.addEventListener('click', () => this.handleCreateNote());

    this.globalTokenInput.addEventListener('change', (e) => {
      setGlobalToken(e.target.value);
      this.updateGlobalTokenBadge();
    });

    document.getElementById('add-vault-btn').addEventListener('click', () => this.clearVaultForm());
    document.getElementById('save-vault-btn').addEventListener('click', () => this.saveCurrentVaultForm());

    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('open');
      });
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const openModal = document.querySelector('.modal.open, .reader-modal.open');
      if (e.key === 'Escape') {
        if (openModal) openModal.classList.remove('open');
        return;
      }

      if (openModal) return;

      const currentCard = this.getCurrentVisibleCard();

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          this.scrollToCard(1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          this.scrollToCard(-1);
          break;
        case 's':
        case 'S':
          e.preventDefault();
          if (currentCard) currentCard.querySelector('.star-btn')?.click();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          this.fabCreateBtn.click();
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (currentCard) currentCard.querySelector('.expand-btn')?.click();
          break;
      }
    });
  }

  startGamepadLoop() {
    let lastButtonState = {};

    const poll = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0];

      if (gp) {
        const isPressed = (btnIndex) => gp.buttons[btnIndex] && gp.buttons[btnIndex].pressed;
        const currentCard = this.getCurrentVisibleCard();
        const activeModal = document.querySelector('.reader-modal.open');

        if ((isPressed(13) || gp.axes[1] > 0.6) && !lastButtonState.down) {
          if (!activeModal) this.scrollToCard(1);
        }
        if ((isPressed(12) || gp.axes[1] < -0.6) && !lastButtonState.up) {
          if (!activeModal) this.scrollToCard(-1);
        }
        if (isPressed(0) && !lastButtonState.btnA) {
          if (!activeModal && currentCard) currentCard.querySelector('.expand-btn')?.click();
        }
        if (isPressed(3) && !lastButtonState.btnY) {
          if (!activeModal && currentCard) currentCard.querySelector('.star-btn')?.click();
        }
        if (isPressed(1) && !lastButtonState.btnB) {
          if (activeModal) activeModal.classList.remove('open');
        }

        lastButtonState = {
          down: isPressed(13) || gp.axes[1] > 0.6,
          up: isPressed(12) || gp.axes[1] < -0.6,
          btnA: isPressed(0),
          btnY: isPressed(3),
          btnB: isPressed(1),
        };
      }

      requestAnimationFrame(poll);
    };

    requestAnimationFrame(poll);
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

  scrollToCard(direction = 1) {
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
    const sources = this.getAllSources();
    if (sources.length === 0) {
      this.openSettings();
      return;
    }

    const savedActiveId = getActiveVaultId() || 'ALL_SOURCES';
    this.renderSourceDropdown();
    await this.switchSource(savedActiveId);
  }

  getAllSources() {
    const githubs = getVaultProfiles().map((p) => ({ ...p, type: 'github' }));
    const locals = getLocalProfiles().map((p) => ({ ...p, type: 'local' }));
    return [...githubs, ...locals];
  }

  renderSourceDropdown() {
    const sources = this.getAllSources();
    this.sourceSelect.innerHTML = '';

    // Root Aggregated Entry
    const allOpt = document.createElement('option');
    allOpt.value = 'ALL_SOURCES';
    allOpt.textContent = '🌟 All Sources';
    if (this.activeSourceId === 'ALL_SOURCES') allOpt.selected = true;
    this.sourceSelect.appendChild(allOpt);

    // Individual Sources
    sources.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.type === 'local' ? '📁 ' : '☁️ '}${s.name || s.repo}`;
      if (s.id === this.activeSourceId) opt.selected = true;
      this.sourceSelect.appendChild(opt);
    });

    const addOpt = document.createElement('option');
    addOpt.value = '__NEW__';
    addOpt.textContent = '+ Add Source...';
    this.sourceSelect.appendChild(addOpt);
  }

  async switchSource(sourceId) {
    this.activeSourceId = sourceId;
    setActiveVaultId(sourceId);

    const sources = this.getAllSources();

    if (sourceId === 'ALL_SOURCES') {
      this.currentSourceType = 'aggregate';
      this.activeFolder = 'ALL';
      this.folderSelect.innerHTML = '<option value="ALL">All Sources (Aggregate)</option>';
      this.folderSelect.disabled = true;
    } else {
      const activeSource = sources.find((s) => s.id === sourceId);
      this.currentSourceType = activeSource ? activeSource.type : 'github';
      this.activeFolder = 'ALL';
      this.folderSelect.disabled = false;
      initVaultDB(sourceId);
      await this.populateFoldersFromDB();
    }

    this.renderSourceDropdown();
    await this.reloadFeed();
  }

  async populateFolders(folderList = null) {
    if (this.activeSourceId === 'ALL_SOURCES') return;

    let folders = folderList;
    if (!folders) {
      const db = getActiveDB();
      const records = await db.manifest.toArray();
      const folderSet = new Set();
      records.forEach((r) => {
        if (r.folder && r.folder !== 'Root') folderSet.add(r.folder);
      });
      folders = Array.from(folderSet).sort();
    }

    this.folderSelect.innerHTML = '<option value="ALL">All Subfolders</option>';
    folders.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      this.folderSelect.appendChild(opt);
    });
  }

  async populateFoldersFromDB() {
    return this.populateFolders();
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
      let candidates = [];
      const sources = this.getAllSources();

      if (this.activeSourceId === 'ALL_SOURCES') {
        candidates = await getAllSourcesDeckQueue(sources, this.mediaFilter, 16);
      } else {
        const db = getActiveDB();
        if (this.mediaFilter === 'starred') {
          const starredStates = await db.state.where('starred').equals(1).toArray();
          const starMap = new Set(starredStates.map((s) => s.path));
          let manifest = await db.manifest.toArray();
          if (this.activeFolder !== 'ALL') {
            manifest = manifest.filter((m) => m.folder === this.activeFolder || m.folder.startsWith(`${this.activeFolder}/`));
          }
          candidates = manifest.filter((m) => starMap.has(m.path));
        } else {
          candidates = await getDeckQueue(this.activeFolder, this.mediaFilter, 15);
        }
        candidates = candidates.map((item) => ({
          ...item,
          _sourceId: this.activeSourceId,
          _sourceType: this.currentSourceType,
        }));
      }

      const existingPaths = new Set(
        Array.from(this.viewport.querySelectorAll('.snap-card')).map((el) => `${el.dataset.sourceId}:${el.dataset.path}`)
      );

      const newItems = candidates.filter((c) => !existingPaths.has(`${c._sourceId}:${c.path}`));

      if (newItems.length === 0) {
        this.hasMore = false;
        this.isLoading = false;
        return;
      }

      // Preload text notes
      const remoteTextPaths = newItems
        .filter((i) => i.mediaType === 'text' && i._sourceType === 'github')
        .map((i) => i.path);
      if (remoteTextPaths.length > 0) {
        preloadBatchContent(remoteTextPaths);
      }

      for (const item of newItems) {
        const targetDb = getDBForSource(item._sourceId);
        let contentData = null;

        if (item.mediaType === 'text') {
          try {
            const rawMarkdown = await this.retrieveContent(item.path, item._sourceId, item._sourceType);
            contentData = parseMarkdownToCard(rawMarkdown || '# Empty Note\n\n*No content available.*', item.path);
          } catch (err) {
            contentData = parseMarkdownToCard(`# ${item.filename}\n\n*Unable to load note content.*`, item.path);
          }
        } else {
          await this.ensureThumbnailCached(item);
        }

        const state = await targetDb.state.get(item.path);
        const isStarred = state ? state.starred === 1 : false;

        const cardEl = await createCardElement(item, contentData, isStarred, {
          onStarToggle: async (path, starred) => toggleStar(path, starred, targetDb),
          onOpenDocument: async (docItem) => this.handleOpenDocument(docItem),
        });

        cardEl.dataset.sourceId = item._sourceId;
        this.viewport.appendChild(cardEl);
        this.observer.observe(cardEl);
      }
    } catch (err) {
      console.error('Error loading cards:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async retrieveContent(path, sourceId, sourceType) {
    if (sourceType === 'local') {
      const file = await getLocalFileBlob(sourceId, path);
      return await file.text();
    }
    return await fetchNoteContent(path);
  }

  async retrieveBlob(path, sourceId, sourceType) {
    if (sourceType === 'local') {
      return await getLocalFileBlob(sourceId, path);
    }
    return await fetchBinaryBlob(path);
  }

  async ensureThumbnailCached(item) {
    const existing = await getCachedThumbnail(item.path, item._sourceId);
    if (existing) return;

    try {
      const blob = await this.retrieveBlob(item.path, item._sourceId, item._sourceType);
      if (item.mediaType === 'pdf') {
        await extractPdfCover(item.path, blob, item._sourceId);
      } else if (item.mediaType === 'epub') {
        await extractEpubCover(item.path, blob, item._sourceId);
      }
    } catch (err) {
      console.warn(`Cover extraction failed for ${item.path}:`, err);
    }
  }

  async handleOpenDocument(item) {
    this.statusEl.textContent = `Opening ${item.filename}...`;
    try {
      const blob = await this.retrieveBlob(item.path, item._sourceId, item._sourceType);
      if (item.mediaType === 'pdf') {
        await openPdfViewer(item.path, blob, item.filename, item._sourceId);
      } else if (item.mediaType === 'epub') {
        await openEpubViewer(item.path, blob, item.filename, item._sourceId);
      }
    } catch (err) {
      alert(`Could not load document: ${err.message}`);
    } finally {
      this.statusEl.textContent = '';
    }
  }

  async handleCreateNote() {
    let rawPath = this.newNotePathInput.value.trim();
    const content = this.newNoteContentInput.value;

    if (!rawPath) {
      alert('Please enter a note title.');
      return;
    }
    if (!rawPath.endsWith('.md')) rawPath += '.md';

    this.confirmCreateBtn.disabled = true;
    this.statusEl.textContent = 'Saving note...';

    try {
      if (this.currentSourceType === 'local') {
        alert('Local note authoring is supported in GitHub vaults.');
        return;
      }

      await saveNoteFile(rawPath, content, null);
      this.createModal.classList.remove('open');

      const cardData = parseMarkdownToCard(content, rawPath);
      const manifestRecord = {
        path: rawPath,
        filename: rawPath.split('/').pop(),
        folder: rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : 'Root',
        mediaType: 'text',
        _sourceId: this.activeSourceId,
        _sourceType: this.currentSourceType,
      };

      const cardEl = await createCardElement(manifestRecord, cardData, false, {
        onStarToggle: async (path, starred) => toggleStar(path, starred),
      });

      cardEl.dataset.sourceId = this.activeSourceId;
      this.viewport.insertBefore(cardEl, this.viewport.firstChild);
      this.observer.observe(cardEl);
      cardEl.scrollIntoView({ behavior: 'smooth' });

      await this.populateFoldersFromDB();
      this.statusEl.textContent = 'Note created!';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
    } catch (err) {
      alert(`Creation failed: ${err.message}`);
    } finally {
      this.confirmCreateBtn.disabled = false;
    }
  }

  async triggerSync() {
    this.statusEl.textContent = 'Syncing manifest...';
    try {
      if (this.activeSourceId === 'ALL_SOURCES') {
        const sources = this.getAllSources();
        for (const src of sources) {
          if (src.type === 'local') {
            await scanLocalDirectory(src.id);
          } else {
            initVaultDB(src.id);
            await syncRepoManifest();
          }
        }
      } else {
        if (this.currentSourceType === 'local') {
          const folders = await scanLocalDirectory(this.activeSourceId, (m) => (this.statusEl.textContent = m));
          await this.populateFolders(folders);
        } else {
          await syncRepoManifest((m) => (this.statusEl.textContent = m));
          await this.populateFoldersFromDB();
        }
      }

      this.statusEl.textContent = 'Sync complete.';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
      this.reloadFeed();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
      this.statusEl.textContent = 'Sync error';
    }
  }

  /* --- Settings & Profiles --- */

  openSettings() {
    this.renderSourceList();
    this.clearVaultForm();
    this.globalTokenInput.value = getGlobalToken();
    this.updateGlobalTokenBadge();
    this.settingsModal.classList.add('open');
  }

  updateGlobalTokenBadge() {
    const token = getGlobalToken();
    if (token) {
      this.globalTokenStatus.textContent = '✓ Active';
      this.globalTokenStatus.style.color = 'var(--primary)';
    } else {
      this.globalTokenStatus.textContent = 'Optional';
      this.globalTokenStatus.style.color = 'var(--text-muted)';
    }
  }

  renderSourceList() {
    const sources = this.getAllSources();
    this.sourceListEl.innerHTML = '';

    sources.forEach((s) => {
      const row = document.createElement('div');
      row.className = `source-item ${s.id === this.activeSourceId ? 'active-source' : ''}`;
      row.innerHTML = `
        <div class="source-meta">
          <strong>${s.type === 'local' ? '📁' : '☁️'} ${escapeHtml(s.name || s.repo)}</strong>
          <span>${s.type === 'local' ? 'Local Directory' : `${escapeHtml(s.owner)}/${escapeHtml(s.repo)}`}</span>
        </div>
        <div class="source-actions">
          ${s.type === 'github' ? '<button class="edit-btn">Edit</button>' : ''}
          <button class="delete-btn">Remove</button>
        </div>
      `;

      if (s.type === 'github') {
        row.querySelector('.edit-btn').addEventListener('click', () => this.loadVaultIntoForm(s));
      }

      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (confirm(`Remove library "${s.name || s.repo}" and cached data?`)) {
          if (s.type === 'local') {
            await deleteLocalProfile(s.id);
          } else {
            deleteVaultProfile(s.id);
          }
          await deleteVaultDB(s.id);
          this.renderSourceList();
          this.renderSourceDropdown();
          await this.switchSource('ALL_SOURCES');
        }
      });

      this.sourceListEl.appendChild(row);
    });
  }

  clearVaultForm() {
    document.getElementById('cfg-id').value = '';
    document.getElementById('cfg-name').value = '';
    document.getElementById('cfg-owner').value = '';
    document.getElementById('cfg-repo').value = '';
    document.getElementById('cfg-branch').value = 'main';
    document.getElementById('cfg-token').value = '';
  }

  loadVaultIntoForm(p) {
    document.getElementById('cfg-id').value = p.id;
    document.getElementById('cfg-name').value = p.name || '';
    document.getElementById('cfg-owner').value = p.owner;
    document.getElementById('cfg-repo').value = p.repo;
    document.getElementById('cfg-branch').value = p.branch || 'main';
    document.getElementById('cfg-token').value = p.token || '';
  }

  async saveCurrentVaultForm() {
    const existingId = document.getElementById('cfg-id').value;
    const name = document.getElementById('cfg-name').value.trim();
    const owner = document.getElementById('cfg-owner').value.trim();
    const repo = document.getElementById('cfg-repo').value.trim();
    const branch = document.getElementById('cfg-branch').value.trim() || 'main';
    const token = document.getElementById('cfg-token').value.trim();

    if (!owner || !repo) {
      alert('Owner and Repository are required.');
      return;
    }

    const id = existingId || `vault_${Date.now()}`;
    const profile = { id, name: name || `${owner}/${repo}`, owner, repo, branch, token };

    saveVaultProfile(profile);
    this.renderSourceList();
    this.renderSourceDropdown();
    this.settingsModal.classList.remove('open');

    await this.switchSource(id);
    await this.triggerSync();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
