#!/usr/bin/env node
/**
 * lint-disclosure-exit (G-A1) — the Agent membrane's disclosure gate is the ONLY exit for identity
 * attributes. A renderer that reads `member.realName` directly bypasses the reveal ladder — which is
 * exactly how the governance labeler came to return real names unconditionally (the recorded leak-shape),
 * and how chat showed raw keys for a month while the ladder sat one import away.
 *
 * Rule: no `.realName` read outside the disclosure modules (the ladder + the card projections that
 * implement it), the roster/registry code that WRITES the attribute, and tests. Baseline carries the
 * known debt (the governance labeler, until the sender-label work retires it).
 *
 *   node scripts/lint-disclosure-exit.mjs            check (fails on NEW reads)
 *   node scripts/lint-disclosure-exit.mjs --update   rewrite the baseline
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, 'scripts', 'disclosure-exit-baseline.json');

/** The gate itself + writers of the attribute — the legitimate touchers. */
const ALLOWED = [
  /^apps\/basis\/src\/v2\/circleViewAs\.js$/,          // the ladder (revealedMemberLabel)
  /^apps\/basis\/src\/v2\/memberCards\.js$/,           // the card projections implementing it
  /^packages\/agent-registry\/src\//,                  // the registry owns the attribute
  /^apps\/stoop\/src\/lib\/deriveRoster\.js$/,         // writes the roster row
  /(^|\/)(test|tests|e2e|test-browser)\//, /\.(test|spec)\.[cm]?js$/,   // tests may construct fixtures
];

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
  .filter((f) => /^(apps|packages)\/.*\.[cm]?js$/.test(f) && !f.includes('/node_modules/'));

const hits = [];
for (const f of files) {
  if (ALLOWED.some((re) => re.test(f))) continue;
  let src; try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    if (/\.realName\b/.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${f}:${i + 1}`);
  });
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ sites: hits.sort() }, null, 2) + '\n');
  console.log(`✓ baseline updated: ${hits.length} known site(s)`); process.exit(0);
}
let known = new Set();
try { known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).sites ?? []); } catch { /* none */ }
const fresh = hits.filter((h) => !known.has(h));
if (fresh.length) {
  console.error(`✗ lint:disclosure-exit — ${fresh.length} NEW raw identity-attribute read(s):`);
  for (const h of fresh) console.error('   - ' + h);
  console.error('\nRead identity through the ladder (`revealedMemberLabel`), never off the row — the reveal\nladder is the ONLY exit (the homes plan, G-A1).');
  process.exit(1);
}
if (hits.length) console.warn(`⚠ lint:disclosure-exit — ${hits.length} known site(s) carried. Triage DOWN.`);
console.log('✓ lint:disclosure-exit: no new raw reads.');
