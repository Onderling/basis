#!/usr/bin/env node
/**
 * lint-revocation-resolver — a revocation resolver is taken at CONSTRUCTION; nothing may replace one later.
 *
 * ── Why this guard exists ────────────────────────────────────────────────────────────────────────────
 * `PolicyEngine.setRevocationCheck(fn)` REPLACED the engine's revocation check instead of adding to it,
 * and six independent places called it — a task-grant manager, a bot registry, a role-grant manager, an
 * issuer-side token registry, a connection-grants lane, a caller-supplied list. Last writer won, so any
 * one of them silently disarmed all the others, and nothing failed when it did.
 *
 * That shipped. On 2026-08-19 an older call clobbered a newer one and unpairing a connection left it
 * working: the list holding that revocation was no longer the list the gate asked. The fix was not to
 * agree not to call the setter — it was to delete it, so the engine's revocation truth is fixed where it
 * is composed and the composer has to union its sources on purpose.
 *
 * A deleted method comes back the moment someone needs one again and reaches for the obvious shape. This
 * guard is what makes that fail instead of ship.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────────────────────
 * Two shapes, over every source file under `apps/`, `packages/` and `scripts/`:
 *
 *   A. NAME — an identifier shaped like "install a revocation resolver": a verb of installation
 *      (`set`/`install`/`enable`/`attach`/`register`/`replace`/`inject`/`wire`/`bind`/`hook`) followed by
 *      `Revocation…`, plus the explicit `set…IsRevoked` form. `isRevoked` (asking) and `setRevoked`
 *      (a source marking its OWN token) are deliberately NOT matched — those are sources and questions,
 *      not installations.
 *
 *      In PRODUCTION source any occurrence counts, calls included: a call site is where the damage was
 *      done and it is the more useful place to be told. In TEST files only a DEFINITION counts — a
 *      method body, or such a name given to an object property or a variable. Providing one in a test
 *      (a duck-typed engine stub is how the old shape kept its foothold) is a reintroduction; NAMING one
 *      to assert it no longer exists is the opposite of a reintroduction, and the test that proves the
 *      violation cannot run has to write the violation out to prove it.
 *
 *   B. SHAPE — an assignment to a resolver-holding member (`this.#isRevoked = …`, `engine.isRevoked = …`,
 *      `…revocationCheck = …`) anywhere OTHER than inside a constructor body. This is the check that
 *      catches a differently-named setter: whatever it is called, replacing the resolver after
 *      construction is the defect. Object-literal properties (`isRevoked: fn`) and parameter defaults
 *      (`isRevoked = null`) are not member assignments and are not matched.
 *
 * Comments and string literals are blanked before the scan, so prose describing the old defect (this file
 * included, and the tests + design notes that record it) does not trip the guard — only real code does.
 */
import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

const ROOTS = ['apps', 'packages', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '_archive', '.expo', '.next']);
const SOURCE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx)$/;
/** This guard and its self-test necessarily contain the shapes they forbid. */
const SELF = /^scripts\/lint-revocation-resolver(?:\.test)?\.mjs$/;

/** An identifier that INSTALLS a revocation resolver (rather than asking one, or marking a token). */
export const INSTALLER_NAME = /\b(?:set|install|enable|attach|register|replace|inject|wire|bind|hook)[A-Za-z0-9_$]*(?:Revocation[A-Za-z0-9_$]*|IsRevoked)\b/g;

/**
 * The same names, but only where one is DEFINED: a method body, an object property, or a variable.
 * Applied to test files, where merely naming a gone method is how absence is asserted.
 */
export const INSTALLER_DEFINITION = /\b(?:function\s+)?(?:set|install|enable|attach|register|replace|inject|wire|bind|hook)[A-Za-z0-9_$]*(?:Revocation[A-Za-z0-9_$]*|IsRevoked)\s*(?:\([^)]*\)\s*\{|[:=][^=])/g;

/** A test file — spec-by-location and spec-by-suffix, the two shapes this repo uses. */
export function isTestFile(file) {
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(file) || /\.test\.[mc]?[jt]sx?$/.test(file);
}

/** An assignment to the member that HOLDS a resolver — `this.#isRevoked = …`, `pe.isRevoked = …`. */
export const RESOLVER_ASSIGN = /[.#](isRevoked|revocationCheck|revocationResolver)\s*=(?![=>])/g;

/**
 * Blank out comments and string/template literals, preserving length so offsets stay valid.
 * Exported for the self-test: a scanner that cannot tell code from prose would either go blind or
 * fail on every doc comment that names the defect.
 * @param {string} src
 * @returns {string}
 */
export function blankNoise(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = src.length; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1 >= i + 1 ? j - 1 : i + 1);
      i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Byte ranges of every `constructor(…) { … }` body in `code` (already noise-blanked).
 * Exported for the self-test.
 * @param {string} code
 * @returns {Array<[number, number]>}
 */
export function constructorBodies(code) {
  const ranges = [];
  for (const m of code.matchAll(/(?:^|[\s;}])constructor\s*\(/g)) {
    let i = m.index + m[0].length;       // just past the '('
    let depth = 1;
    while (i < code.length && depth > 0) { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; i++; }
    while (i < code.length && code[i] !== '{' && code[i] !== ';') i++;
    if (code[i] !== '{') continue;
    const start = i;
    depth = 0;
    while (i < code.length) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

/**
 * The check, pure for the self-test.
 * @param {Array<{file: string, src: string}>} files
 * @returns {Array<{file: string, line: number, kind: 'name'|'assignment', text: string}>}
 */
export function auditRevocationResolver(files) {
  const violations = [];
  for (const { file, src } of files) {
    const code = blankNoise(src);
    const lineOf = (idx) => code.slice(0, idx).split('\n').length;
    const textOf = (idx) => src.split('\n')[lineOf(idx) - 1].trim();

    for (const m of code.matchAll(isTestFile(file) ? INSTALLER_DEFINITION : INSTALLER_NAME)) {
      violations.push({ file, line: lineOf(m.index), kind: 'name', text: textOf(m.index) });
    }
    const ctors = constructorBodies(code);
    for (const m of code.matchAll(RESOLVER_ASSIGN)) {
      if (ctors.some(([a, b]) => m.index > a && m.index < b)) continue;
      violations.push({ file, line: lineOf(m.index), kind: 'assignment', text: textOf(m.index) });
    }
  }
  return violations;
}

/** Every source file the guard scans, as `{file, src}` (file relative to the repo root). */
export function collectFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    let names; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (SKIP_DIRS.has(n)) continue;
      const full = path.join(dir, n);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!SOURCE_EXT.test(n)) continue;
      const rel = path.relative(root, full);
      if (SELF.test(rel)) continue;
      out.push({ file: rel, src: readFileSync(full, 'utf8') });
    }
  };
  for (const d of ROOTS) walk(path.join(root, d));
  return out;
}

// ── run (skipped when imported by the self-test) ─────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const files = collectFiles();
  const violations = auditRevocationResolver(files);

  if (violations.length) {
    console.error(`\n✗ lint:revocation-resolver — ${violations.length} way(s) to REPLACE a revocation resolver:\n`);
    for (const v of violations) {
      console.error(`   ${v.file}:${v.line}  [${v.kind}]`);
      console.error(`      ${v.text}`);
    }
    console.error('\n   A PolicyEngine takes ONE revocation resolver, at construction. A settable one is');
    console.error('   last-writer-wins: on 2026-08-19 that silently disarmed connection revocation and');
    console.error('   unpairing left the connection working.');
    console.error('\n   Several sources of revocation truth? Union them where the engine is BUILT:');
    console.error('     new PolicyEngine({ …, isRevoked: anyRevoked([(id) => a.isRevoked(id), (id) => b.isRevoked(id)]) })');
    console.error('   A source built later is reached with a thunk, not by pushing it in afterwards.\n');
    process.exit(1);
  }

  console.log(`✓ lint:revocation-resolver: ${files.length} source file(s), no way to replace a revocation resolver after construction.`);
}
