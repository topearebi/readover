// src/app.js
import { getDeckQueue, markSeen, toggleHide, toggleStar, restoreAllHidden, resetReviewHistory } from './db.js';
import { syncRepoManifest, fetchNoteContent, preloadBatchContent, saveGitHubConfig, getGitHubConfig } from './github.js';
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
    this.start();
  }

  initElements() {
    this.folderSelect = document.getElementById('folder-select');
    this.settingsModal = document.getElementById('settings-modal');
    this.managementModal = document.getElementById('management-modal');
  }

  bindEvents() {
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('manage-btn').addEventListener('click', () => {
      this.managementModal.classList.add('open');
    });

    document.getElementById('save-settings-btn').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('sync-btn').addEventListener('click', () => {
      this.triggerSync();
    });

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

    this.folderSelect.addEventListener('change', (e) => {
      this.activeFolder = e.target.value;
      this.reloadDeck();
    });

    // Close buttons on modals
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('open');
      });
    });
  }

  async start() {
    const config = getGitHubConfig();
    if (!config || !config.repo) {
      this.openSettings();
      return;
    }
    await this.reloadDeck();
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

      // Preload the next few card contents in the background
      const pathsToPreload = candidates.slice(0, 8).map((c) => c.path);
      preloadBatchContent(pathsToPreload);
    } catch (err) {
      console.error('Failed to replenish deck:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async renderTopCards() {
    // Keep 3 cards staged in the visual stack
    while (this.container.children.length < 3 && this.deckQueue.length > 0) {
      const item = this.deckQueue.shift();
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

      // Insert behind existing cards
      this.container.insertBefore(cardEl, this.container.firstChild);
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

  openSettings() {
    const config = getGitHubConfig() || {};
    document.getElementById('cfg-token').value = config.token || '';
    document.getElementById('cfg-owner').value = config.owner || '';
    document.getElementById('cfg-repo').value = config.repo || '';
    document.getElementById('cfg-branch').value = config.branch || 'main';
    this.settingsModal.classList.add('open');
  }

  saveSettings() {
    const token = document.getElementById('cfg-token').value.trim();
    const owner = document.getElementById('cfg-owner').value.trim();
    const repo = document.getElementById('cfg-repo').value.trim();
    const branch = document.getElementById('cfg-branch').value.trim() || 'main';

    saveGitHubConfig({ token, owner, repo, branch });
    this.settingsModal.classList.remove('open');
    this.triggerSync();
  }

  async triggerSync() {
    this.statusEl.textContent = 'Syncing repository manifest...';
    try {
      const folders = await syncRepoManifest((msg) => {
        this.statusEl.textContent = msg;
      });

      // Populate folder select dropdown
      this.folderSelect.innerHTML = '<option value="ALL">All Folders</option>';
      folders.forEach((folder) => {
        const opt = document.createElement('option');
        opt.value = folder;
        opt.textContent = folder;
        this.folderSelect.appendChild(opt);
      });

      this.statusEl.textContent = 'Sync finished.';
      setTimeout(() => (this.statusEl.textContent = ''), 2000);
      this.reloadDeck();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
      this.statusEl.textContent = 'Sync error.';
    }
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
