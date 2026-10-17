// The small dot in the top bar: are my changes safely on GitHub?
//   hidden        nothing waiting
//   hollow ring   changes saved on this device, waiting to be sent (or sending)
//   filled        just sent; fades after a moment
//   red           something needs attention (tap for details)
import * as outbox from '../outbox.js';
import { lastSync, syncNow, dataHome } from '../sync.js';
import { toast } from './overlay.js';
import { getDirty } from '../store.js';

let doneTimer = null;
let queue = { pending: 0, errors: 0, message: '' };
let syncing = false;

export function initStatus({ openSettings }) {
  const dot = document.getElementById('sync-dot');

  const render = () => {
    const sync = lastSync();
    const syncError = !sync.ok && !/offline|could not be reached/i.test(sync.message);
    let state = 'idle';
    let label = '';
    if (queue.errors || syncError) {
      state = 'error';
      label = queue.message || sync.message;
    } else if (queue.pending || syncing) {
      state = 'waiting';
      label = navigator.onLine
        ? `Saving ${queue.pending ? `${queue.pending} ${queue.pending === 1 ? 'change' : 'changes'}` : 'your reading'} to GitHub`
        : `${queue.pending || 'Some'} ${queue.pending === 1 ? 'change' : 'changes'} saved on this device. They'll go to GitHub when you're back online.`;
    }
    if (state === 'idle' && dot.dataset.state === 'waiting') {
      state = 'done';
      label = 'All changes are on GitHub';
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        dot.dataset.state = 'idle';
        dot.hidden = true;
      }, 2500);
    }
    if (state === 'idle' && dot.dataset.state === 'done') return;
    dot.dataset.state = state;
    dot.hidden = state === 'idle';
    dot.title = label || 'Sync status';
    dot.setAttribute('aria-label', label || 'Sync status');
  };

  dot.onclick = () => {
    const state = dot.dataset.state;
    if (state === 'error') {
      toast(dot.title || 'Some changes could not be saved', {
        label: 'Try again',
        run: () => {
          outbox.process({ retryErrors: true });
          if (dataHome()) syncNow();
        },
      });
    } else if (state === 'waiting') toast(dot.title);
    else if (state === 'done') toast('All changes are on GitHub');
    else openSettings();
  };

  window.addEventListener('readover:outbox', (e) => {
    queue = e.detail;
    render();
  });
  window.addEventListener('readover:sync', (e) => {
    // Only show the dot for syncs that carry real changes, not routine checks.
    syncing = e.detail.phase === 'syncing' && Boolean(getDirty().important);
    render();
  });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  outbox.status().then((s) => {
    queue = s;
    render();
  });
}
