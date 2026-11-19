#!/usr/bin/env node
/**
 * lint-sealed-key-value — the KEY-VALUE writes of the shells, the sibling of lint-sealed-at-rest (ledger L1081).
 *
 * lint-sealed-at-rest holds every local STORE a shell builds to its seal. It does not see the smaller key-value writes
 * (`localStorage.setItem`, `AsyncStorage.setItem`, the `{getItem, setItem}` IOs the small stores take), and one of them
 * carried a person's content in plain text: the page blocks cache (appointment titles, task texts, the last chat line),
 * found 2026-11-19 and now sealed through `sealedKeyValue` (apps/basis/src/v2/localStoreSeal.js).
 *
 * The rule: a raw `.setItem(` in a shell file or in the shared v2 code is counted per file against a BASELINE
 * (scripts/sealed-key-value-baseline.json). Each baselined file carries a note that starts with one of:
 *   • "sealed by its caller:"  — the storage it is handed is `sealedKeyValue(...)` (named where);
 *   • "not content:"           — a device setting, a flag, a seen-time, the last tab (said why);
 *   • "debt:"                  — a person's content (or a secret) written plain today: a FINDING, to be ruled on and sealed.
 * A file above its count, or a new file, is red: a new write is either sealed (`sealedKeyValue`, whose own writes are not
 * counted) or declared here with its reason. A note without one of the three heads is red too. `--update` is not offered:
 * the baseline is edited by hand, so every line in it is a decision someone wrote down.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/basis/web', 'apps/basis/src', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
const THE_WRAPPER = 'apps/basis/src/v2/localStoreSeal.js';
const BASELINE = path.join(ROOT, 'scripts/sealed-key-value-baseline.json');
const RAW = /\.setItem\s*(\?\.)?\s*\(/;   // also the optional call `setItem?.(`
const VIA_SEAL = /\b(kv|sealed)\.setItem\b/;
const HEADS = ['sealed by its caller:', 'not content:', 'debt:'];

/** The shipped files under the roots (no tests). */
export function shellFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    let st; try { st = statSync(path.join(root, rel)); } catch { return; }
    if (st.isFile()) { if (/\.(m?js|jsx)$/.test(rel) && !/\.test\.|\.spec\./.test(rel)) out.push(rel); return; }
    for (const n of readdirSync(path.join(root, rel))) {
      if (n === 'node_modules' || n.startsWith('.') || n === 'test' || n === 'dist') continue;
      walk(`${rel}/${n}`);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

/** Raw key-value writes per file: `{ file: count }`. */
export function rawWrites(files, read = (f) => readFileSync(path.join(ROOT, f), 'utf8')) {
  const out = {};
  for (const f of files) {
    if (f === THE_WRAPPER) continue;
    let text = '';
    try { text = read(f); } catch { continue; }
    let n = 0;
    for (const line of text.split('\n')) if (RAW.test(line) && !VIA_SEAL.test(line) && !/^\s*(\*|\/\/)/.test(line)) n += 1;
    if (n) out[f] = n;
  }
  return out;
}

/** What is wrong against the baseline: grown files, new files, notes without a head. */
export function problemsAgainst(now, baseline) {
  const out = [];
  for (const [file, n] of Object.entries(now)) {
    const b = baseline[file];
    if (!b) out.push(`${file}: ${n} raw write(s), not in the baseline — seal it (sealedKeyValue) or declare it with a reason`);
    else if (n > b.count) out.push(`${file}: ${n} raw write(s), baseline ${b.count}`);
  }
  for (const [file, b] of Object.entries(baseline)) {
    if (!HEADS.some((h) => String(b?.note ?? '').startsWith(h))) out.push(`${file}: its note must start with one of: ${HEADS.join(' | ')}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const now = rawWrites(shellFiles());
  let baseline = {};
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { baseline = {}; }
  const problems = problemsAgainst(now, baseline);
  if (problems.length) {
    console.error('✖ sealed-key-value: a shell writes a key-value pair outside the seal, undeclared:');
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  const debt = Object.values(baseline).filter((b) => String(b.note).startsWith('debt:')).length;
  console.log(`✓ sealed-key-value: ${Object.values(now).reduce((s, n) => s + n, 0)} raw write(s) in ${Object.keys(now).length} file(s), all declared; ${debt} file(s) of debt`);
}
