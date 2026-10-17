// Unified Reading Appearance Customizer for EPUB (Foliate) and PDF (PDF.js).
// Supports four distinct color themes (Paper, Sepia, Dark, Night), EPUB typography
// (typeface, line height, font size, 68ch measure), and PDF page fit/zoom controls.

import { el } from './overlay.js';
import { getPrefs, setPrefs } from '../store.js';

export const THEMES = {
  paper: {
    id: 'paper',
    name: 'Paper',
    bg: '#fbf9f5',
    fg: '#1c1917',
    link: '#2d5a3f',
    marker: '#fef08a',
    markerInk: '#1c1917',
    colorScheme: 'light',
  },
  sepia: {
    id: 'sepia',
    name: 'Sepia',
    bg: '#f4ecd8',
    fg: '#433422',
    link: '#8c531b',
    marker: '#e6c888',
    markerInk: '#2d1e0d',
    colorScheme: 'light',
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#1e1e1d',
    fg: '#e7e5e4',
    link: '#68a67d',
    marker: '#3e4c3a',
    markerInk: '#f5f5f4',
    colorScheme: 'dark',
  },
  night: {
    id: 'night',
    name: 'Night',
    bg: '#000000',
    fg: '#cccccc',
    link: '#7ab38e',
    marker: '#2a3328',
    markerInk: '#ffffff',
    colorScheme: 'dark',
  },
};

export const FONT_FAMILIES = {
  serif: "'Literata', Georgia, serif",
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export const LINE_HEIGHTS = {
  compact: 1.45,
  normal: 1.65,
  relaxed: 1.9,
};

const defaultFontUrl = new URL('../../vendor/literata-5.2.5/literata-latin-wght-normal.woff2', import.meta.url).href;
const defaultFontItalicUrl = new URL('../../vendor/literata-5.2.5/literata-latin-wght-italic.woff2', import.meta.url).href;

export function getReaderAppearance() {
  const prefs = getPrefs();
  let bookFont = 100;
  if (typeof localStorage !== 'undefined') {
    bookFont = Number(localStorage.getItem('readover.bookFont')) || 100;
  }
  return {
    theme: prefs.readerTheme || 'paper',
    font: prefs.readerFont || 'serif',
    lineHeight: prefs.readerLineHeight || 'normal',
    fontSize: Number(prefs.readerFontSize) || bookFont || 100,
    pdfFit: prefs.pdfFit || 'width',
  };
}

export function saveReaderAppearance(patch) {
  setPrefs(patch);
  if (patch.fontSize != null && typeof localStorage !== 'undefined') {
    localStorage.setItem('readover.bookFont', patch.fontSize);
  }
}

export function buildBookCSS({
  fontSize = 100,
  theme = 'paper',
  font = 'serif',
  lineHeight = 'normal',
  fontUrl = defaultFontUrl,
  fontItalicUrl = defaultFontItalicUrl,
} = {}) {
  const c = THEMES[theme] || THEMES.paper;
  const ff = FONT_FAMILIES[font] || FONT_FAMILIES.serif;
  const lh = LINE_HEIGHTS[lineHeight] || LINE_HEIGHTS.normal;

  const fontFaces = fontUrl && fontItalicUrl ? `
    @font-face { font-family: 'Literata'; src: url('${fontUrl}') format('woff2'); font-weight: 200 900; }
    @font-face { font-family: 'Literata'; src: url('${fontItalicUrl}') format('woff2'); font-weight: 200 900; font-style: italic; }
  ` : '';

  return `
    ${fontFaces}
    html { color-scheme: ${c.colorScheme}; }
    html, body {
      background: ${c.bg} !important;
      color: ${c.fg} !important;
    }
    body {
      font-family: ${ff} !important;
      font-size: ${fontSize}% !important;
      line-height: ${lh} !important;
      max-width: 68ch !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }
    p, li, blockquote, dd {
      line-height: ${lh};
      hanging-punctuation: allow-end last;
      widows: 2;
      max-width: 68ch;
    }
    p, li, blockquote, dd, span, div, h1, h2, h3, h4 { color: inherit !important; }
    a:link, a:visited { color: ${c.link} !important; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    ::selection { background: ${c.marker}; color: ${c.markerInk}; }
  `;
}

export function createAppearancePopover({
  type = 'epub', // 'epub' | 'pdf'
  anchor = null,
  state = {},
  onChange = () => {},
  onClose = () => {},
} = {}) {
  const popover = el('div', { class: 'appearance-popover', role: 'dialog', 'aria-label': 'Reading appearance' });

  // 1. Theme Swatches Row
  const themeSwatches = Object.values(THEMES).map((th) => {
    const isActive = (state.theme || 'paper') === th.id;
    const btn = el(
      'button',
      {
        type: 'button',
        class: `theme-swatch ${isActive ? 'is-active' : ''}`,
        role: 'radio',
        'aria-checked': String(isActive),
        'aria-label': `${th.name} theme`,
        title: th.name,
      },
      el('span', { class: `swatch-preview theme-${th.id}` }),
      el('span', { class: 'swatch-name' }, th.name)
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      popover.querySelectorAll('.theme-swatch').forEach((s) => {
        s.classList.remove('is-active');
        s.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      state.theme = th.id;
      onChange({ theme: th.id });
    };
    return btn;
  });

  const themeSection = el(
    'div',
    { class: 'appearance-section' },
    el('div', { class: 'appearance-label' }, 'Theme'),
    el('div', { class: 'appearance-themes', role: 'radiogroup', 'aria-label': 'Color theme' }, ...themeSwatches)
  );

  popover.append(themeSection);

  if (type === 'epub') {
    // 2. Typeface Selection (Serif vs Sans)
    const fontSerifBtn = el('button', { type: 'button', class: `seg-btn ${state.font !== 'sans' ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(state.font !== 'sans') }, 'Literata (Serif)');
    const fontSansBtn = el('button', { type: 'button', class: `seg-btn ${state.font === 'sans' ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(state.font === 'sans') }, 'Sans-Serif');

    fontSerifBtn.onclick = (e) => {
      e.stopPropagation();
      fontSansBtn.classList.remove('is-active');
      fontSansBtn.setAttribute('aria-checked', 'false');
      fontSerifBtn.classList.add('is-active');
      fontSerifBtn.setAttribute('aria-checked', 'true');
      state.font = 'serif';
      onChange({ font: 'serif' });
    };

    fontSansBtn.onclick = (e) => {
      e.stopPropagation();
      fontSerifBtn.classList.remove('is-active');
      fontSerifBtn.setAttribute('aria-checked', 'false');
      fontSansBtn.classList.add('is-active');
      fontSansBtn.setAttribute('aria-checked', 'true');
      state.font = 'sans';
      onChange({ font: 'sans' });
    };

    const fontSection = el(
      'div',
      { class: 'appearance-section' },
      el('div', { class: 'appearance-label' }, 'Typeface'),
      el('div', { class: 'appearance-seg', role: 'radiogroup', 'aria-label': 'Typeface' }, fontSerifBtn, fontSansBtn)
    );

    // 3. Line Spacing Selection (Compact, Normal, Relaxed)
    const spacingBtns = [
      { id: 'compact', label: 'Compact' },
      { id: 'normal', label: 'Normal' },
      { id: 'relaxed', label: 'Relaxed' },
    ].map((sp) => {
      const isActive = (state.lineHeight || 'normal') === sp.id;
      const b = el('button', { type: 'button', class: `seg-btn ${isActive ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(isActive) }, sp.label);
      b.onclick = (e) => {
        e.stopPropagation();
        spacingBtns.forEach((item) => {
          item.classList.remove('is-active');
          item.setAttribute('aria-checked', 'false');
        });
        b.classList.add('is-active');
        b.setAttribute('aria-checked', 'true');
        state.lineHeight = sp.id;
        onChange({ lineHeight: sp.id });
      };
      return b;
    });

    const spacingSection = el(
      'div',
      { class: 'appearance-section' },
      el('div', { class: 'appearance-label' }, 'Line Spacing'),
      el('div', { class: 'appearance-seg', role: 'radiogroup', 'aria-label': 'Line spacing' }, ...spacingBtns)
    );

    // 4. Text Size Stepper
    let curSize = state.fontSize || 100;
    const sizeVal = el('span', { class: 'stepper-val' }, `${curSize}%`);
    const smallerBtn = el('button', { type: 'button', class: 'btn btn-quiet stepper-btn', 'aria-label': 'Smaller text' }, 'A−');
    const largerBtn = el('button', { type: 'button', class: 'btn btn-quiet stepper-btn', 'aria-label': 'Larger text' }, 'A+');

    smallerBtn.onclick = (e) => {
      e.stopPropagation();
      curSize = Math.max(80, curSize - 10);
      sizeVal.textContent = `${curSize}%`;
      state.fontSize = curSize;
      onChange({ fontSize: curSize });
    };

    largerBtn.onclick = (e) => {
      e.stopPropagation();
      curSize = Math.min(180, curSize + 10);
      sizeVal.textContent = `${curSize}%`;
      state.fontSize = curSize;
      onChange({ fontSize: curSize });
    };

    const sizeSection = el(
      'div',
      { class: 'appearance-section' },
      el('div', { class: 'appearance-label' }, 'Text Size'),
      el('div', { class: 'appearance-stepper' }, smallerBtn, sizeVal, largerBtn)
    );

    popover.append(fontSection, spacingSection, sizeSection);
  } else if (type === 'pdf') {
    // 2. Page Fit (Fit to Width vs Fit to Page)
    const fitWidthBtn = el('button', { type: 'button', class: `seg-btn ${state.pdfFit !== 'page' ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(state.pdfFit !== 'page') }, 'Fit to Width');
    const fitPageBtn = el('button', { type: 'button', class: `seg-btn ${state.pdfFit === 'page' ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(state.pdfFit === 'page') }, 'Fit to Page');

    fitWidthBtn.onclick = (e) => {
      e.stopPropagation();
      fitPageBtn.classList.remove('is-active');
      fitPageBtn.setAttribute('aria-checked', 'false');
      fitWidthBtn.classList.add('is-active');
      fitWidthBtn.setAttribute('aria-checked', 'true');
      state.pdfFit = 'width';
      onChange({ pdfFit: 'width' });
    };

    fitPageBtn.onclick = (e) => {
      e.stopPropagation();
      fitWidthBtn.classList.remove('is-active');
      fitWidthBtn.setAttribute('aria-checked', 'false');
      fitPageBtn.classList.add('is-active');
      fitPageBtn.setAttribute('aria-checked', 'true');
      state.pdfFit = 'page';
      onChange({ pdfFit: 'page' });
    };

    const fitSection = el(
      'div',
      { class: 'appearance-section' },
      el('div', { class: 'appearance-label' }, 'Page Fit'),
      el('div', { class: 'appearance-seg', role: 'radiogroup', 'aria-label': 'Page fit mode' }, fitWidthBtn, fitPageBtn)
    );

    // 3. Zoom Stepper
    let curZoom = state.zoom || 1;
    const zoomVal = el('span', { class: 'stepper-val' }, `${Math.round(curZoom * 100)}%`);
    const zoomOutBtn = el('button', { type: 'button', class: 'btn btn-quiet stepper-btn', 'aria-label': 'Zoom out' }, '− Zoom');
    const zoomInBtn = el('button', { type: 'button', class: 'btn btn-quiet stepper-btn', 'aria-label': 'Zoom in' }, '+ Zoom');

    zoomOutBtn.onclick = (e) => {
      e.stopPropagation();
      if (curZoom > 0.5) {
        curZoom = Math.max(0.5, Math.round((curZoom - 0.25) * 100) / 100);
        zoomVal.textContent = `${Math.round(curZoom * 100)}%`;
        state.zoom = curZoom;
        fitWidthBtn.classList.remove('is-active');
        fitPageBtn.classList.remove('is-active');
        onChange({ zoom: curZoom });
      }
    };

    zoomInBtn.onclick = (e) => {
      e.stopPropagation();
      if (curZoom < 2.5) {
        curZoom = Math.min(2.5, Math.round((curZoom + 0.25) * 100) / 100);
        zoomVal.textContent = `${Math.round(curZoom * 100)}%`;
        state.zoom = curZoom;
        fitWidthBtn.classList.remove('is-active');
        fitPageBtn.classList.remove('is-active');
        onChange({ zoom: curZoom });
      }
    };

    const zoomSection = el(
      'div',
      { class: 'appearance-section' },
      el('div', { class: 'appearance-label' }, 'Zoom Scale'),
      el('div', { class: 'appearance-stepper' }, zoomOutBtn, zoomVal, zoomInBtn)
    );

    popover.append(fitSection, zoomSection);
  }

  // Dismiss on outside click or Escape
  const handlePointerDown = (e) => {
    if (!popover.contains(e.target) && anchor !== e.target && !anchor?.contains(e.target)) {
      dismiss();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  };

  function dismiss() {
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('keydown', handleKeyDown);
    popover.remove();
    onClose();
  }

  setTimeout(() => {
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
  }, 10);

  return popover;
}

