import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

/**
 * Static AST Linkage Checker for Readover ES Modules
 *
 * Mathematically verifies that:
 * 1. Every imported file exists on disk.
 * 2. Every named import (`import { x } from './foo.js'`) exists as an export in the target module.
 * 3. Every default import (`import x from './foo.js'`) exists as an `export default` in the target module.
 * 4. Star re-exports (`export * from './foo.js'`) and named re-exports (`export { a as b } from './foo.js'`)
 *    are recursively resolved.
 * 5. String-literal dynamic `import('./foo.js')` targets exist on disk.
 */

const cache = new Map();

function extractIdentifiers(node) {
  const ids = [];
  if (!node) return ids;
  if (node.type === 'Identifier') {
    ids.push(node.name);
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') ids.push(...extractIdentifiers(prop.value));
      else if (prop.type === 'RestElement') ids.push(...extractIdentifiers(prop.argument));
    }
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements) {
      if (el) ids.push(...extractIdentifiers(el));
    }
  } else if (node.type === 'AssignmentPattern') {
    ids.push(...extractIdentifiers(node.left));
  } else if (node.type === 'RestElement') {
    ids.push(...extractIdentifiers(node.argument));
  }
  return ids;
}

export function parseModuleExportsAndImports(filePath) {
  const norm = path.resolve(filePath);
  if (cache.has(norm)) return cache.get(norm);
  if (!fs.existsSync(norm)) return null;

  const code = fs.readFileSync(norm, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest', locations: true });
  } catch (e) {
    throw new Error(`Failed to parse AST in ${filePath}: ${e.message}`);
  }

  const exports = new Set();
  const reexports = [];
  const imports = [];
  const dynamicImports = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportExpression') {
      if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
        dynamicImports.push({
          source: node.source.value,
          loc: node.loc,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }
  walk(ast);

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration' || node.declaration.type === 'ClassDeclaration') {
          if (node.declaration.id) exports.add(node.declaration.id.name);
        } else if (node.declaration.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            for (const id of extractIdentifiers(decl.id)) exports.add(id);
          }
        }
      }
      if (node.specifiers) {
        if (node.source) {
          reexports.push({
            source: node.source.value,
            specifiers: node.specifiers.map((s) => ({
              local: s.local.name || s.local.value,
              exported: s.exported.name || s.exported.value,
            })),
          });
        } else {
          for (const s of node.specifiers) {
            exports.add(s.exported.name || s.exported.value);
          }
        }
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      exports.add('default');
    } else if (node.type === 'ExportAllDeclaration') {
      if (node.exported) {
        exports.add(node.exported.name || node.exported.value);
      } else {
        reexports.push({ source: node.source.value, all: true });
      }
    } else if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          imports.push({
            source: node.source.value,
            importedName: spec.imported.name || spec.imported.value,
            localName: spec.local.name,
            loc: spec.loc,
            isNamespace: false,
            isDefault: false,
          });
        } else if (spec.type === 'ImportDefaultSpecifier') {
          imports.push({
            source: node.source.value,
            importedName: 'default',
            localName: spec.local.name,
            loc: spec.loc,
            isNamespace: false,
            isDefault: true,
          });
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          imports.push({
            source: node.source.value,
            importedName: '*',
            localName: spec.local.name,
            loc: spec.loc,
            isNamespace: true,
            isDefault: false,
          });
        }
      }
    }
  }

  const data = { exports, reexports, imports, dynamicImports };
  cache.set(norm, data);
  return data;
}

export function getAllExports(filePath, visited = new Set()) {
  const norm = path.resolve(filePath);
  if (visited.has(norm)) return new Set();
  visited.add(norm);

  const info = parseModuleExportsAndImports(norm);
  if (!info) return new Set();

  const all = new Set(info.exports);
  for (const re of info.reexports) {
    const targetPath = path.resolve(path.dirname(norm), re.source);
    const targetExports = getAllExports(targetPath, visited);
    if (re.all) {
      for (const exp of targetExports) all.add(exp);
    } else if (re.specifiers) {
      for (const s of re.specifiers) {
        if (targetExports.has(s.local) || s.local === '*') {
          all.add(s.exported);
        }
      }
    }
  }
  return all;
}

export function collectFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.resolve(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(collectFiles(full));
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      results.push(full);
    }
  }
  return results;
}

export function verifyAstLinkage(options = {}) {
  const dirs = options.directories || ['src'];
  const extraFiles = options.files || [];
  let filesToCheck = [];

  for (const dir of dirs) {
    filesToCheck = filesToCheck.concat(collectFiles(dir));
  }
  for (const f of extraFiles) {
    const full = path.resolve(f);
    if (fs.existsSync(full) && !filesToCheck.includes(full)) {
      filesToCheck.push(full);
    }
  }

  const errors = [];
  let totalImportsChecked = 0;
  let totalDynamicImportsChecked = 0;

  for (const file of filesToCheck) {
    let info;
    try {
      info = parseModuleExportsAndImports(file);
    } catch (err) {
      errors.push({ file, message: err.message });
      continue;
    }
    if (!info) continue;

    const relFile = path.relative(process.cwd(), file);

    // 1. Check static imports
    for (const imp of info.imports) {
      if (!imp.source.startsWith('.')) continue; // ignore external packages
      totalImportsChecked++;
      const targetPath = path.resolve(path.dirname(file), imp.source);
      if (!fs.existsSync(targetPath)) {
        errors.push({
          file: relFile,
          line: imp.loc?.start?.line,
          col: imp.loc?.start?.column,
          type: 'MISSING_FILE',
          message: `Cannot resolve import '${imp.source}' from ${relFile}: target file does not exist on disk.`,
        });
        continue;
      }
      if (imp.isNamespace) continue; // import * is valid if target file exists

      const availableExports = getAllExports(targetPath);
      if (!availableExports.has(imp.importedName)) {
        errors.push({
          file: relFile,
          line: imp.loc?.start?.line,
          col: imp.loc?.start?.column,
          type: 'MISSING_EXPORT',
          message: `Module '${imp.source}' does not provide an export named '${imp.importedName}' (imported in ${relFile}:${imp.loc?.start?.line}).`,
          available: Array.from(availableExports).sort(),
        });
      }
    }

    // 2. Check dynamic literal imports
    for (const dyn of info.dynamicImports) {
      if (!dyn.source.startsWith('.')) continue;
      totalDynamicImportsChecked++;
      const targetPath = path.resolve(path.dirname(file), dyn.source);
      if (!fs.existsSync(targetPath)) {
        errors.push({
          file: relFile,
          line: dyn.loc?.start?.line,
          col: dyn.loc?.start?.column,
          type: 'MISSING_DYNAMIC_FILE',
          message: `Cannot resolve dynamic import('${dyn.source}') in ${relFile}:${dyn.loc?.start?.line}: target file does not exist.`,
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    filesChecked: filesToCheck.length,
    totalImportsChecked,
    totalDynamicImportsChecked,
  };
}

// Standalone CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Running Readover Static AST Module Linkage Checker...');
  const result = verifyAstLinkage({ directories: ['src'], files: ['sw.js'] });

  console.log(`📁 Analyzed ${result.filesChecked} JavaScript modules.`);
  console.log(`🔗 Verified ${result.totalImportsChecked} static imports and ${result.totalDynamicImportsChecked} dynamic imports.`);

  if (result.success) {
    console.log('✅ AST Linkage Check PASSED: 100% of named and default exports exist in target modules!');
    process.exit(0);
  } else {
    console.error(`\n❌ Found ${result.errors.length} linkage error(s):`);
    for (const err of result.errors) {
      console.error(`  - [${err.file}:${err.line || 1}] ${err.message}`);
      if (err.available && err.available.length > 0) {
        console.error(`    Available exports in target: ${err.available.slice(0, 10).join(', ')}${err.available.length > 10 ? ' ...' : ''}`);
      }
    }
    process.exit(1);
  }
}
