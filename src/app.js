// src/app.js
import {
  initVaultDB,
  getActiveDB,
  getDeckQueue,
  markSeen,
  toggleHide,
  toggleStar,
  restoreAllHidden,
  resetReviewHistory,
  deleteVaultDB,
} from './db.js';

import {
  getVaultProfiles,
  getActiveVaultId,
  setActiveVaultId,
  saveVaultProfile,
  deleteVaultProfile,
  syncRepoManifest,
  fetchNoteContent,
  preloadBatchContent,
} from './github.js';

import { parseMarkdownToCard } from './parser.js';
import { createCardElement } from './components/card.js';

class AppController {
  constructor() {
    this.deckQueue = [];
    this.activeFolder = 'ALL';
    this.isLoading = false;
    this.container = document.getElementById('card-stack');
    this.statusEl = document.getElementById('status-indicator');

    this.initElements();
    this.bindEvents();
    this.boot();
  }

  initElements() {
    this.vaultSelect = document.getElementById('vault-select');
    this.folderSelect = document.getElementById('folder-select');
    this.settingsModal = document.getElementById('settings-modal');
    this.managementModal = document.getElementById('management-modal');
    this.vaultListEl = document.getElementById('vault-profile-list');
  }

  bindEvents() {
    // Top Bar Actions
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('manage-btn').addEventListener('click', () => {
      this.managementModal.classList.add('open');
    });

    document.getElementById('sync-btn').addEventListener('click', () => {
      this.triggerSync();
    });

    // Vault Selection Dropdown
    this.vaultSelect.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      if (selectedId === '__NEW__') {
        this.openSettings();
        return;
      }
      setActiveVaultId(selectedId);
      await this.switchVault(selectedId);
    });

    // Folder Filter Dropdown
    this.folderSelect.addEventListener('change', (e) => {
      this.activeFolder = e.target.value;
      this.reloadDeck();
    });

    // Settings Profile Actions
    document.getElementById('add-vault-btn').addEventListener('click', () => {
      this.clearVaultForm();
    });

    document.getElementById('save-vault-btn').addEventListener('click', () => {
      this.saveCurrentVaultForm();
    });

    // Feed Management Actions
    document.getElementById('restore-hidden-btn').addEventListener('click', async () => {
      await restoreAllHidden();
      alert('All archived notes restored to rotation.');
      this.managementModal.classList.remove('open');
      this.reloadDeck();
    });

    document.getElementById('reset-seen-btn').addEventListener('click', async () => {
      await resetReviewHistory();
      alert('Review history reset. Notes will resurface.');
      this.managementModal.classList.remove('open');
      this.reloadDeck();
    });

    // Modal Close Triggers
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('open');
      });
    });
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
    this.statusEl.textContent = 'Switching vault...';
    initVaultDB(vaultId);
    this.activeFolder = 'ALL';

    await this.populateFoldersFromDB();
    await this.reloadDeck();
    this.statusEl.textContent = '';
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

      this.folderSelect.innerHTML = '<option value="ALL">All Notes</option>';
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

  async reloadDeck() {
    this.container.innerHTML = '';
    this.deckQueue = [];
    await this.replenishQueue();
    this.renderTopCards();
  }

  async replenishQueue() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const candidates = await getDeckQueue(this.activeFolder, 20);
      if (candidates.length === 0) {
        this.statusEl.textContent = 'No more notes in this rotation.';
        this.isLoading = false;
        return;
      }

      this.statusEl.textContent = '';
      this.deckQueue.push(...candidates);

      // Preload next 8 markdown contents in background
      const pathsToPreload = candidates.slice(0, 8).map((c) => c.path);
      preloadBatchContent(pathsToPreload);
    } catch (err) {
      console.error('Failed to replenish deck:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async renderTopCards() {
    while (this.container.children.length < 3 && this.deckQueue.length > 0) {
      const item = this.deckQueue.shift();
      try {
        const rawMarkdown = await fetchNoteContent(item.path);
        const cardData = parseMarkdownToCard(rawMarkdown, item.path);

        const cardEl = createCardElement(cardData, {
          onSwipeRight: async (path) => {
            await markSeen(path);
            this.onCardDismissed();
          },
          onSwipeLeft: async (path) => {
            await toggleHide(path, 1);
            this.onCardDismissed();
          },
          onStarToggle: async (path) => {
            await toggleStar(path);
          },
        });

        this.container.insertBefore(cardEl, this.container.firstChild);
      } catch (err) {
        console.warn(`Error rendering card for ${item.path}:`, err);
      }
    }

    if (this.container.children.length === 0 && this.deckQueue.length === 0) {
      this.statusEl.textContent = 'Deck finished for now!';
    }
  }

  onCardDismissed() {
    this.renderTopCards();
    if (this.deckQueue.length < 5) {
      this.replenishQueue();
    }
  }

  async triggerSync() {
    this.statusEl.textContent = 'Syncing repository manifest...';
    try {
      await syncRepoManifest((msg) => {
        this.statusEl.textContent = msg;
      });

      await this.populateFoldersFromDB();
      this.statusEl.textContent = 'Sync finished.';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
      this.reloadDeck();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
      this.statusEl.textContent = 'Sync error.';
    }
  }

  /* --- Profile & Settings Management --- */

  openSettings() {
    this.renderSettingsProfileList();
    this.clearVaultForm();
    this.settingsModal.classList.add('open');
  }

  renderSettingsProfileList() {
    const profiles = getVaultProfiles();
    const activeId = getActiveVaultId();

    this.vaultListEl.innerHTML = '';
    profiles.forEach((p) => {
      const row = document.createElement('div');
      row.className = `vault-item ${p.id === activeId ? 'active-vault' : ''}`;
      row.innerHTML = `
        <div class="vault-info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.owner)}/${escapeHtml(p.repo)} (${escapeHtml(p.branch || 'main')})</span>
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
            this.container.innerHTML = '';
            this.folderSelect.innerHTML = '<option value="ALL">All Notes</option>';
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
  }

  loadVaultIntoForm(profile) {
    document.getElementById('cfg-id').value = profile.id;
    document.getElementById('cfg-name').value = profile.name || '';
    document.getElementById('cfg-owner').value = profile.owner;
    document.getElementById('cfg-repo').value = profile.repo;
    document.getElementById('cfg-branch').value = profile.branch || 'main';
    document.getElementById('cfg-token').value = profile.token || '';
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
