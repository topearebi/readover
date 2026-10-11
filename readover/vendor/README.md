# Vendored libraries

Served from this repo so Readover depends on nothing outside GitHub Pages.
Loaded lazily: PDF.js only when a PDF is shown, foliate-js only when another kind of book is,
Readability and Turndown only when an article is saved.

Each library lives in a folder named `<name>-<version>`. A file at a given
address therefore never changes, and the service worker caches it permanently.

| Folder | Package | Licence |
| --- | --- | --- |
| `marked-15.0.12/` | marked | MIT |
| `dompurify-3.2.6/` | dompurify | MPL-2.0 or Apache-2.0 |
| `pdfjs-4.10.38/` | pdfjs-dist | Apache-2.0 |
| `foliate-js-78914ae/` | [foliate-js](https://github.com/johnfactotum/foliate-js) at commit 78914ae (May 2026), the files `view.js` imports plus its `vendor/zip.js` and `vendor/fflate.js` | MIT (zip.js BSD-3-Clause, fflate MIT) |
| `literata-5.2.5/` | @fontsource-variable/literata | OFL-1.1 |
| `readability-0.6.0/` | @mozilla/readability `Readability.js`, with one line added at the end to export it as an ES module | Apache-2.0 |
| `turndown-7.2.4/` | turndown `lib/turndown.browser.es.js` | MIT |
| `turndown-plugin-gfm-1.0.2/` | turndown-plugin-gfm `lib/turndown-plugin-gfm.browser.es.js` | MIT |

To update a library:
1. `npm pack <package>@<version>` and copy the same file into a new
   `<name>-<version>/` folder. foliate-js isn't on npm: copy the same files
   from a newer commit of its GitHub repo into `foliate-js-<commit>/`.
2. Change the path where it's used: `src/lib/vendor.js` (pdf.js, foliate-js,
   Readability, Turndown),
   `src/markdown.js` (marked, DOMPurify), `src/style.css`, `index.html` and
   `src/viewers/book.js` (font).
3. If it's listed in `VENDOR` in `sw.js`, update it there too.
4. Delete the old folder.
