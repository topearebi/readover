// src/components/card.js
import { getNoteSha, getCachedThumbnail, getReadingProgress } from '../db.js';
import { saveNoteFile, fetchNoteContent } from '../github.js';
import { parseMarkdownToCard } from '../parser.js';

/**
 * Creates and mounts a polymorphic full-viewport TikTok-style snap card.
 * Handles text notes (.md, .txt), books (.epub), and documents (.pdf).
 * 
 * @param {Object} itemData - Item manifest record (path, filename, folder, mediaType)
 * @param {Object|null} contentData - Parsed markdown data (for text items)
 * @param {boolean} isStarred - Whether the item is favorited
 * @param {Object} callbacks - Interaction hooks { onStarToggle, onOpenDocument }
 * @returns {Promise<HTMLElement>} Configured snap card element
 */
export async function createCardElement(itemData, contentData = null, isStarred = false, { onStarToggle, onOpenDocument } = {}) {
  const card = document.createElement('section');
  card.className = 'snap-card';
  card.dataset.path = itemData.path;
  card.dataset.mediaType = itemData.mediaType || 'text';
  card.tabIndex = -1;

  const isDocument = ['epub', 'pdf'].includes(itemData.mediaType);
  const badgeClass = itemData.mediaType === 'epub' ? 'epub' : itemData.mediaType === 'pdf' ? 'pdf' : 'note';
  const badgeLabel = itemData.mediaType === 'epub' ? 'EPUB' : itemData.mediaType === 'pdf' ? 'PDF' : 'NOTE';

  // Read saved progress if available
  const progressRecord = await getReadingProgress(itemData.path);
  const progressPct = progressRecord ? Math.round(progressRecord.percentage * 100) : 0;

  // Retrieve cached cover thumbnail for documents
  let coverObjectUrl = null;
  if (isDocument) {
    const thumbBlob = await getCachedThumbnail(itemData.path);
    if (thumbBlob) {
      coverObjectUrl = URL.createObjectURL(thumbBlob);
    }
  }

  // Shell Layout
  card.innerHTML = `
    <div class="card-inner">
      ${isDocument && coverObjectUrl ? `<div class="card-ambient-bg" style="background-image: url('${coverObjectUrl}')"></div>` : ''}

      <div class="card-header">
        <div class="card-badges-row">
          <span class="format-badge ${badgeClass}">${badgeLabel}</span>
          <span class="card-folder-badge">${escapeHtml(itemData.folder || 'Root')}</span>
        </div>
        <div class="reading-meta">
          ${isDocument ? (progressPct > 0 ? `${progressPct}% read` : 'Unread') : `${contentData?.readingTime || 1} min read`}
        </div>
      </div>

      ${isDocument ? renderDocumentBody(itemData, coverObjectUrl, progressPct) : renderTextBody(contentData)}

      <!-- Floating Interaction Rail -->
      <aside class="floating-rail">
        <button class="rail-btn star-btn ${isStarred ? 'starred' : ''}" aria-label="Favorite" title="Favorite">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>

        <button class="rail-btn expand-btn" aria-label="Open Reader" title="${isDocument ? 'Read Document' : 'Expand Note'}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
        </button>

        <button class="rail-btn share-btn" aria-label="Share" title="Share">
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

  // Attach Interaction Listeners
  const bodyEl = card.querySelector('.card-body');
  const starBtn = card.querySelector('.star-btn');
  const expandBtn = card.querySelector('.expand-btn');
  const shareBtn = card.querySelector('.share-btn');

  // Text Note Overflow Detection
  if (!isDocument && bodyEl) {
    requestAnimationFrame(() => {
      if (bodyEl.scrollHeight > bodyEl.clientHeight + 12) {
        bodyEl.classList.add('has-overflow');
      }
    });
  }

  // Open Reader / Viewer Trigger
  const triggerOpen = () => {
    if ('vibrate' in navigator) navigator.vibrate(10);
    if (isDocument) {
      if (onOpenDocument) onOpenDocument(itemData);
    } else {
      openReaderModal(contentData, card);
    }
  };

  bodyEl.addEventListener('click', (e) => {
    if (isDocument || bodyEl.classList.contains('has-overflow')) {
      triggerOpen();
    }
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerOpen();
  });

  // Favorite / Star Action
  starBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isNowStarred = starBtn.classList.toggle('starred');
    const svg = starBtn.querySelector('svg');
    svg.setAttribute('fill', isNowStarred ? 'currentColor' : 'none');

    if ('vibrate' in navigator) navigator.vibrate([8, 20, 8]);
    if (onStarToggle) {
      await onStarToggle(itemData.path, isNowStarred);
    }
  });

  // Share Action
  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if ('vibrate' in navigator) navigator.vibrate(6);

    const shareTitle = isDocument ? itemData.filename : contentData?.title;
    const shareText = isDocument 
      ? `Reading "${itemData.filename}" on ReadOver` 
      : `${contentData?.title}\n\n${contentData?.teaser || ''}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(shareText);
      alert('Copied to clipboard!');
    }
  });

  return card;
}

/**
 * Renders the body layout for text and markdown files.
 */
function renderTextBody(contentData) {
  return `
    <div class="card-body type-text">
      <h1 class="card-title">${escapeHtml(contentData?.title || 'Untitled Note')}</h1>
      <div class="markdown-preview">${contentData?.fullHtml || ''}</div>
      <div class="card-overflow-fade"></div>
      <div class="expand-prompt-pill">
        <span>Read full note</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </div>
  `;
}

/**
 * Renders the visual cover layout for EPUBs and PDFs.
 */
function renderDocumentBody(itemData, coverUrl, progressPct) {
  const cleanTitle = itemData.filename.replace(/\.(epub|pdf)$/i, '');

  return `
    <div class="card-body type-document">
      <div class="document-cover-wrap">
        ${coverUrl 
          ? `<img src="${coverUrl}" alt="Cover art" class="document-cover-img" loading="lazy" />`
          : `<div class="document-cover-placeholder"><span>${escapeHtml(cleanTitle)}</span></div>`
        }
      </div>

      <div class="document-meta-plate">
        <h1 class="card-title">${escapeHtml(cleanTitle)}</h1>
        <div class="document-progress-container">
          <div class="document-progress-bar">
            <div class="document-progress-fill" style="width: ${progressPct}%"></div>
          </div>
          <span class="document-progress-label">${progressPct > 0 ? `${progressPct}% complete` : 'Tap to read'}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Markdown Reader & In-Place Editor Modal
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
        <textarea id="reader-editor-input" class="reader-textarea" spellcheck="true" placeholder="Draft note in markdown..."></textarea>
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

  editBtn.onclick = async () => {
    if (editPane.style.display === 'none') {
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
      const tempCard = parseMarkdownToCard(editorInput.value, cardData.path);
      renderPreview(tempCard);
      editPane.style.display = 'none';
      previewPane.style.display = 'block';
      editBtn.textContent = 'Edit';
      saveBtn.style.display = 'none';
    }
  };

  saveBtn.onclick = async () => {
    const updatedContent = editorInput.value;
    statusEl.textContent = 'Committing changes...';
    saveBtn.disabled = true;

    try {
      const currentSha = await getNoteSha(cardData.path);
      await saveNoteFile(cardData.path, updatedContent, currentSha);

      const updatedCard = parseMarkdownToCard(updatedContent, cardData.path);
      renderPreview(updatedCard);

      if (associatedCardEl) {
        const titleEl = associatedCardEl.querySelector('.card-title');
        const previewEl = associatedCardEl.querySelector('.markdown-preview');
        if (titleEl) titleEl.textContent = updatedCard.title;
        if (previewEl) previewEl.innerHTML = updatedCard.fullHtml;
      }

      if ('vibrate' in navigator) navigator.vibrate(15);
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
