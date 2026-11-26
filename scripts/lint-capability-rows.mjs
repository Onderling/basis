#!/usr/bin/env node
/**
 * lint-capability-rows — every op is gated by a capability row (ledger L1040 / L1042).
 *
 * The capability gate keys a dispatch on the op's (atom × noun): `opNouns` with the manifest's declared nouns, the
 * same reading `capabilitiesOf` and `checkCapability` use. An op with a canonical verb (an atom) that names a noun
 * whose (noun × atom) is NO row of its manifest's capability set is REFUSED by the gate in every circle, even with
 * everything switched on (the default-deny trap: a manifest that declares its nouns and left that pair out). Found
 * 2026-11-18: the lend ops (fixed in L1040), and nine more (a task's snapshot, confirming a claim, editing and sharing
 * an appointment, a persona's reads).
 *
 * Red for such an op unless it is in the baseline (`capability-rows-baseline.json`), which only shrinks: a follow-up
 * that binds an op takes it out (`--update` drops what is fixed; it never adds). A NEW op with no row is red.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allManifests } from '../apps/basis/src/v2/manifestSources.js';
import { capabilitiesOf, opNouns, declaredNounsOf } from '../packages/app-manifest/src/index.js';
import { canonicalAtom } from '../packages/app-manifest/src/atoms.js';
import { manifestFileByApp } from './guard-where.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'capability-rows-baseline.json');

/**
 * The ops (`app.opId`) with an atom that names no capability row of their manifest.
 * @param {object[]} manifests
 * @returns {string[]}
 */
export function opsWithNoRow(manifests) {
  const out = [];
  for (const m of manifests ?? []) {
    if (!m?.app) continue;
    const rows = new Set(capabilitiesOf(m).map((c) => `${c.noun} ${c.atom}`));
    const itemTypes = Array.isArray(m.itemTypes) ? m.itemTypes : [];
    const declared = declaredNounsOf(m);
    for (const op of m.operations ?? []) {
      const atom = canonicalAtom(op?.verb);
      if (!atom || typeof op?.id !== 'string') continue;
      if (op?.appliesTo?.type === '*') continue;   // a wildcard op is authorised app-wide by design
      const nouns = opNouns(op, itemTypes, declared).filter((n) => n !== '*');
      // An atom op that names NO noun is authorised at app level by design (`checkCapability`); this guard is about an
      // op that names a noun whose row is missing, which the gate REFUSES by default (posting, which names no noun,
      // is its own row: L1046).
      if (nouns.length && !nouns.some((n) => rows.has(`${n} ${atom}`))) out.push(`${m.app}.${op.id}`);
    }
  }
  return [...new Set(out)].sort();
}

const BASELINE_REL = 'scripts/capability-rows-baseline.json';

/**
 * Problems against the baseline: new ops with no row (red), and baseline entries that are fixed or gone (asks --update).
 * @param {string[]} found  @param {string[]} baseline
 * @param {Record<string, string>} [files]  each app's manifest file (repo-relative); `apps/<app>/manifest.js` when absent
 */
export function auditRows(found, baseline, files = {}) {
  const held = new Set(baseline);
  const now = new Set(found);
  const fileOf = (k) => { const app = k.slice(0, k.indexOf('.')); return files[app] ?? `apps/${app}/manifest.js`; };
  const problems = [];
  for (const k of found) if (!held.has(k)) problems.push(`${fileOf(k)}: ${k} has a verb whose atom and noun name no capability row.\n    Fix: bind it to a row (declare the noun × atom, or the kind), never leave a switch that switches nothing.`);
  for (const k of held) if (!now.has(k)) problems.push(`${BASELINE_REL}: the baseline holds ${k}, which now has its row (or is gone).\n    Fix: run node scripts/lint-capability-rows.mjs --update (it only removes entries).`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifests = allManifests();
  const found = opsWithNoRow(manifests);
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).noRow ?? [] : [];
  if (process.argv.includes('--update')) {
    const noRow = baseline.filter((k) => found.includes(k));
    writeFileSync(BASELINE, `${JSON.stringify({ noRow }, null, 2)}\n`);
    console.log(`lint-capability-rows: baseline ${baseline.length} → ${noRow.length} (it only shrinks)`);
    process.exit(0);
  }
  const problems = auditRows(found, baseline, await manifestFileByApp(manifests));
  if (problems.length) {
    console.error(`✖ lint-capability-rows: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`✓ lint-capability-rows: every op is gated by a row, but ${baseline.length} known (baseline, shrinking)`);
}
