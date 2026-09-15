// src/app.js
import {
  initVaultDB,
  getActiveDB,
  getDeckQueue,
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
    this.activeFolder = 'ALL';
    this.mediaFilter = 'all'; // 'all', 'text', 'epub', 'pdf', 'starred'
    this.isLoading = false;
    this.hasMore = true;
    this.currentSourceType = 'github'; // 'github' | 'local'

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

  bindEvents() {
    document.getElementById('theme-btn').addEventListener('click', () => this.toggleTheme());
    document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
    document.getElementById('sync-btn').addEventListener('click', () => this.triggerSync());

    // Source & Folder Switching
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

    // Media Filter Tabs
    this.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.mediaFilter = pill.dataset.filter;
        this.reloadFeed();
      });
    });

    // Local Directory Picker
    this.openLocalFolderBtn.addEventListener('click', async () => {
      try {
        const { profile } = await pickLocalDirectory();
        this.settingsModal.classList.remove('open');
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
      await this.switchSource(profile.id);

      this.statusEl.textContent = 'Indexing files...';
      const folders = await indexFallbackDirectory(e.target.files, (m) => (this.statusEl.textContent = m));
      await this.populateFolders(folders);
      this.reloadFeed();
    });

    // Note Creation Actions
    this.fabCreateBtn.addEventListener('click', () => {
      const activeFolder = this.activeFolder !== 'ALL' ? `${this.activeFolder}/` : '';
      this.newNotePathInput.value = activeFolder;
      this.newNoteContentInput.value = '';
      this.createModal.classList.add('open');
      this.newNotePathInput.focus();
    });

    this.confirmCreateBtn.addEventListener('click', () => this.handleCreateNote());

    // Settings Profile Actions
    this.globalTokenInput.addEventListener('change', (e) => {
      setGlobalToken(e.target.value);
      this.updateGlobalTokenBadge();
    });

    document.getElementById('add-vault-btn').addEventListener('click', () => this.clearVaultForm());
    document.getElementById('save-vault-btn').addEventListener('click', () => this.saveCurrentVaultForm());

    // Modals Close
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

        // D-Pad Down (btn 13) or Stick Down
        if ((isPressed(13) || gp.axes[1] > 0.6) && !lastButtonState.down) {
          if (!activeModal) this.scrollToCard(1);
        }
        // D-Pad Up (btn 12) or Stick Up
        if ((isPressed(12) || gp.axes[1] < -0.6) && !lastButtonState.up) {
          if (!activeModal) this.scrollToCard(-1);
        }
        // Button A (btn 0) -> Expand/Open
        if (isPressed(0) && !lastButtonState.btnA) {
          if (!activeModal && currentCard) currentCard.querySelector('.expand-btn')?.click();
        }
        // Button Y (btn 3) -> Star/Favorite
        if (isPressed(3) && !lastButtonState.btnY) {
          if (!activeModal && currentCard) currentCard.querySelector('.star-btn')?.click();
        }
        // Button B (btn 1) -> Close Modal
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
    let activeId = getActiveVaultId();

    if (sources.length === 0) {
      this.openSettings();
      return;
    }

    if (!activeId || !sources.some((s) => s.id === activeId)) {
      activeId = sources[0].id;
      setActiveVaultId(activeId);
    }

    this.renderSourceDropdown();
    await this.switchSource(activeId);
  }

  getAllSources() {
    const githubs = getVaultProfiles().map((p) => ({ ...p, type: 'github' }));
    const locals = getLocalProfiles().map((p) => ({ ...p, type: 'local' }));
    return [...githubs, ...locals];
  }

  renderSourceDropdown() {
    const sources = this.getAllSources();
    const activeId = getActiveVaultId();

    this.sourceSelect.innerHTML = '';
    sources.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.type === 'local' ? '📁 ' : '☁️ '}${s.name || s.repo}`;
      if (s.id === activeId) opt.selected = true;
      this.sourceSelect.appendChild(opt);
    });

    const addOpt = document.createElement('option');
    addOpt.value = '__NEW__';
    addOpt.textContent = '+ Add Source...';
    this.sourceSelect.appendChild(addOpt);
  }

  async switchSource(sourceId) {
    setActiveVaultId(sourceId);
    const sources = this.getAllSources();
    const activeSource = sources.find((s) => s.id === sourceId);
    this.currentSourceType = activeSource ? activeSource.type : 'github';

    initVaultDB(sourceId);
    this.activeFolder = 'ALL';

    await this.populateFoldersFromDB();
    await this.reloadFeed();
  }

  async populateFolders(folderList = null) {
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

    this.folderSelect.innerHTML = '<option value="ALL">All Folders</option>';
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
      const db = getActiveDB();
      let candidates = [];

      if (this.mediaFilter === 'starred') {
        const starredStates = await db.state.where('starred').equals(1).toArray();
        const starMap = new Set(starredStates.map((s) => s.path));
        let manifest = await db.manifest.toArray();
        if (this.activeFolder !== 'ALL') {
          manifest = manifest.filter((m) => m.folder.startsWith(this.activeFolder));
        }
        candidates = manifest.filter((m) => starMap.has(m.path));
      } else {
        candidates = await getDeckQueue(this.activeFolder, this.mediaFilter, 15);
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

      if (this.currentSourceType === 'github') {
        const textPaths = newItems.filter((i) => i.mediaType === 'text').map((i) => i.path);
        preloadBatchContent(textPaths);
      }

      for (const item of newItems) {
        let contentData = null;

        if (item.mediaType === 'text') {
          const rawMarkdown = await this.retrieveContent(item.path);
          contentData = parseMarkdownToCard(rawMarkdown, item.path);
        } else {
          // Trigger lazy cover generation if missing
          await this.ensureThumbnailCached(item);
        }

        const state = await db.state.get(item.path);
        const isStarred = state ? state.starred === 1 : false;

        const cardEl = await createCardElement(item, contentData, isStarred, {
          onStarToggle: async (path) => toggleStar(path),
          onOpenDocument: async (docItem) => this.handleOpenDocument(docItem),
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

  async retrieveContent(path) {
    if (this.currentSourceType === 'local') {
      const activeId = getActiveVaultId();
      const file = await getLocalFileBlob(activeId, path);
      return await file.text();
    }
    return await fetchNoteContent(path);
  }

  async retrieveBlob(path) {
    if (this.currentSourceType === 'local') {
      const activeId = getActiveVaultId();
      return await getLocalFileBlob(activeId, path);
    }
    const response = await fetchNoteContent(path);
    return new Blob([response]);
  }

  async ensureThumbnailCached(item) {
    const existing = await getCachedThumbnail(item.path);
    if (existing) return;

    try {
      const blob = await this.retrieveBlob(item.path);
      if (item.mediaType === 'pdf') {
        await extractPdfCover(item.path, blob);
      } else if (item.mediaType === 'epub') {
        await extractEpubCover(item.path, blob);
      }
    } catch (err) {
      console.warn(`Cover extraction failed for ${item.path}:`, err);
    }
  }

  async handleOpenDocument(item) {
    this.statusEl.textContent = `Opening ${item.filename}...`;
    try {
      const blob = await this.retrieveBlob(item.path);
      if (item.mediaType === 'pdf') {
        await openPdfViewer(item.path, blob, item.filename);
      } else if (item.mediaType === 'epub') {
        await openEpubViewer(item.path, blob, item.filename);
      }
      this.statusEl.textContent = '';
    } catch (err) {
      alert(`Could not load document: ${err.message}`);
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
        alert('Local note authoring is available in GitHub vaults.');
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
      };

      const cardEl = await createCardElement(manifestRecord, cardData, false, {
        onStarToggle: async (path) => toggleStar(path),
      });

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
      const activeId = getActiveVaultId();

      if (this.currentSourceType === 'local') {
        const folders = await scanLocalDirectory(activeId, (msg) => (this.statusEl.textContent = msg));
        await this.populateFolders(folders);
      } else {
        await syncRepoManifest((msg) => (this.statusEl.textContent = msg));
        await this.populateFoldersFromDB();
      }

      this.statusEl.textContent = 'Sync complete.';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
      this.reloadFeed();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
      this.statusEl.textContent = 'Sync error';
    }
  }

  /* --- Settings & Auth --- */

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
    const activeId = getActiveVaultId();

    this.sourceListEl.innerHTML = '';
    sources.forEach((s) => {
      const row = document.createElement('div');
      row.className = `source-item ${s.id === activeId ? 'active-source' : ''}`;
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
          const remaining = this.getAllSources();
          if (remaining.length > 0) {
            await this.switchSource(remaining[0].id);
          } else {
            this.viewport.innerHTML = '';
          }
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
