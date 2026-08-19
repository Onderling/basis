#!/usr/bin/env node
/**
 * lint-unconstructed-classes — an exported class that nothing ever `new`s is a liability, not an asset.
 *
 * `lint-unreached-exports` asks whether a symbol is REACHED — exported and referenced somewhere. That check
 * passes for a class named in a barrel, a JSDoc type, or an import that only feeds `instanceof`. It says
 * nothing about whether the class ever RUNS.
 *
 * The gap is not theoretical. On 2026-08-19 a sweep found six complete, tested, exported core classes that
 * no code outside tests ever constructs — including `A2AAuth` (JWT validation + trust-tier assignment for
 * inbound A2A) and `KeyRotation` (proof-of-rotation for identity keys). Both are security mechanisms. Both
 * have full test suites, which is exactly what makes them invisible: green tests read as working software.
 * The same session found `RoleGrantManager` in the same state after I had described it as live.
 *
 * So this guard asks the narrower, harder question: **is it ever instantiated?**
 *
 * Scope + honest limits:
 *   • Classes only. A never-called exported FUNCTION is the same disease, but functions are called through
 *     far more shapes (destructuring, re-export, injection) than `new X(`, so a function check would be
 *     mostly false positives. Classes have one construction syntax, which is why this is tractable.
 *   • Tests do not count as consumers. That is the entire point (CLAUDE.md: "a test that exercises the
 *     mechanism is not a consumer").
 *   • PORTS and ABSTRACT bases are legitimately unconstructed — they exist to be implemented or to type a
 *     seam. They are listed in EXPECTED below with the reason, and the guard fails if one stops existing,
 *     so the exemption list cannot quietly outlive its subject.
 *   • ADAPTERS a host constructs (a memory source, a local transport) are unconstructed in-repo by design;
 *     they are consumers' tools. Also in EXPECTED.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });

/** Packages whose exported classes are checked. Apps compose; substrates and the kernel are what rot. */
const SCANNED = ['packages/core/src'];

/**
 * Unconstructed ON PURPOSE, each with the reason it is not a finding. A row here is a claim about WHY a
 * class has no `new` — if the class disappears, the row must go too, which the staleness check enforces.
 */
const EXPECTED = new Map([
  ['DataSource',           'port — implemented by adapters, never instantiated directly'],
  ['StorageBackend',       'port — same'],
  ['Transport',            'port + base class for concrete transports'],
  ['CloudAdapter',         'declared @abstract in its own header'],
  ['Parts',                'static-only helper namespace; there is nothing to construct'],
  ['MemoryAdapter',        'adapter a consumer constructs, not this repo'],
  ['MemoryStorageBackend', 'adapter a consumer constructs'],
  ['IndexedDBSource',      'adapter a host constructs in a browser'],
  ['LocalTransport',       'adapter a consumer constructs'],
]);

const isTest = (f) => /(^|\/)(test|tests|e2e|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const files = sh('git ls-files').split('\n').filter(Boolean).filter((f) => /\.[cm]?[jt]sx?$/.test(f));

// Every exported class in the scanned trees, with where it is declared.
const declared = new Map();
for (const f of files.filter((f) => SCANNED.some((d) => f.startsWith(d)) && !isTest(f))) {
  for (const m of readFileSync(path.join(ROOT, f), 'utf8').matchAll(/^export class (\w+)/gm)) {
    declared.set(m[1], f);
  }
}

// Anything constructed anywhere that is not a test.
const constructed = new Set();
for (const f of files.filter((f) => !isTest(f))) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  for (const name of declared.keys()) {
    if (!constructed.has(name) && new RegExp(`\\bnew ${name}\\s*\\(`).test(src)) constructed.add(name);
  }
}

const unconstructed = [...declared.keys()].filter((n) => !constructed.has(n)).sort();
const findings = unconstructed.filter((n) => !EXPECTED.has(n));
const staleRows = [...EXPECTED.keys()].filter((n) => !declared.has(n));

const BASELINE = path.join(path.dirname(new URL(import.meta.url).pathname), 'unconstructed-classes.baseline.json');
if (process.argv.includes('--update')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(BASELINE, `${JSON.stringify(findings, null, 2)}\n`);
  console.log(`baseline updated: ${findings.length} unconstructed class(es)`);
  process.exit(0);
}

let base = [];
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none yet */ }
const known = new Set(base);
const fresh = findings.filter((n) => !known.has(n));
const gone  = base.filter((n) => !findings.includes(n));

if (staleRows.length) {
  console.error(`\n✗ ${staleRows.length} EXPECTED row(s) name a class that no longer exists: ${staleRows.join(', ')}`);
  console.error('  Remove the row — an exemption must not outlive its subject.\n');
  process.exit(1);
}
if (fresh.length) {
  console.error(`\n✗ ${fresh.length} NEW exported class(es) that nothing ever constructs:\n`);
  for (const n of fresh) console.error(`  ${n}  (${declared.get(n)})`);
  console.error('\nGive it a consumer, retire it, or — if it is a port/abstract/adapter — add it to EXPECTED with the reason.\n');
  process.exit(1);
}
if (gone.length) console.log(`✓ unconstructed classes: ${gone.length} resolved (${gone.join(', ')}) — run with --update to shrink the baseline`);
console.log(`✓ unconstructed classes: no new ones (${declared.size} exported, ${EXPECTED.size} expected-unconstructed, ${findings.length} baselined)`);
