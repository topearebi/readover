// Lazy loaders for the heavy, same-origin vendored libraries in /vendor.
// Each library sits in a folder named with its version, so files at a given URL never
// change and the service worker can cache them permanently. To update a library, add a
// new folder and change the path here.
const base = new URL('../../vendor/', import.meta.url);
const PDFJS = 'pdfjs-4.10.38/';
const FOLIATE = 'foliate-js-78914ae/';

let pdfjs;
export async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = import(new URL(`${PDFJS}pdf.min.mjs`, base).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(`${PDFJS}pdf.worker.min.mjs`, base).href;
      return lib;
    });
  }
  return pdfjs;
}

/** foliate-js: EPUB, MOBI/AZW3, FB2 and CBZ. Importing view.js defines <foliate-view>. */
let foliate;
export async function loadFoliate() {
  if (!foliate) {
    foliate = Promise.all([
      import(new URL(`${FOLIATE}view.js`, base).href),
      import(new URL(`${FOLIATE}overlayer.js`, base).href),
    ]).then(([view, overlayer]) => ({ makeBook: view.makeBook, Overlayer: overlayer.Overlayer }));
  }
  return foliate;
}
