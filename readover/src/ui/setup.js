// "Keep your notes safe": move notes written on this device into a GitHub repo.
// Works for someone with no GitHub setup at all (pre-filled links to create a repo
// and a token), and for someone who already connected a repo (just pick it).
import * as store from '../store.js';
import * as library from '../library.js';
import * as github from '../sources/github.js';
import * as dataSync from '../sync.js';
import { openSheet, closeTop, toast, el } from './overlay.js';

const REPO_LINK =
  'https://github.com/new?name=notes&visibility=private&description=My+notes,+read+with+Readover';
export const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Readover&description=Lets+Readover+read+and+save+your+notes&expires_in=366&contents=write';

/** @param app { afterConnect(src): Promise } */
export function initSetup(app) {
  const sheet = document.getElementById('setup-sheet');
  const form = document.getElementById('setup-form');
  document.getElementById('setup-repo-link').href = REPO_LINK;
  document.getElementById('setup-token-link').href = TOKEN_URL;

  const writableRepos = () => store.getSources().filter((s) => s.type === 'github' && github.canWrite(s));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const submit = document.getElementById('setup-submit');
    submit.disabled = true;
    try {
      let dest;
      if (!document.getElementById('setup-existing').hidden) {
        dest = store.getSource(f.dest.value);
      } else {
        const parsed = github.parseRepoInput(f.repo.value);
        if (!parsed) throw new Error('Enter the repository as yourname/notes, or paste its GitHub link.');
        if (!f.token.value.trim() && !store.getToken()) throw new Error('Paste the token you created in step 2.');
        if (f.token.value.trim()) store.setToken(f.token.value);
        dest = store.getSources().find((s) => s.type === 'github' && s.owner.toLowerCase() === parsed.owner.toLowerCase() && s.repo.toLowerCase() === parsed.repo.toLowerCase());
        if (!dest) {
          dest = { id: store.newId('gh'), type: 'github', owner: parsed.owner, repo: parsed.repo, branch: parsed.branch, root: '', ignore: '', token: '', name: parsed.repo };
          const info = await github.repoInfo(dest); // also checks the token can see it
          dest.branch = dest.branch || info.defaultBranch || 'main';
          store.saveSource(dest);
        }
        await app.afterConnect(dest);
      }
      const moved = await library.moveDeviceNotes(dest, f.folder.value.trim(), (m) => toast(m));
      if (dataSync.ensureDataHome()) dataSync.syncNow();
      localStorage.removeItem('readover.nudge.safe');
      closeTop();
      toast(moved ? `Your ${moved} ${moved === 1 ? 'note is' : 'notes are'} now in ${dest.owner}/${dest.repo}` : `Connected ${dest.owner}/${dest.repo}`);
      await app.afterMove();
    } catch (err) {
      toast(err.message);
    } finally {
      submit.disabled = false;
    }
  };

  return {
    async open() {
      const dev = library.deviceSource();
      const count = dev ? (await store.items.byIndex('sourceId', dev.id)).length : 0;
      const repos = writableRepos();
      form.reset();
      document.getElementById('setup-new').hidden = repos.length > 0;
      document.getElementById('setup-existing').hidden = repos.length === 0;
      form.elements.dest.replaceChildren(...repos.map((s) => el('option', { value: s.id }, `${s.owner}/${s.repo}`)));
      const home = dataSync.dataHome();
      if (home) form.elements.dest.value = home.id;
      document.getElementById('setup-submit').textContent = repos.length
        ? `Move ${count} ${count === 1 ? 'note' : 'notes'}`
        : count
          ? `Connect and move ${count} ${count === 1 ? 'note' : 'notes'}`
          : 'Connect';
      await openSheet(sheet);
    },
  };
}

/* ---------- When to suggest it ---------- */

const DAY = 86400000;

/**
 * Suggest moving to GitHub once the notebook matters: 10 notes, or 3 notes kept
 * for 3 days. "Not now" waits a week. Never shown once a writable repo exists.
 */
export async function shouldNudge() {
  const dev = library.deviceSource();
  if (!dev) return false;
  if (store.getSources().some((s) => s.type === 'github' && github.canWrite(s))) return false;
  const snoozed = Number(localStorage.getItem('readover.nudge.safe') || 0);
  if (snoozed > Date.now()) return false;
  const notes = await store.items.byIndex('sourceId', dev.id);
  const oldest = Math.min(...notes.map((n) => n.addedAt || Date.now()));
  return notes.length >= 10 || (notes.length >= 3 && Date.now() - oldest > 3 * DAY);
}

export function snoozeNudge() {
  localStorage.setItem('readover.nudge.safe', String(Date.now() + 7 * DAY));
}
