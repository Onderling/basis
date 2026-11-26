#!/usr/bin/env node
/**
 * lint-one-signing — every Ed25519 signature this code MAKES, and every key pair it derives from a seed, goes through
 * ONE port: `ed25519Sign` / `ed25519KeyPairFromSeed` (packages/core/src/crypto/ed25519Sign.js). The sibling of
 * lint-one-signature-check (which holds the CHECK to one function).
 *
 * Why (ledger L619): a shell installs a faster implementation behind that port (libsodium on the phone, node:crypto on
 * the box), vetted by exact bytes. A direct `nacl.sign.detached(…)` or `nacl.sign.keyPair.fromSeed(…)` elsewhere signs
 * in pure JS again, ~30-100 ms a call on a phone, and nothing says so: the start just gets slower. The one other place
 * the library's calls may appear is the module of implementations the shells install
 * (`apps/basis/src/v2/signatureEquations.js`), which is reachable only through the port.
 *
 * Today's other sites are a BASELINE (scripts/one-signing-baseline.json, a count per file) that may only shrink: a file
 * above its count, or a new file, is red. `--update` rewrites the baseline only when no file grew.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippedSources } from './lint-one-signature-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THE_PORT = 'packages/core/src/crypto/ed25519Sign.js';
const IMPLEMENTATIONS = 'apps/basis/src/v2/signatureEquations.js';
const BASELINE = path.join(ROOT, 'scripts/one-signing-baseline.json');
// a signature made (not `.detached.verify`) or a key pair derived from a seed, by the library itself
const DIRECT = /\bsign\.detached\s*\(|\bsign\.keyPair\.fromSeed\s*\(/;

/** Direct signing / derivation sites per file, as 1-based line numbers: `{ file: [line, …] }`. */
export function directSigningLines(files, read = (f) => readFileSync(path.join(ROOT, f), 'utf8')) {
  const out = {};
  for (const f of files) {
    if (f === THE_PORT || f === IMPLEMENTATIONS) continue;
    let text = '';
    try { text = read(f); } catch { continue; }
    const lines = [];
    text.split('\n').forEach((line, i) => { if (DIRECT.test(line) && !/^\s*(\*|\/\/)/.test(line)) lines.push(i + 1); });
    if (lines.length) out[f] = lines;
  }
  return out;
}

/** Direct signing / derivation sites per file: `{ file: count }`. */
export function directSigning(files, read) {
  return Object.fromEntries(Object.entries(directSigningLines(files, read)).map(([f, ls]) => [f, ls.length]));
}

/** The red message for files that grew: what is wrong, each site as file:line, and what to do instead. */
export function redMessage(grew, lines) {
  const out = ['✖ lint-one-signing: a signature is made, or a key pair derived, outside the port (ed25519Sign.js) — it signs in pure JS and the start gets slower:'];
  for (const g of grew) {
    out.push(`  ${g.file}: ${g.now} site(s), baseline ${g.was}`);
    for (const l of lines[g.file] ?? []) out.push(`    ${g.file}:${l}`);
  }
  out.push(`Fix: call ed25519Sign(message, secretKey) or ed25519KeyPairFromSeed(seed) from ${THE_PORT} instead of nacl.sign.detached / nacl.sign.keyPair.fromSeed.`);
  return out.join('\n');
}

/** What grew against the baseline: `[{file, now, was}]` (a new file has was = 0). */
export function grewAgainst(now, baseline) {
  return Object.entries(now).filter(([f, n]) => n > (baseline[f] ?? 0)).map(([file, n]) => ({ file, now: n, was: baseline[file] ?? 0 }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lines = directSigningLines(shippedSources());
  const now = Object.fromEntries(Object.entries(lines).map(([f, ls]) => [f, ls.length]));
  let baseline = {};
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { baseline = {}; }
  const grew = grewAgainst(now, baseline);
  if (grew.length) {
    console.error(redMessage(grew, lines));
    process.exit(1);
  }
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(now).sort()), null, 2)}\n`);
    console.log(`lint-one-signing: baseline rewritten (${Object.keys(now).length} files)`);
  }
  const owed = Object.values(now).reduce((s, n) => s + n, 0);
  console.log(`lint-one-signing: every signature and seed derivation goes through the port; ${owed} older site(s) baselined`);
}
