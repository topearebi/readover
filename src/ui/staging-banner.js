// Staging Banner: Non-intrusive docked banner for external files opened via OS
// (window.launchQueue) allowing users to read immediately in ephemeral mode and
// decide whether to stash permanently to their configured vault.

import { el, icon } from './overlay.js';
import { displayName } from '../library.js';
import { booksHome, notesHome } from '../insights.js';

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `(${bytes} B)`;
  if (bytes < 1024 * 1024) return `(${Math.round(bytes / 1024)} KB)`;
  return `(${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
}

/**
 * Creates and docks a non-intrusive Staging Banner at the top of the viewer.
 *
 * @param {Object} opts
 * @param {File} opts.file The native File object opened from the OS
 * @param {'book'|'note'} opts.type Whether this is a book (EPUB/PDF) or note (Markdown)
 * @param {Function} opts.onCommit Async function called when user taps "Add to Shelf" / "Save Note"
 * @param {Function} [opts.onDismiss] Optional callback when user taps "Read Temporarily" / dismiss
 * @param {HTMLElement} [opts.container] Viewer root element to dock into (defaults to document.querySelector('.reader') or document.body)
 * @returns {HTMLElement} The created banner element
 */
export function showStagingBanner({ file, type = 'book', onCommit, onDismiss, container = null }) {
  const isBook = type === 'book';
  const targetSource = isBook ? booksHome() : notesHome();
  const vaultName = displayName(targetSource) || (isBook ? 'Shelf' : 'Notes');

  const docIconName = isBook ? 'book' : 'feed';
  const commitLabel = isBook ? `Add to Shelf (${vaultName})` : `Save Note (${vaultName})`;
  const sizeText = formatFileSize(file?.size);

  const bannerIcon = el('div', { class: 'staging-banner-icon' }, icon(docIconName, 'i i-sm'));
  const bannerText = el(
    'div',
    { class: 'staging-banner-text' },
    el('span', { class: 'staging-banner-provenance' }, 'Opened from your device'),
    el(
      'span',
      { class: 'staging-banner-title' },
      `“${file?.name || 'External Document'}”`,
      sizeText ? el('span', { class: 'staging-banner-size' }, sizeText) : null
    )
  );
  const leftCol = el('div', { class: 'staging-banner-left' }, bannerIcon, bannerText);

  let committing = false;
  const commitBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn-staging-commit',
      title: isBook ? 'Save permanently to your configured books vault' : 'Save permanently to your configured notes vault',
    },
    icon('graft', 'i i-sm'),
    el('span', {}, commitLabel)
  );

  const dismissBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn-staging-dismiss',
      title: 'Continue reading temporarily without adding to cloud vault',
    },
    icon('close', 'i i-sm'),
    el('span', {}, 'Read Temporarily')
  );

  const actions = el('div', { class: 'staging-banner-actions' }, commitBtn, dismissBtn);

  const banner = el('div', { class: 'staging-banner', role: 'region', 'aria-label': 'File Staging Options' }, leftCol, actions);

  function removeBanner() {
    banner.classList.add('is-closing');
    banner.remove();
  }

  commitBtn.onclick = async () => {
    if (committing) return;
    committing = true;
    commitBtn.disabled = true;
    commitBtn.textContent = 'Saving…';
    try {
      if (onCommit) await onCommit();
      removeBanner();
    } catch (err) {
      console.error('Failed to commit staged file:', err);
      commitBtn.disabled = false;
      commitBtn.replaceChildren(icon('graft', 'i i-sm'), el('span', {}, commitLabel));
    }
  };

  dismissBtn.onclick = () => {
    onDismiss?.();
    removeBanner();
  };

  // Mount into container
  const targetParent = container || document.querySelector('.reader') || document.body;
  const readerBar = targetParent.querySelector('.reader-bar');
  if (readerBar) {
    readerBar.after(banner);
  } else {
    targetParent.prepend(banner);
  }

  return banner;
}

