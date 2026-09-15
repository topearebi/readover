// src/components/card.js
import { getNoteSha } from '../db.js';
import { saveNoteFile, fetchNoteContent } from '../github.js';
import { parseMarkdownToCard } from '../parser.js';

/**
 * Creates and mounts a full-viewport TikTok-style snap card.
 */
export function createCardElement(cardData, isStarred = false, { onStarToggle } = {}) {
  const card = document.createElement('section');
  card.className = 'snap-card';
  card.dataset.path = cardData.path;

  card.innerHTML = `
    <div class="card-inner">
      <div class="card-header">
        <span class="card-folder-badge">${escapeHtml(cardData.folder)}</span>
        <span class="reading-time">${cardData.readingTime} min read</span>
      </div>

      <div class="card-body">
        <h1 class="card-title">${escapeHtml(cardData.title)}</h1>
        <div class="markdown-preview">${cardData.fullHtml}</div>
        <div class="card-overflow-fade"></div>
        <div class="expand-prompt-pill">
          <span>Read full note</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>

      <!-- Floating Interaction Rail -->
      <aside class="floating-rail">
        <button class="rail-btn star-btn ${isStarred ? 'starred' : ''}" aria-label="Favorite Note" title="Favorite">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>

        <button class="rail-btn expand-btn" aria-label="Open Reader" title="Expand Full Note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
        </button>

        <button class="rail-btn share-btn" aria-label="Share Note" title="Share">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
        </button>
      </aside>
    </div>
  `;

  const bodyEl = card.querySelector('.card-body');
  const starBtn = card.querySelector('.star-btn');
  const expandBtn = card.querySelector('.expand-btn');
  const shareBtn = card.querySelector('.share-btn');

  requestAnimationFrame(() => {
    if (bodyEl.scrollHeight > bodyEl.clientHeight + 10) {
      bodyEl.classList.add('has-overflow');
    }
  });

  bodyEl.addEventListener('click', () => {
    if (bodyEl.classList.contains('has-overflow')) {
      openReaderModal(cardData, card);
    }
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openReaderModal(cardData, card);
  });

  starBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isNowStarred = starBtn.classList.toggle('starred');
    const svg = starBtn.querySelector('svg');
    svg.setAttribute('fill', isNowStarred ? 'currentColor' : 'none');

    if ('vibrate' in navigator) navigator.vibrate(10);
    if (onStarToggle) {
      await onStarToggle(cardData.path, isNowStarred);
    }
  });

  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if ('vibrate' in navigator) navigator.vibrate(8);

    if (navigator.share) {
      try {
        await navigator.share({
          title: cardData.title,
          text: `${cardData.title}\n\n${cardData.teaser}`,
        });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(`${cardData.title}\n\n${cardData.fullHtml}`);
      alert('Note copied to clipboard!');
    }
  });

  return card;
}

/**
 * Opens fullscreen slide-up reading modal with inline editing.
 * @param {Object} cardData - Parsed card metadata & html
 * @param {HTMLElement|null} associatedCardEl - The card element in the feed to update live
 */
export async function openReaderModal(cardData, associatedCardEl = null) {
  let modal = document.getElementById('reader-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reader-modal';
    modal.className = 'reader-modal';
    modal.innerHTML = `
      <div class="reader-header">
        <div class="reader-header-left">
          <span class="card-folder-badge" id="reader-folder"></span>
          <span id="reader-status" class="reader-status"></span>
        </div>
        <div class="reader-header-right">
          <button id="reader-edit-btn" class="reader-action-btn">Edit</button>
          <button id="reader-save-btn" class="reader-action-btn btn-save" style="display:none;">Save</button>
          <button id="reader-close-btn" class="reader-close-btn">✕ Done</button>
        </div>
      </div>
      <article id="reader-preview-pane" class="reader-body markdown-preview"></article>
      <div id="reader-edit-pane" class="reader-editor-container" style="display:none;">
        <textarea id="reader-editor-input" class="reader-textarea" spellcheck="true" placeholder="Write markdown..."></textarea>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#reader-close-btn').addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  const folderBadge = modal.querySelector('#reader-folder');
  const statusEl = modal.querySelector('#reader-status');
  const previewPane = modal.querySelector('#reader-preview-pane');
  const editPane = modal.querySelector('#reader-edit-pane');
  const editorInput = modal.querySelector('#reader-editor-input');
  const editBtn = modal.querySelector('#reader-edit-btn');
  const saveBtn = modal.querySelector('#reader-save-btn');

  folderBadge.textContent = cardData.folder;
  statusEl.textContent = '';
  editPane.style.display = 'none';
  previewPane.style.display = 'block';
  editBtn.style.display = 'inline-block';
  saveBtn.style.display = 'none';
  editBtn.textContent = 'Edit';

  const renderPreview = (data) => {
    previewPane.innerHTML = `
      <header class="reader-meta">
        <h1 class="card-title">${escapeHtml(data.title)}</h1>
      </header>
      ${data.fullHtml}
    `;
  };

  renderPreview(cardData);

  // Toggle Edit / Preview modes
  editBtn.onclick = async () => {
    if (editPane.style.display === 'none') {
      // Enter Edit Mode
      statusEl.textContent = 'Loading source...';
      const rawMarkdown = await fetchNoteContent(cardData.path);
      editorInput.value = rawMarkdown;
      statusEl.textContent = '';

      previewPane.style.display = 'none';
      editPane.style.display = 'block';
      editBtn.textContent = 'Preview';
      saveBtn.style.display = 'inline-block';
      editorInput.focus();
    } else {
      // Return to Preview Mode
      const tempCard = parseMarkdownToCard(editorInput.value, cardData.path);
      renderPreview(tempCard);
      editPane.style.display = 'none';
      previewPane.style.display = 'block';
      editBtn.textContent = 'Edit';
      saveBtn.style.display = 'none';
    }
  };

  // Commit changes to GitHub
  saveBtn.onclick = async () => {
    const updatedContent = editorInput.value;
    statusEl.textContent = 'Committing changes...';
    saveBtn.disabled = true;

    try {
      const currentSha = await getNoteSha(cardData.path);
      await saveNoteFile(cardData.path, updatedContent, currentSha);

      // Re-parse and update preview
      const updatedCard = parseMarkdownToCard(updatedContent, cardData.path);
      renderPreview(updatedCard);

      // Update the underlying card in the feed if mounted
      if (associatedCardEl) {
        const titleEl = associatedCardEl.querySelector('.card-title');
        const previewEl = associatedCardEl.querySelector('.markdown-preview');
        if (titleEl) titleEl.textContent = updatedCard.title;
        if (previewEl) previewEl.innerHTML = updatedCard.fullHtml;
      }

      statusEl.textContent = 'Saved!';
      setTimeout(() => (statusEl.textContent = ''), 2000);

      editPane.style.display = 'none';
      previewPane.style.display = 'block';
      editBtn.textContent = 'Edit';
      saveBtn.style.display = 'none';
    } catch (err) {
      alert(`Save failed: ${err.message}`);
      statusEl.textContent = 'Save error';
    } finally {
      saveBtn.disabled = false;
    }
  };

  modal.classList.add('open');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
