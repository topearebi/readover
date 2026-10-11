// "Save an article": web pages arrive from the bookmarklet (the whole page, sent from
// the article's tab), from the share sheet on Android (a link only), or by pasting.
// They're saved as Markdown notes, then opened for reading and highlighting.
import * as store from '../store.js';
import { canWrite, displayName, writeNote, deviceSource, DEVICE_ID, notePath } from '../library.js';
import { renderMarkdown } from '../markdown.js';
import { fromPage, fromPaste, toMarkdown, wordCount } from '../articles.js';
import { el, toast } from './overlay.js';
import { sheet } from './sheet.js';

const FOLDER = 'Articles';
const firstUrl = (s) => /https?:\/\/[^\s<>"]+/i.exec(s || '')?.[0] || '';

/** The bookmarklet's code, pointing at this copy of Readover. */
export function bookmarkletCode() {
  const target = new URL('./', location.href).href;
  const origin = location.origin;
  const code =
    `(()=>{const t=${JSON.stringify(target)},o=${JSON.stringify(origin)},` +
    `d={type:'readover-clip',url:location.href,title:document.title,html:document.documentElement.outerHTML};` +
    `const w=open(t+'#clip='+encodeURIComponent(JSON.stringify({url:d.url,title:d.title})));if(!w)return;` +
    `const f=e=>{if(e.source===w&&e.data==='readover-clip-ready'){w.postMessage(d,o);removeEventListener('message',f)}};` +
    `addEventListener('message',f)})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/**
 * @param app { home(): source to save to by default, openItem(item), showFirst(item) }
 */
export function initClip(app) {
  /** Where articles can be saved: writable repos and folders, then this device. */
  function destinations() {
    const writable = store.getSources().filter((s) => s.type !== 'device' && canWrite(s));
    return [...writable.map((s) => ({ id: s.id, label: displayName(s) })), { id: DEVICE_ID, label: 'This device' }];
  }

  async function save(article, destId, folder) {
    const dest = destId === DEVICE_ID ? deviceSource(true) : store.getSource(destId);
    let path = notePath(folder, article.title.slice(0, 90));
    for (let n = 2; await store.items.get(store.keyOf(dest.id, path)); n++) {
      path = notePath(folder, `${article.title.slice(0, 90)} ${n}`);
    }
    const item = await writeNote(dest, path, toMarkdown(article), { message: `Readover: save article ${path}` });
    toast(dest.type === 'device' ? 'Saved on this device' : `Saved to ${displayName(dest)}`);
    app.showFirst?.(item);
    app.openItem(item);
    return item;
  }

  /**
   * The sheet. With an `article` it shows a preview to save; without one it asks for
   * the article to be pasted (formatting is kept), with the link if known.
   */
  async function open({ article = null, url = '', title = '', note = '' } = {}) {
    const dests = destinations();
    const homeId = app.home()?.id;
    const destSel = el('select', { name: 'dest' }, ...dests.map((d) => el('option', { value: d.id }, d.label)));
    destSel.value = dests.some((d) => d.id === homeId) ? homeId : dests[0].id;
    const folderIn = el('input', { name: 'folder', value: FOLDER, autocapitalize: 'off', spellcheck: 'false' });
    const titleIn = el('input', { name: 'title', value: article?.title || title, placeholder: 'Title', required: true });
    const urlIn = el('input', { name: 'url', type: 'url', value: article?.url || url, placeholder: 'https://…', autocapitalize: 'off', spellcheck: 'false' });
    const preview = el('div', { class: 'clip-preview' });
    const info = el('p', { class: 'hint clip-info' });
    const pasteBox = el('div', { class: 'clip-paste', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Paste the article here', 'data-placeholder': 'Paste the article here' });
    let current = article;

    const showArticle = (a) => {
      current = a;
      titleIn.value = titleIn.value.trim() || a.title;
      const mins = Math.max(1, Math.round(wordCount(a) / 220));
      info.textContent = [a.site, a.author, `${mins} min read`].filter(Boolean).join(' · ');
      const prose = el('div', { class: 'prose' });
      prose.innerHTML = renderMarkdown(a.body.slice(0, 1600) + (a.body.length > 1600 ? '…' : ''));
      prose.querySelectorAll('img').forEach((i) => i.remove());
      preview.replaceChildren(prose);
      preview.hidden = false;
      pasteBox.hidden = true;
    };

    pasteBox.addEventListener('paste', async (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      if (!urlIn.value && firstUrl(text) === text.trim()) {
        urlIn.value = text.trim(); // they pasted the link here
        return;
      }
      showArticle(await fromPaste({ html, text, url: urlIn.value.trim(), title: titleIn.value.trim() }));
    });

    const fields = [];
    if (note) fields.push(el('p', { class: 'hint clip-note' }, note));
    fields.push(el('label', { class: 'field' }, 'Title', titleIn));
    if (!article) fields.push(el('label', { class: 'field' }, 'Link', urlIn));
    fields.push(info, preview, pasteBox);
    fields.push(el('div', { class: 'field-pair' }, el('label', { class: 'field' }, 'Save to', destSel), el('label', { class: 'field' }, 'Folder', folderIn)));
    if (article) preview.hidden = false;
    else preview.hidden = true;

    const { value } = await sheet({
      title: 'Save an article',
      tall: true,
      fields,
      submit: 'Save and read',
      onOpen: () => {
        if (article) showArticle(article);
        else setTimeout(() => (urlIn.value ? pasteBox : urlIn).focus(), 60);
      },
    });
    if (value !== 'ok') return null;

    let a = current;
    if (!a) {
      // Typed rather than pasted, or nothing but a link.
      const typed = pasteBox.innerText.trim();
      if (!typed && !urlIn.value.trim()) {
        toast('Nothing to save: paste the article, or add its link');
        return null;
      }
      a = await fromPaste({ text: typed, url: urlIn.value.trim(), title: titleIn.value.trim() });
      if (!typed) a.body = `[Read it on ${a.site || 'the web'}](${a.url})`;
    }
    a = { ...a, title: titleIn.value.trim() || a.title, url: a.url || urlIn.value.trim() };
    try {
      return await save(a, destSel.value, folderIn.value.trim().replace(/^\/|\/$/g, ''));
    } catch (err) {
      toast(err.message);
      return null;
    }
  }

  /** Called at start-up: was Readover opened to receive an article? */
  async function receive() {
    const hash = location.hash;
    const params = new URLSearchParams(location.search);
    if (hash.startsWith('#clip')) {
      let info = {};
      try {
        info = JSON.parse(decodeURIComponent(hash.slice(6)) || '{}');
      } catch {}
      history.replaceState(null, '', location.pathname);
      let data = null;
      if (window.opener) {
        const got = new Promise((resolve) => {
          const on = (e) => {
            if (e.source === window.opener && e.data?.type === 'readover-clip' && typeof e.data.html === 'string') {
              removeEventListener('message', on);
              resolve(e.data);
            }
          };
          addEventListener('message', on);
          setTimeout(() => resolve(null), 5000);
        });
        window.opener.postMessage('readover-clip-ready', '*');
        data = await got;
      }
      if (data) {
        toast('Reading the page…');
        try {
          const article = await fromPage({ html: data.html, url: String(data.url || ''), title: String(data.title || '') });
          return open({ article });
        } catch (err) {
          toast(`Couldn't read that page: ${err.message}`);
        }
      }
      return open({
        url: info.url || '',
        title: info.title || '',
        note: "That site didn't let the page through. Select the article there, copy it, and paste it below.",
      });
    }
    if (params.has('url') || params.has('text')) {
      // From the share sheet (Android): a link, sometimes with a title.
      const url = params.get('url') || firstUrl(params.get('text'));
      const title = params.get('title') || '';
      history.replaceState(null, '', location.pathname);
      if (url) {
        return open({ url, title, note: 'Sharing only sends the link. To save the whole article, copy it on the page and paste it here.' });
      }
    }
    return null;
  }

  return { open, receive };
}
