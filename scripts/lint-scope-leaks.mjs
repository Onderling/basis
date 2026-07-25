#!/usr/bin/env node
// Fitness guard: no CROSS-SCOPE REFERENCE LEAKS in the RN shell screens.
//
// The drift this fences: a big component (e.g. `CircleDetail`) is a SEPARATE
// top-level function, a *sibling* of the screen it lives beside (not nested in
// it). When chat/command logic is moved into such a sibling, references to the
// parent screen's scope (`bundle`, `onCircleControl`, `circleTransport`,
// `setView`, …) compile fine but throw `ReferenceError: Property 'x' doesn't
// exist` the moment the component renders on device — a class of crash that
// unit tests + a stale dev-client both missed (see docs/agent-notes-known-gotchas.md).
//
// Mechanism: parse each scoped file, and for every *referenced* identifier
// (Babel's ReferencedIdentifier already excludes member `.x`, object keys, JSX
// attribute names, and declarations), fail if it resolves to NO binding in its
// scope chain (module scope + the enclosing function) and is not a known
// runtime global. That is `no-undef`, scoped to the shell screens — the exact
// signal a leaked parent-scope reference produces.
//
// Usage:
//   node scripts/lint-scope-leaks.mjs           # lint (exit 1 on any leak)
//   node scripts/lint-scope-leaks.mjs --json     # machine-readable
//   node scripts/lint-scope-leaks.mjs --list     # group by identifier

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv.includes('--json') ? 'json'
  : process.argv.includes('--list') ? 'list' : 'lint';

// Scanned roots. The RN shell is where sibling components (CircleDetail-style)
// live, so the whole shell src is in scope — a new screen is covered the day it
// lands, not when someone remembers to list it. `.js` only; tests excluded.
const SCOPED_ROOTS = ['apps/basis-mobile/src'];

function walkJs(absDir, out = []) {
  for (const ent of readdirSync(absDir, { withFileTypes: true })) {
    if (ent.name === 'node_modules') continue;
    const abs = join(absDir, ent.name);
    if (ent.isDirectory()) walkJs(abs, out);
    else if (ent.name.endsWith('.js') && !/\.(test|spec)\.js$/.test(ent.name)) out.push(abs);
  }
  return out;
}

/** Repo-relative list of files the guard scans. */
export function scopedFiles() {
  const files = [];
  for (const root of SCOPED_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (existsSync(abs)) for (const f of walkJs(abs)) files.push(relative(REPO_ROOT, f));
  }
  return files.sort();
}

// Runtime globals available to the RN JS bundle (Hermes + React Native + the
// standard web-ish surface RN polyfills). A referenced identifier resolving to
// one of these is NOT a leak. Keep this list tight — it is the allowlist that
// keeps the guard's false-positive rate at zero on the clean tree.
export const RUNTIME_GLOBALS = new Set([
  // language / ES builtins
  'undefined', 'null', 'NaN', 'Infinity', 'globalThis', 'arguments',
  'Object', 'Array', 'Function', 'Boolean', 'Number', 'String', 'Symbol',
  'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
  // module system
  'require', 'module', 'exports', 'import', '__dirname', '__filename',
  // host / RN / web-ish surface RN provides
  'global', 'globalThis', '__DEV__', 'console', 'process', 'Buffer',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader',
  'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator', 'location',
  'TextEncoder', 'TextDecoder', 'btoa', 'atob', 'crypto',
  'performance', 'Event', 'CustomEvent', 'ErrorUtils', 'HermesInternal',
  'React',
]);

/** Parse one file → its Babel AST (JSX + modern syntax). */
function astOf(src) {
  return parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport'],
  });
}

/**
 * Find cross-scope reference leaks in one file's source.
 * @returns {Array<{name:string, line:number}>}
 */
export function findScopeLeaks(src) {
  const ast = astOf(src);
  const leaks = [];
  const seen = new Set();
  traverse(ast, {
    ReferencedIdentifier(path) {
      const { name } = path.node;
      if (RUNTIME_GLOBALS.has(name)) return;
      // Resolves to a binding somewhere in the scope chain (module, enclosing
      // function, block, …)? Then it is legitimately in scope — not a leak.
      if (path.scope.getBinding(name)) return;
      // Flow/TS type-position identifiers never reach here from plain JS.
      const line = path.node.loc?.start.line ?? 0;
      const key = `${name}:${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      leaks.push({ name, line });
    },
  });
  return leaks;
}

function main() {
  const hits = [];
  for (const rel of scopedFiles()) {
    const abs = join(REPO_ROOT, rel);
    const src = readFileSync(abs, 'utf8');
    let leaks;
    try { leaks = findScopeLeaks(src); }
    catch (e) { console.error(`✗ parse error in ${rel}: ${String(e.message).split('\n')[0]}`); process.exit(2); }
    for (const leak of leaks) hits.push({ file: rel, ...leak });
  }

  if (MODE === 'json') { process.stdout.write(JSON.stringify(hits, null, 2) + '\n'); process.exit(hits.length ? 1 : 0); }
  if (MODE === 'list') {
    const byName = new Map();
    for (const h of hits) { if (!byName.has(h.name)) byName.set(h.name, []); byName.get(h.name).push(`${h.file}:${h.line}`); }
    for (const [name, where] of byName) console.log(`${name}\n  ${where.join('\n  ')}`);
    process.exit(hits.length ? 1 : 0);
  }
  if (!hits.length) { console.log('✓ no cross-scope reference leaks in the scoped RN shells'); process.exit(0); }
  console.error('✗ cross-scope reference leak(s) — a sibling component references a name not in its scope\n');
  for (const h of hits) console.error(`  ${h.file}:${h.line}  '${h.name}' is not defined in this component's scope (parent-scope leak → on-device ReferenceError)`);
  console.error(`\n${hits.length} leak(s). Thread the value in as a PROP, or move the declaration into the component.`);
  process.exit(1);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
