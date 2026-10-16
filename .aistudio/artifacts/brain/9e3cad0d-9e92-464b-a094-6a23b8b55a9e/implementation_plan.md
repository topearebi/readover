# Revised Production Hardening, Module Integrity & Deployment Plan

## 1. Upstream & Downstream Error Analysis

### Issue A: Fatal SyntaxError in `reader.js:14` (`setupImageAttachments`)
- **Reported Error**: `reader.js:14 Uncaught SyntaxError: The requested module '../attachments.js' does not provide an export named 'setupImageAttachments' (at reader.js:14:10)`.
- **Root Cause & Upstream Trigger**:
  1. `setupImageAttachments` is exported in the working tree `/src/attachments.js`.
  2. However, the Service Worker in `sw.js` was registered with `SHELL_CACHE = 'readover-shell-v6'` and `networkFirst()` with a 1500ms timeout fallback to cache.
  3. Previous visits cached an older version of `attachments.js` into the `readover-shell-v6` CacheStorage before `setupImageAttachments` was added.
  4. Because the cache version was never bumped to `v7`, any client with an active Service Worker served the stale, cached `attachments.js`.
- **Fatal Knock-on Effects (Downstream)**:
  1. In modern JavaScript ES module loaders, static `import` declarations are verified and linked during the Module Instantiation phase *before* any script body evaluates.
  2. An export mismatch produces a fatal `SyntaxError` that terminates the evaluation of `src/app.js` and all imported UI modules.
  3. As a result, `boot()` never executed, event listeners (click, scroll, keyboard shortcuts) were never attached to the DOM, and cards were never rendered. The page appeared as an inert, unresponsive HTML shell.
- **Secondary Discovered Export Mismatch**:
  - Our automated Node ESM validation revealed that `src/ui/diagnostics.js:11` imports `parseAtomXml` from `../sources/opds.js`, but `opds.js` exported only `parseOpds1Atom`. While currently loaded dynamically on shortcut press, this would trigger an identical fatal SyntaxError when launching the diagnostics panel.

### Issue B: Manifest `enctype` Warning
- **Reported Warning**: `Manifest: Enctype should be set to either application/x-www-form-urlencoded or multipart/form-data. It currently defaults to application/x-www-form-urlencoded`.
- **Root Cause**: In `manifest.json`, the `share_target` declaration defined `action: "./"` and `method: "GET"`, but omitted the explicit `enctype` field required by modern Chromium manifest parsers.
- **Mitigation**: Add `"enctype": "application/x-www-form-urlencoded"` to `manifest.json`.

---

## 2. Comprehensive Implementation Steps

### Step 1: Export Consistency & Upstream Module Hardening
1. **`src/sources/opds.js`**:
   - Export both `parseOpds1Atom` and its alias `export { parseOpds1Atom as parseAtomXml }` so all callers (`diagnostics.js`, `opds.js`, tests) resolve seamlessly without SyntaxErrors.
2. **`src/attachments.js` & `src/ui/reader.js`**:
   - Verify `setupImageAttachments` export and signature:
     ```js
     export function setupImageAttachments(textarea, { getSource = () => null, folder = '' } = {})
     ```
   - Ensure null-safety so if a textarea or DOM node is missing, it exits gracefully without throwing.
3. **Automated ESM Validation Script**:
   - Run our Node ESM import test on all 51 JavaScript files in `src/` to verify 0 SyntaxErrors and 100% export-import linkage across the dependency graph.

### Step 2: Manifest Hardening (`manifest.json`)
1. Explicitly specify `"enctype": "application/x-www-form-urlencoded"` under `share_target`.
2. Confirm relative values for `"id": "./"`, `"start_url": "./"`, and `"scope": "./"` to guarantee correct operation on GitHub Pages subpaths (e.g., `user.github.io/readover/`) and custom apex domains alike.

### Step 3: Service Worker Cache Version Bump (`sw.js`)
1. Bump `SHELL_CACHE` from `readover-shell-v6` to `readover-shell-v7`.
2. Add missing application modules to the `SHELL` precache list:
   - `./src/ui/diagnostics.js`
   - `./src/articles.js`
3. Verify cache purging in `activate` event: ensure all older caches (`readover-shell-v6`, `readover-shell-v5`, etc.) are purged immediately and clients are claimed via `self.clients.claim()`.
4. Ensure `sw.js` supports the `SKIP_WAITING` message from the in-app update banner.

### Step 4: Stale-Cache Prevention & Boot Error Boundary
1. **Global Boot Error Boundary in `index.html`**:
   - Add a lightweight error listener in `index.html` before the module scripts:
     ```html
     <script>
       window.addEventListener('error', function(e) {
         var banner = document.getElementById('sw-update-banner');
         if (banner) {
           banner.hidden = false;
           var msg = banner.querySelector('.update-msg');
           if (msg) msg.textContent = 'App update detected or cache refreshed. Reload to continue.';
         }
       }, { once: true });
     </script>
     ```
   - If an unhandled module load failure or stale cache error occurs, the user immediately sees a clean, accessible banner: **"App update detected. [Reload to continue]"** instead of an unresponsive screen.
2. **In-App Service Worker Update Banner (`src/app.js` & `index.html`)**:
   - Detect when a new service worker is waiting (`reg.waiting`).
   - Display a non-intrusive floating banner: **"An update to Readover is ready. [Refresh]"**.
   - Clicking sends `{ type: 'SKIP_WAITING' }` to the waiting worker and reloads the window on `controllerchange`.
3. **Hard Cache Flush Option in Diagnostics & Settings**:
   - Provide a 1-click **"Clear All Caches & Reload"** button that unregisters workers, deletes all CacheStorage caches, and reloads from network.

### Step 5: Static Deployment & Documentation Hardening
1. **Repository Root Files**:
   - Ensure `.nojekyll` exists at repo root.
   - Verify `404.html` redirection/fallback for SPA routing on GitHub Pages.
2. **README Documentation Update**:
   - **Static Deployment Checklist**: Relative asset paths, `.nojekyll` requirement, SPA 404 handling.
   - **CORS Troubleshooting Guide**: Caddy and Nginx reverse proxy configs for Calibre/OPDS servers, Cloudflare R2 / AWS S3 CORS headers.
   - **PWA Offline & Mobile Installation Matrix**: Service Worker registration verification, clearing stale cache, iOS WebKit persistent storage, and Android Chrome standalone installation criteria.
3. **Design Notes Compliance Audit**:
   - Verify serene warm paper palette (`#f5f5f0` light, `#1c1c1a` dark), Literata typography, minimal UI chrome, full-screen immersive reading, and touch targets.

---

## 3. Verification & Validation Plan
1. **Automated ESM Dependency Check**: Run Node ESM loader on all modules to ensure zero syntax errors or missing exports.
2. **Applet Compilation**: Run `compile_applet` and `lint_applet` to verify clean build.
3. **Manifest Validation**: Inspect `manifest.json` against web app manifest schema.
4. **Service Worker Verification**: Test cache activation, update messaging, and offline resource availability.
