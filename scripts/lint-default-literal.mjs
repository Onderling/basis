#!/usr/bin/env node
/**
 * `'default'` MEANS THE GENERAL PERSONA — NEVER "THIS DEVICE". A device holds selves; its first held self is its
 * PRIMARY (`primaryId` in the agent), the self it speaks as. The general persona (`'default'`: the registry row,
 * "Jij"/"Algemeen" on screen) is one of those selves, and a device may not hold it at all. Reading `'default'` where
 * "this device" is meant is how a device without the general persona would quietly speak, sign or write as it — so the
 * literal is counted in the agent core, and the count may only fall. A new `'default'` must mean the general persona
 * (and then the baseline is raised in the same PR, saying so); "this device" is `primaryId`.
 *
 *   node scripts/lint-default-literal.mjs            # check
 *   node scripts/lint-default-literal.mjs --write    # record the current counts (only when they fell, or with a reason)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = 'apps/basis/src/core/agent';
const BASELINE = join(ROOT, 'scripts', 'default-literal-baseline.json');

/** The `'default'` / `"default"` string literals in one source text (comments included: a comment that says the
 *  device is 'default' is the same misreading, one step earlier). */
export function countDefaultLiterals(src) { return (String(src).match(/(['"])default\1/g) ?? []).length; }

export function currentCounts(root = ROOT) {
  const out = {};
  for (const f of readdirSync(join(root, SCOPE)).filter((n) => n.endsWith('.js')).sort()) {
    const n = countDefaultLiterals(readFileSync(join(root, SCOPE, f), 'utf8'));
    if (n) out[`${SCOPE}/${f}`] = n;
  }
  return out;
}

/** The files whose count rose above the baseline: `[{file, was, now}]`. */
export function grown(counts, baseline) {
  return Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0)).map(([file, now]) => ({ file, was: baseline[file] ?? 0, now }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = currentCounts();
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`recorded ${Object.keys(counts).length} files`);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const up = grown(counts, baseline);
  if (up.length) {
    console.error("✗ a new 'default' literal in the agent core — 'default' means the GENERAL PERSONA only; this device is the primary (primaryId):");
    for (const { file, was, now } of up) console.error(`   ${file}: ${was} → ${now}`);
    console.error('   If it does mean the general persona, raise the baseline in the same PR (node scripts/lint-default-literal.mjs --write) and say so.');
    process.exit(1);
  }
  console.log(`✓ 'default' literals in the agent core: none added (${Object.values(counts).reduce((a, b) => a + b, 0)} counted)`);
}
