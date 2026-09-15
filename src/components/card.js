// src/components/card.js

/**
 * Creates and mounts a swipeable card component.
 * 
 * @param {Object} cardData - Parsed card object from parseMarkdownToCard
 * @param {Object} callbacks - { onSwipeRight, onSwipeLeft, onStarToggle }
 * @returns {HTMLElement} The card DOM node
 */
export function createCardElement(cardData, { onSwipeRight, onSwipeLeft, onStarToggle }) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.path = cardData.path;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-folder">${escapeHtml(cardData.folder)}</span>
      <button class="card-star-btn" aria-label="Star note">
        <svg class="star-icon" viewBox="0 0 24 24" width="20" height="20">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
    </div>

    <div class="card-content">
      <h2 class="card-title">${escapeHtml(cardData.title)}</h2>
      <p class="card-teaser">${escapeHtml(cardData.teaser)}</p>
    </div>

    <div class="card-footer">
      <span class="reading-time">${cardData.readingTime} min read</span>
      ${!cardData.isCompact ? '<span class="read-more-pill">Tap to read full note →</span>' : ''}
    </div>

    <div class="swipe-indicator indicator-keep">KEEP</div>
    <div class="swipe-indicator indicator-hide">ARCHIVE</div>
  `;

  // Interaction State
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  let hasVibrated = false;
  const THRESHOLD = 120;

  const starBtn = card.querySelector('.card-star-btn');
  const keepBadge = card.querySelector('.indicator-keep');
  const hideBadge = card.querySelector('.indicator-hide');

  // Star button listener
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isStarred = starBtn.classList.toggle('active');
    if ('vibrate' in navigator) navigator.vibrate(8);
    onStarToggle(cardData.path, isStarred);
  });

  // Tap to expand reading modal
  card.addEventListener('click', (e) => {
    if (Math.abs(currentX) > 10) return; // Ignore if user was dragging
    openReaderModal(cardData);
  });

  // Native Pointer Gestures (Touch + Mouse)
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card-star-btn')) return;
    isDragging = true;
    startX = e.clientX;
    currentX = 0;
    hasVibrated = false;
    card.style.transition = 'none';
    card.setPointerCapture(e.pointerId);
  });

  card.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    currentX = e.clientX - startX;
    const rotate = currentX * 0.08;

    card.style.transform = `translate3d(${currentX}px, 0, 0) rotate(${rotate}deg)`;

    // Visual indicators
    if (currentX > 30) {
      keepBadge.style.opacity = Math.min((currentX - 30) / 80, 1);
      hideBadge.style.opacity = '0';
    } else if (currentX < -30) {
      hideBadge.style.opacity = Math.min((-currentX - 30) / 80, 1);
      keepBadge.style.opacity = '0';
    } else {
      keepBadge.style.opacity = '0';
      hideBadge.style.opacity = '0';
    }

    // Single haptic feedback upon crossing swipe threshold
    if (Math.abs(currentX) > THRESHOLD && !hasVibrated) {
      if ('vibrate' in navigator) navigator.vibrate(12);
      hasVibrated = true;
    } else if (Math.abs(currentX) <= THRESHOLD) {
      hasVibrated = false;
    }
  });

  const onPointerEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = 'transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s';

    if (currentX > THRESHOLD) {
      // Swiped Right -> Keep in rotation
      card.style.transform = `translate3d(120vw, 0, 0) rotate(25deg)`;
      card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        onSwipeRight(cardData.path);
      }, 250);
    } else if (currentX < -THRESHOLD) {
      // Swiped Left -> Archive from feed
      card.style.transform = `translate3d(-120vw, 0, 0) rotate(-25deg)`;
      card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        onSwipeLeft(cardData.path);
      }, 250);
    } else {
      // Return to Center
      card.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      keepBadge.style.opacity = '0';
      hideBadge.style.opacity = '0';
    }
    currentX = 0;
  };

  card.addEventListener('pointerup', onPointerEnd);
  card.addEventListener('pointercancel', onPointerEnd);

  return card;
}

/**
 * Opens fullscreen slide-up reading modal.
 */
export function openReaderModal(cardData) {
  let modal = document.getElementById('reader-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reader-modal';
    modal.className = 'reader-modal';
    modal.innerHTML = `
      <div class="reader-header">
        <button id="reader-close-btn" class="reader-close-btn">✕ Close</button>
      </div>
      <article class="reader-body markdown-body"></article>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#reader-close-btn').addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  const body = modal.querySelector('.reader-body');
  body.innerHTML = `
    <header class="reader-meta">
      <span class="card-folder">${escapeHtml(cardData.folder)}</span>
      <h1>${escapeHtml(cardData.title)}</h1>
    </header>
    ${cardData.fullHtml}
  `;

  modal.classList.add('open');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
