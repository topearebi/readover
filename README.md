# Notes Deck

A lightweight, distraction-free Progressive Web App (PWA) that transforms personal Markdown notes and book highlights hosted in GitHub repositories into a tactile, swipeable card feed (reels/dating app model).

---

## 1. Philosophy & Core Objectives

* **Intentional "Doomscrolling":** Replaces algorithmic social feeds with personal knowledge bases.
* **Non-Destructive Local Triage:** Reviews, stars, and hides notes without altering underlying `.md` files or triggering Git commits.
* **Zero-Build, Static Deployment:** Runs entirely on native browser technologies (ES modules, IndexedDB, Service Workers). Ready for GitHub Pages with zero CI/CD build pipelines.
* **Offline-First Resilience:** The app shell and cached notes remain fully usable without an active internet connection.

---

## 2. Architecture Overview

GitHub API (Private/Public Repos)
│

├─ Git Trees API (recursive=1)  --> Full vault hierarchy / Manifest (1 request)

└─ Contents API (vnd.github.raw) --> Plain text markdown stream (CORS-safe)

│

▼

Local Storage Layer (Client Browser)

├─ localStorage: Multi-vault credentials, theme state, active vault ID.

└─ IndexedDB (Dexie.js): Isolated database per vault profile (MarkdownDeckDB_{id})

├── manifest: File paths, commit SHAs, folder structure.

├── content: Cached raw markdown text with fetch timestamps.

└── state: Review history (lastSeen), feeds flags (hidden, starred).

│

▼

Deck Controller & Parsing Engine

├─ Frontmatter stripper (YAML/TOML)

├─ Title & 280-char teaser extractor

├─ Native Pointer gesture recognizer (drag, rotation, commit thresholds, haptics)

└─ Full Markdown bottom sheet reader (marked.js)

---

## 3. Directory Structure

├── index.html              # Shell layout, modals, SW auto-reload registration

├── manifest.json           # PWA metadata and install configuration

├── sw.js                   # Service Worker cache versioning & asset caching

└── src/

├── app.js              # State coordinator, keyboard controls, profile switcher

├── db.js               # Dynamic IndexedDB factory & review queue queries

├── github.js           # GitHub API client (manifest sync, raw content fetch)

├── parser.js           # Frontmatter removal, teaser generation, Markdown parsing

├── style.css           # CSS variables (Light Purple / Dark), tactile UI, clamp sizing

└── components/

└── card.js         # Card DOM generator, touch physics, reader modal

---

## 4. Key Technical Decisions & Edge Cases

| Area | Challenge | Solution |

| :--- | :--- | :--- |

| **Private Repo Access** | `raw.githubusercontent.com` fails CORS `OPTIONS` preflight with `403 Forbidden` on private repos. | Use `api.github.com/repos/{owner}/{repo}/contents/{path}` with header `Accept: application/vnd.github.raw` and a fine-grained Personal Access Token. |

| **Multi-Vault Isolation** | Collisions between notes and states across different accounts/repos. | Dynamic database factory in `db.js` (`MarkdownDeckDB_${vaultId}`). Switching vaults swaps the DB instance instantly with zero cross-talk. |

| **Review Algorithm** | Avoiding repetitive cards across thousands of notes without spaced repetition overhead. | `getDeckQueue()` excludes `hidden=1`, prioritizes unreviewed (`lastSeen=0`), sorts by oldest `lastSeen ASC`, and injects random millisecond jitter. |

| **Cache Invalidation** | PWA shell stubbornly serving stale assets on deployment. | `APP_VERSION` bump in `sw.js` paired with `self.skipWaiting()`, `clients.claim()`, and a `controllerchange` listener in `index.html` that triggers an instant reload. |

---

## 5. Setup & Deployment

1. **Host:** Push the root directory to GitHub. In **Settings > Pages**, set source to deploy from the `main` branch root (`/`).
2. **Configure:** Open the deployed site, tap **⚙ (Settings)**, and add a vault profile:
   * **GitHub Owner:** Account or organization name.
   * **Repository Name:** Target notes repository.
   * **Branch:** Default branch (e.g., `main`).
   * **Token:** Fine-grained GitHub PAT with `Contents: Read-only` and `Metadata: Read-only`.
3. **PWA Install:** In mobile Safari or Chrome, select **Add to Home Screen** for a standalone, full-screen reading experience.

---

## 6. Controls

* **Swipe Right / ✓ Button (`ArrowRight` / `L`):** Keep note in rotation (updates `lastSeen`).
* **Swipe Left / ✕ Button (`ArrowLeft` / `H`):** Archive note from feed (`hidden = 1`).
* **Tap Card / Read Button (`Space` / `Enter`):** Open slide-up full Markdown reading modal.
* **Star Button (`S`):** Toggle bookmark status.
* **Escape:** Close any active modal or reader sheet.
