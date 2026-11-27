#!/usr/bin/env node
/**
 * lint-one-secretbox — every secretbox (XSalsa20-Poly1305) seal and open this code makes goes through ONE port:
 * `secretboxSeal` / `secretboxOpen` (packages/core/src/crypto/secretbox.js). The sibling of lint-one-signing.
 *
 * Why (ledger L619): a shell installs a faster implementation behind that port (libsodium on the phone), vetted by exact
 * bytes. A direct `nacl.secretbox(…)` or `nacl.secretbox.open(…)` elsewhere seals in pure JS again — a phone start opened
 * ~2.5 MB of stored records that way, ~1.1 s — and nothing says so: the start just gets slower. The one other place the
 * library's calls may appear is the module of implementations the shells install (`apps/basis/src/v2/signatureEquations.js`).
 *
 * Today's other sites are a BASELINE (scripts/one-secretbox-baseline.json, a count per file) that may only shrink: a file
 * above its count, or a new file, is red. `--update` rewrites the baseline only when no file grew. The baseline holds only
 * `@onderling/vault`'s at-rest vault, which cannot reach the port (the kernel imports the vault, so the vault importing
 * the kernel would be a cycle); its values are a few small key entries per start.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippedSources } from './lint-one-signature-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THE_PORT = 'packages/core/src/crypto/secretbox.js';
const IMPLEMENTATIONS = 'apps/basis/src/v2/signatureEquations.js';
const BASELINE = path.join(ROOT, 'scripts/one-secretbox-baseline.json');
// a seal or open by the library itself, or the library's secretbox imported by name
const DIRECT = /\bnacl\.secretbox(\.open)?\s*\(|import\s*\{[^}]*\bsecretbox\b[^}]*\}\s*from\s*['"]tweetnacl['"]/;

/** Direct secretbox sites per file, as 1-based line numbers: `{ file: [line, …] }`. */
export function directSecretboxLines(files, read = (f) => readFileSync(path.join(ROOT, f), 'utf8')) {
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

/** Direct secretbox sites per file: `{ file: count }`. */
export function directSecretbox(files, read) {
  return Object.fromEntries(Object.entries(directSecretboxLines(files, read)).map(([f, ls]) => [f, ls.length]));
}

/** The red message for files that grew: what is wrong, each site as file:line, and what to do instead. */
export function redMessage(grew, lines) {
  const out = ['✖ lint-one-secretbox: a secretbox is sealed or opened outside the port (crypto/secretbox.js) — it runs in pure JS again:'];
  for (const g of grew) {
    out.push(`  ${g.file}: ${g.now} site(s), baseline ${g.was}`);
    for (const l of lines[g.file] ?? []) out.push(`    ${g.file}:${l}`);
  }
  out.push(`Fix: call secretboxSeal(msg, nonce, key) / secretboxOpen(box, nonce, key) from ${THE_PORT} instead of nacl.secretbox / nacl.secretbox.open.`);
  return out.join('\n');
}

/** What grew against the baseline: `[{file, now, was}]` (a new file has was = 0). */
export function grewAgainst(now, baseline) {
  return Object.entries(now).filter(([f, n]) => n > (baseline[f] ?? 0)).map(([file, n]) => ({ file, now: n, was: baseline[file] ?? 0 }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lines = directSecretboxLines(shippedSources());
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
    console.log(`lint-one-secretbox: baseline rewritten (${Object.keys(now).length} files)`);
  }
  const owed = Object.values(now).reduce((s, n) => s + n, 0);
  console.log(`lint-one-secretbox: every secretbox goes through the port; ${owed} older site(s) baselined`);
}
