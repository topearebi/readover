import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

/**
 * Instant Pure Static no-undef Checker for Readover
 *
 * Performs AST lexical scope analysis using Acorn to detect
 * any undeclared identifiers (typos, accidental deletions, out-of-scope references).
 */

const KNOWN_GLOBALS = new Set([
  // ECMAScript Builtins
  'globalThis', 'console', 'Math', 'JSON', 'Promise', 'Set', 'Map', 'WeakSet', 'WeakMap',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'Symbol', 'BigInt', 'ArrayBuffer',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'DataView', 'Proxy', 'Reflect', 'Intl', 'Infinity',
  'NaN', 'undefined', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'encodeURI',
  'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'escape', 'unescape',

  // Browser & DOM Globals
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'indexedDB', 'IDBRequest', 'IDBKeyRange', 'CustomEvent', 'Event', 'Blob', 'File',
  'FileReader', 'URL', 'URLSearchParams', 'fetch', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'HTMLElement', 'Element',
  'Node', 'DocumentFragment', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement',
  'HTMLSelectElement', 'HTMLDialogElement', 'DOMParser', 'XMLSerializer', 'Notification',
  'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'Performance',
  'performance', 'crypto', 'Response', 'Request', 'Headers', 'FormData', 'Image',
  'Audio', 'getComputedStyle', 'CSS', 'CanvasRenderingContext2D', 'OffscreenCanvas',
  'btoa', 'atob', 'confirm', 'alert', 'prompt', 'matchMedia', 'BroadcastChannel',
  'ClipboardItem', 'removeEventListener', 'addEventListener',

  // Service Worker Globals
  'caches', 'self', 'importScripts', 'clients', 'skipWaiting', 'registration',

  // Third-party vendored globals (loaded via vendor scripts)
  'marked', 'DOMPurify', 'Overlayer', 'pdfjsLib',
]);

class Scope {
  constructor(parent = null, isFunction = false) {
    this.parent = parent;
    this.isFunction = isFunction;
    this.bindings = new Set();
  }

  declare(name) {
    if (name) this.bindings.add(name);
  }

  has(name) {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }
}

function extractBindings(node, scope) {
  if (!node) return;
  if (node.type === 'Identifier') {
    scope.declare(node.name);
  } else if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      extractBindings(decl.id, scope);
    }
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        extractBindings(prop.value, scope);
      } else if (prop.type === 'RestElement') {
        extractBindings(prop.argument, scope);
      }
    }
  } else if (node.type === 'ArrayPattern') {
    for (const elem of node.elements) {
      if (elem) extractBindings(elem, scope);
    }
  } else if (node.type === 'AssignmentPattern') {
    extractBindings(node.left, scope);
  } else if (node.type === 'RestElement') {
    extractBindings(node.argument, scope);
  } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) scope.declare(node.id.name);
  }
}

export function lintFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest', locations: true });
  } catch (err) {
    return [{ file: filePath, message: `Syntax error: ${err.message}`, loc: err.loc }];
  }

  const undeclared = [];
  const moduleScope = new Scope();

  // Pass 1: Hoist module imports and top-level function declarations
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        moduleScope.declare(spec.local.name);
      }
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      moduleScope.declare(node.id.name);
    } else if (node.type === 'ClassDeclaration' && node.id) {
      moduleScope.declare(node.id.name);
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      extractBindings(node.declaration, moduleScope);
    }
  }

  function checkScope(node, scope) {
    if (!node || typeof node !== 'object') return;

    let currentScope = scope;

    if (node.type === 'FunctionDeclaration') {
      // Function declaration name belongs to outer scope
      if (node.id) scope.declare(node.id.name);
      currentScope = new Scope(scope, true);
      for (const param of node.params) extractBindings(param, currentScope);
      if (node.body) checkScope(node.body, currentScope);
      return;
    }

    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      currentScope = new Scope(scope, true);
      if (node.id) currentScope.declare(node.id.name);
      for (const param of node.params) extractBindings(param, currentScope);
      if (node.body) checkScope(node.body, currentScope);
      return;
    }

    if (node.type === 'BlockStatement') {
      currentScope = new Scope(scope, false);
      for (const stmt of node.body) {
        if (stmt.type === 'FunctionDeclaration' && stmt.id) {
          currentScope.declare(stmt.id.name);
        }
      }
    } else if (node.type === 'CatchClause') {
      currentScope = new Scope(scope, false);
      if (node.param) extractBindings(node.param, currentScope);
      if (node.body) checkScope(node.body, currentScope);
      return;
    } else if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      currentScope = new Scope(scope, false);
      if (node.init && node.init.type === 'VariableDeclaration') {
        extractBindings(node.init, currentScope);
      } else if (node.left && node.left.type === 'VariableDeclaration') {
        extractBindings(node.left, currentScope);
      }
    } else if (node.type === 'VariableDeclaration') {
      // Variable declaration in current scope
      extractBindings(node, currentScope);
      for (const decl of node.declarations) {
        if (decl.init) checkScope(decl.init, currentScope);
      }
      return;
    } else if (node.type === 'Identifier') {
      const name = node.name;
      if (!currentScope.has(name) && !KNOWN_GLOBALS.has(name)) {
        undeclared.push({
          file: filePath,
          name,
          loc: node.loc?.start,
          message: `'${name}' is not defined.`,
        });
      }
      return;
    }

    // Traversal rules to ignore non-reference identifiers
    if (node.type === 'MetaProperty') {
      return;
    }

    if (node.type === 'MemberExpression') {
      checkScope(node.object, currentScope);
      if (node.computed) checkScope(node.property, currentScope);
      return;
    }

    if (node.type === 'Property') {
      if (node.computed) checkScope(node.key, currentScope);
      checkScope(node.value, currentScope);
      return;
    }

    if (node.type === 'MethodDefinition') {
      if (node.computed) checkScope(node.key, currentScope);
      checkScope(node.value, currentScope);
      return;
    }

    if (node.type === 'LabeledStatement') {
      checkScope(node.body, currentScope);
      return;
    }

    if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') {
      return; // Labels are not variable references
    }

    if (node.type === 'ImportDeclaration') {
      return; // Handled in Pass 1
    }

    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        checkScope(node.declaration, currentScope);
      } else if (node.specifiers) {
        for (const spec of node.specifiers) {
          if (!node.source && spec.local && spec.local.type === 'Identifier') {
            const name = spec.local.name;
            if (!currentScope.has(name) && !KNOWN_GLOBALS.has(name)) {
              undeclared.push({
                file: filePath,
                name,
                loc: spec.local.loc?.start,
                message: `'${name}' is not defined in export.`,
              });
            }
          }
        }
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) checkScope(c, currentScope);
      } else if (child && typeof child === 'object') {
        checkScope(child, currentScope);
      }
    }
  }

  for (const node of ast.body) {
    checkScope(node, moduleScope);
  }

  return undeclared;
}

export function runLint({ targetDirs = ['src'], targetFiles = ['sw.js'] } = {}) {
  const startTime = Date.now();
  const allFiles = [...targetFiles];

  function collectJs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJs(full);
      } else if (entry.isFile() && full.endsWith('.js')) {
        allFiles.push(full);
      }
    }
  }

  for (const d of targetDirs) collectJs(d);

  const errors = [];
  for (const file of allFiles) {
    const errs = lintFile(file);
    if (errs.length) errors.push(...errs);
  }

  const duration = Date.now() - startTime;

  if (errors.length) {
    console.error(`\n❌ ESLint no-undef Check Failed (${errors.length} undeclared variable(s) found in ${duration}ms):\n`);
    for (const e of errors) {
      console.error(`  ${e.file}:${e.loc?.line ?? 1}:${e.loc?.column ?? 0} - ${e.message}`);
    }
    return { success: false, errors, count: allFiles.length, duration };
  }

  console.log(`✅ Static no-undef check passed: 0 undeclared variables across ${allFiles.length} files (${duration}ms)!`);
  return { success: true, errors: [], count: allFiles.length, duration };
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runLint();
  process.exit(res.success ? 0 : 1);
}
