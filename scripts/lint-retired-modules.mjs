#!/usr/bin/env node
/**
 * lint-retired-modules — a RETIRED module must stay dead (the legacy-deletion-after-cutover discipline).
 *
 * Each convergence cutover retires its legacy half in the same arc — and this guard keeps it retired: any
 * NEW reference to a retired module's name, export, or storage key in tracked source is a hard failure.
 * Without it, a half-remembered import or a copy-pasted snippet quietly resurrects the store the cutover
 * killed, and the duplication ("two of everything") starts regrowing.
 *
 * Retired 2026-08-10 (the governance cutover — settings consensus rides governance/changePolicy on the log):
 *   circleProposalStore (localStorage side-store) · circleConsensus (the unsigned unanimity model) ·
 *   makeProposalStoreRN · the `cc.circleProposals` storage key.
 *
 * Comments mentioning the history are fine — the scan targets code-shaped references (import/export/call
 * sites), not prose. Add a row when a cutover retires its next legacy half.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Code-shaped patterns only (import paths, identifiers in call/import position, the storage key).
const RETIRED = [
  { name: 'circleProposalStore',  re: /from\s+['"][^'"]*circleProposalStore(?:\.js)?['"]|createProposalStore\s*\(|localStorageProposalIo\s*\(/ },
  { name: 'circleConsensus',      re: /from\s+['"][^'"]*circleConsensus(?:\.js)?['"]|(?<![\w.])makeProposal\s*\(|approveProposal\s*\(|pendingApprovers\s*\(/ },
  { name: 'makeProposalStoreRN',  re: /makeProposalStoreRN\s*\(/ },
  { name: 'cc.circleProposals',   re: /['"]cc\.circleProposals['"]/ },
];

const isTest = (f) => /(^|\/)(test|tests|e2e|test-browser|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isSource = (f) => /\.[cm]?[jt]sx?$/.test(f) && !f.includes('/node_modules/') && !/(^|\/)vendor\//.test(f)
  && !f.startsWith('scripts/lint-retired-modules');   // not this guard's own table

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const hits = [];
for (const f of sh('git ls-files').split('\n').filter(Boolean).filter(isSource)) {
  let src;
  try { src = stripComments(readFileSync(path.join(ROOT, f), 'utf8')); } catch { continue; }
  for (const r of RETIRED) {
    if (r.re.test(src)) hits.push(`${f}  →  ${r.name}${isTest(f) ? '  (test)' : ''}`);
  }
}

if (hits.length) {
  console.error(`\n✗ lint:retired-modules — ${hits.length} reference(s) to RETIRED modules:\n`);
  for (const h of hits) console.error(`   - ${h}`);
  console.error(`
These were retired by a convergence cutover (their replacement is on the log/rail). Re-introducing them
regrows the duplication the cutover removed. Use the replacement (governance changePolicy proposals via
bindCircleGovernance / openPolicyProposals), or — if a retirement was genuinely premature — remove its row
here WITH the reasoning in review.
`);
  process.exit(1);
}
console.log('✓ lint:retired-modules: no references to retired modules.');
