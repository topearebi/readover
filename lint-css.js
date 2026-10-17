import fs from 'node:fs';
import path from 'node:path';

/**
 * Structural CSS Block & Bracket Validator for Readover
 *
 * Performs PostCSS-equivalent structural parsing to detect:
 * 1. Unclosed curly brace blocks ({ ... }) including @media, @keyframes, @supports, and selectors
 * 2. Unclosed comments (/* ... *\/)
 * 3. Unclosed quotes ('...' and "...")
 * 4. Mismatched or unclosed parentheses (calc(), var(), @media queries)
 * 5. Mismatched or unclosed square brackets ([attr=val])
 */

export function validateCssStructure(cssText, filename = 'src/style.css') {
  const errors = [];
  const braceStack = [];
  const parenStack = [];
  const bracketStack = [];

  let line = 1;
  let col = 1;
  let inComment = false;
  let commentStart = null;
  let inString = null; // '"' or "'"
  let stringStart = null;
  let selectorBuffer = '';

  const len = cssText.length;
  for (let i = 0; i < len; i++) {
    const ch = cssText[i];
    const next = i + 1 < len ? cssText[i + 1] : '';

    // Handle line / column tracking
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }

    // Inside comment?
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++; // skip /
        col++;
      }
      continue;
    }

    // Inside string?
    if (inString) {
      if (ch === '\\') {
        // Escaped character, skip next
        i++;
        col++;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    // Check comment start
    if (ch === '/' && next === '*') {
      inComment = true;
      commentStart = { line, col: col - 1 };
      i++; // skip *
      col++;
      continue;
    }

    // Check string start
    if (ch === '"' || ch === "'") {
      inString = ch;
      stringStart = { line, col, quote: ch };
      continue;
    }

    // Structural tokens
    if (ch === '{') {
      const preview = selectorBuffer.trim().replace(/\s+/g, ' ').slice(-60) || '(anonymous block)';
      braceStack.push({ line, col, preview });
      selectorBuffer = '';
    } else if (ch === '}') {
      if (braceStack.length === 0) {
        errors.push({
          file: filename,
          line,
          col,
          message: 'Unexpected closing brace "}" without corresponding opening "{"',
        });
      } else {
        braceStack.pop();
      }
      selectorBuffer = '';
    } else if (ch === '(') {
      parenStack.push({ line, col });
    } else if (ch === ')') {
      if (parenStack.length === 0) {
        errors.push({
          file: filename,
          line,
          col,
          message: 'Unexpected closing parenthesis ")" without corresponding opening "("',
        });
      } else {
        parenStack.pop();
      }
    } else if (ch === '[') {
      bracketStack.push({ line, col });
    } else if (ch === ']') {
      if (bracketStack.length === 0) {
        errors.push({
          file: filename,
          line,
          col,
          message: 'Unexpected closing square bracket "]" without corresponding opening "["',
        });
      } else {
        bracketStack.pop();
      }
    } else {
      selectorBuffer += ch;
    }
  }

  // Check EOF states
  if (inComment) {
    errors.push({
      file: filename,
      line: commentStart.line,
      col: commentStart.col,
      message: 'Unclosed comment (/*) reaching end of file',
    });
  }

  if (inString) {
    errors.push({
      file: filename,
      line: stringStart.line,
      col: stringStart.col,
      message: `Unclosed string literal (${stringStart.quote}) reaching end of file`,
    });
  }

  while (braceStack.length > 0) {
    const unclosed = braceStack.pop();
    errors.push({
      file: filename,
      line: unclosed.line,
      col: unclosed.col,
      message: `Unclosed block "{" at line ${unclosed.line}:${unclosed.col} [selector: "${unclosed.preview}"]`,
    });
  }

  while (parenStack.length > 0) {
    const unclosed = parenStack.pop();
    errors.push({
      file: filename,
      line: unclosed.line,
      col: unclosed.col,
      message: `Unclosed parenthesis "(" opened at line ${unclosed.line}:${unclosed.col}`,
    });
  }

  while (bracketStack.length > 0) {
    const unclosed = bracketStack.pop();
    errors.push({
      file: filename,
      line: unclosed.line,
      col: unclosed.col,
      message: `Unclosed square bracket "[" opened at line ${unclosed.line}:${unclosed.col}`,
    });
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

export function runCssLint(files = ['src/style.css']) {
  const startTime = Date.now();
  const allErrors = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const res = validateCssStructure(content, file);
    if (!res.success) {
      allErrors.push(...res.errors);
    }
  }

  const duration = Date.now() - startTime;
  if (allErrors.length > 0) {
    console.error(`\n❌ Structural CSS Validation FAILED (${allErrors.length} error(s) in ${duration}ms):\n`);
    for (const err of allErrors) {
      console.error(`  ${err.file}:${err.line}:${err.col} - ${err.message}`);
    }
    return { success: false, errors: allErrors, duration };
  }

  console.log(`✅ Structural CSS block & bracket check PASSED across ${files.length} file(s) (${duration}ms)!`);
  return { success: true, errors: [], duration };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runCssLint();
  process.exit(result.success ? 0 : 1);
}

