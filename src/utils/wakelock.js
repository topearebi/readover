// Screen Wake Lock API controller for reading sessions
let sentinel = null;
let readerMounted = false;

/**
 * Acquire screen wake lock if supported and document is visible.
 * Returns sentinel object, or null.
 */
export async function acquireWakeLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) {
    return null;
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return null;
  }
  try {
    if (!sentinel || sentinel.released) {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener?.('release', () => {
        // Sentinel released by system or manually
      });
    }
    return sentinel;
  } catch (err) {
    console.warn('Screen WakeLock acquisition failed:', err);
    return null;
  }
}

/**
 * Release active screen wake lock if currently held.
 */
export async function releaseWakeLock() {
  if (sentinel && !sentinel.released) {
    try {
      await sentinel.release();
    } catch (err) {
      console.warn('Screen WakeLock release failed:', err);
    } finally {
      sentinel = null;
    }
  }
}

/**
 * Returns current active sentinel or null.
 */
export function getWakeLockSentinel() {
  return sentinel;
}

/**
 * Handles reader mounting/unmounting lifecycle:
 * acquires lock when reader mounts, releases when reader unmounts.
 */
export async function setReaderMounted(mounted) {
  readerMounted = Boolean(mounted);
  if (readerMounted) {
    return acquireWakeLock();
  } else {
    await releaseWakeLock();
  }
}

/**
 * Initialize visibility change listener to release when hidden
 * and re-acquire when visible (if reader is mounted).
 */
export function initWakeLock() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      await releaseWakeLock();
    } else if (readerMounted) {
      await acquireWakeLock();
    }
  });
}

// Auto-initialize when running in document environment
if (typeof document !== 'undefined') {
  initWakeLock();
}

