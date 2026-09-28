#!/usr/bin/env node
/**
 * lint-unbound-names — a Node entry point uses no name that nothing defines.
 *
 * The box shell (`apps/basis/bin/device-runner.mjs`) called `shareDisclosureToCircle` without importing it. Nothing
 * failed: the call sat in a callback that runs only when a contact carries a persona, and the pair roster catches the
 * error and logs to a logger the box never passes. A ReferenceError waiting for the first contact with a persona,
 * found by reading (2026-09-28). The web and mobile shells run through a bundler that would have refused it; the
 * Node entry points run as-is, so nothing did.
 *
 * Scope analysis (Babel's): every identifier a file REFERENCES that no import, declaration or parameter BINDS, minus
 * the names Node itself defines. Red on any. Checks every `apps/<app>/bin/*` and `packages/<pkg>/bin/*` entry point.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/** Names Node defines without an import (the runtime's globals, and the CommonJS wrapper's). */
const NODE_GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  'require', 'module', 'exports', '__filename', '__dirname',
]);

/**
 * The names `source` references that nothing binds.
 * @param {string} source  an ES module's text
 * @returns {string[]}
 */
export function unboundNames(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['topLevelAwait'] });
  let globals = [];
  traverse(ast, { Program(p) { globals = Object.keys(p.scope.globals); } });
  return globals.filter((g) => !NODE_GLOBALS.has(g)).sort();
}

/** Every Node entry point: `apps/<app>/bin/*` and `packages/<pkg>/bin/*` (.mjs / .js). */
export function entryPoints(root = ROOT) {
  const out = [];
  for (const top of ['apps', 'packages']) {
    const base = path.join(root, top);
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      const bin = path.join(base, dir, 'bin');
      if (!existsSync(bin)) continue;
      for (const f of readdirSync(bin)) if (/\.(mjs|js)$/.test(f)) out.push(path.join(top, dir, 'bin', f));
    }
  }
  return out.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = entryPoints();
  const found = [];
  for (const rel of files) {
    let names = [];
    try { names = unboundNames(readFileSync(path.join(ROOT, rel), 'utf8')); }
    catch (err) { found.push({ rel, names: [`(did not parse: ${err.message})`] }); continue; }
    if (names.length) found.push({ rel, names });
  }
  if (found.length) {
    console.error(`\n✖ lint-unbound-names: ${found.length} entry point(s) use a name nothing defines — a ReferenceError waiting for the line to run:`);
    for (const f of found) console.error(`  ${f.rel}: ${f.names.join(', ')}`);
    console.error('\nFix: import it (or define it). A Node entry point is not bundled, so nothing else will refuse it.\n');
    process.exit(1);
  }
  console.log(`✓ lint-unbound-names: ${files.length} Node entry points, every name bound.`);
}
