#!/usr/bin/env node
/**
 * lint-one-signature-check — every Ed25519 signature check in shipped code goes through ONE function,
 * `verifyEd25519Strict` (packages/core/src/crypto/ed25519Strict.js), which applies the strict byte rule before the
 * library's equation.
 *
 * Why: libraries disagree on crafted signatures (the 12 published edge-case vectors: tweetnacl accepted seven,
 * node:crypto and WebCrypto five, libsodium one). A check that called a library directly would accept what every
 * other device refuses, and a member could split a circle's roster with a statement only some devices take. So a
 * direct `nacl.sign.detached.verify(…)`, `sign.open(…)` or a libsodium `crypto_sign_verify_detached` anywhere in
 * shipped code outside that one module is red. Tests are not shipped code and may call a library to compare.
 *
 * The one other place a library's check may appear is the module of FASTER EQUATIONS the shells install
 * (`apps/basis/src/v2/signatureEquations.js`: node:crypto, WebCrypto, libsodium): an equation there is only reachable
 * through `useSignatureEquation`, which vets it against the vectors and keeps it behind the byte rule. node:crypto's
 * `crypto.verify(null, …)` and WebCrypto's `subtle.verify({ name: 'Ed25519' }, …)` are caught too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THE_ONE = 'packages/core/src/crypto/ed25519Strict.js';
/** The equations a shell installs behind the rule (vetted by `useSignatureEquation`, reachable only through it). */
const EQUATIONS = 'apps/basis/src/v2/signatureEquations.js';
const DIRECT = /\bsign\.detached\.verify\s*\(|\bsign\.open\s*\(|\bcrypto_sign_verify_detached\s*\(|\.verify\(\s*null\s*,|\bsubtle\.verify\(|name:\s*'Ed25519'\s*\}\s*,\s*\w+\s*,\s*\w+\s*,/;
const SKIP_DIR = new Set(['node_modules', 'test', 'tests', 'e2e', 'test-browser', 'dist', 'build', '.expo', 'android', 'ios', 'coverage']);

/** Shipped source files under the given roots (relative paths). */
export function shippedSources(root = ROOT, roots = ['packages', 'apps']) {
  const out = [];
  const walk = (rel) => {
    let names = [];
    try { names = readdirSync(path.join(root, rel)); } catch { return; }
    for (const n of names) {
      const r = path.join(rel, n);
      let st; try { st = statSync(path.join(root, r)); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIR.has(n) && !n.startsWith('.')) walk(r); continue; }
      if (/\.(m?js|cjs|jsx)$/.test(n) && !/\.test\.|\.spec\./.test(n)) out.push(r.split(path.sep).join('/'));
    }
  };
  for (const r of roots) walk(r);
  return out;
}

/** The files that verify a signature directly, as `file:line`. */
export function directChecks(files, read = (f) => readFileSync(path.join(ROOT, f), 'utf8')) {
  const hits = [];
  for (const f of files) {
    if (f === THE_ONE || f === EQUATIONS) continue;
    let text = '';
    try { text = read(f); } catch { continue; }
    text.split('\n').forEach((line, i) => { if (DIRECT.test(line) && !/^\s*(\*|\/\/)/.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const hits = directChecks(shippedSources());
  if (hits.length) {
    console.error('lint-one-signature-check: a signature is checked outside verifyEd25519Strict (the strict rule):');
    for (const h of hits) console.error(`  • ${h}`);
    process.exit(1);
  }
  console.log('lint-one-signature-check: every Ed25519 check goes through verifyEd25519Strict');
}
