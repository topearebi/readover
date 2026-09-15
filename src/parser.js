// src/parser.js
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.1/+esm';

// Configure marked options for clean reading layout
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Strips YAML or TOML frontmatter from raw markdown.
 * Returns parsed frontmatter metadata and remaining clean body text.
 */
function stripFrontmatter(rawText) {
  const frontmatterRegex = /^(?:---|\+\+\+)\s*\n([\s\S]*?)\n(?:---|\+\+\+)\s*\n?/;
  const match = rawText.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: rawText.trim() };
  }

  const rawMeta = match[1];
  const body = rawText.slice(match[0].length).trim();
  const metadata = {};

  // Simple key-value parser for basic YAML lines
  rawMeta.split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      metadata[key] = val;
    }
  });

  return { metadata, body };
}

/**
 * Extracts the first H1 from markdown body, if present.
 */
function extractFirstHeading(body) {
  const h1Match = body.match(/^#\s+(.+)$/m);
  return h1Match ? h1Match[1].trim() : null;
}

/**
 * Generates an excerpt/teaser from the markdown body.
 */
function generateTeaser(body, maxLength = 280) {
  // Strip code blocks and HTML
  let clean = body.replace(/```[\s\S]*?```/g, '');
  clean = clean.replace(/<[^>]+>/g, '');

  const lines = clean.split('\n');
  let firstParagraph = '';

  for (let line of lines) {
    line = line.trim();
    // Skip empty lines, headings, horizontal rules, and standalone image links
    if (
      !line ||
      line.startsWith('#') ||
      line.startsWith('---') ||
      line.startsWith('===') ||
      line.startsWith('![')
    ) {
      continue;
    }

    // Capture blockquotes or standard text
    firstParagraph = line.replace(/^>\s*/, '');
    break;
  }

  // Remove markdown bold/italics/links from teaser preview
  firstParagraph = firstParagraph
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link to text
    .replace(/[*_~`]/g, '');                  // formatting markers

  if (firstParagraph.length <= maxLength) {
    return firstParagraph;
  }

  // Truncate cleanly at word boundary
  const sub = firstParagraph.slice(0, maxLength);
  const lastSpace = sub.lastIndexOf(' ');
  return (lastSpace > 0 ? sub.slice(0, lastSpace) : sub) + '...';
}

/**
 * Estimates reading time in minutes based on 200 wpm.
 */
function calculateReadingTime(text) {
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return minutes;
}

/**
 * Main parser entry point: transforms raw markdown into a Card Model.
 * @param {string} rawMarkdown
 * @param {string} path - Repo file path (e.g. "Books/Atomic Habits.md")
 */
export function parseMarkdownToCard(rawMarkdown, path) {
  const { metadata, body } = stripFrontmatter(rawMarkdown);
  const filename = path.split('/').pop().replace(/\.md$/i, '');
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Root';

  const headingTitle = extractFirstHeading(body);
  const title = metadata.title || headingTitle || filename;

  // Remove the H1 from the body if it duplicates the chosen card title
  let contentBody = body;
  if (headingTitle && body.startsWith(`# ${headingTitle}`)) {
    contentBody = body.replace(/^#\s+.+\n?/, '').trim();
  }

  const teaser = generateTeaser(contentBody);
  const isCompact = contentBody.length <= 320;
  const readingTime = calculateReadingTime(contentBody);

  return {
    path,
    folder,
    filename,
    title,
    teaser,
    isCompact,
    readingTime,
    fullHtml: marked.parse(contentBody),
  };
}
