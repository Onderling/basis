#!/usr/bin/env node
/**
 * guards.mjs — THE aggregate. One command, every guard, one summary, nonzero exit on any red.
 *
 * The rule this enforces (CLAUDE.md): a guard outside this aggregate does not exist. Guards that rot
 * unrun are how this repo's drift survived for months — a guard is only a guard while something runs it.
 *
 * Tier 1 (this script): every `scripts/lint-*.mjs` + the guards' own self-tests (`vitest run scripts/`).
 * Cheap by design — seconds, so it can run always. The behavioural tier (the twin) and the per-package
 * fitness suites run with their test commands; `/health` (wave 2) will report across all tiers.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const lints = readdirSync(HERE).filter((f) => /^lint-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs')).sort();

const results = [];
for (const f of lints) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { cwd: ROOT, encoding: 'utf8' });
  results.push({ name: f.replace(/^lint-|\.mjs$/g, ''), ok: r.status === 0, out: (r.stdout + r.stderr).trim() });
}
// The guards' own self-tests — a guard whose test is red is not a guard.
// One file at a time: several self-tests write fixture files INTO the tree (a guard scans the real tree), and others
// run a guard on the tree at the same moment — in parallel that went red now and then, green alone. ~25 s slower.
const vt = spawnSync('npx', ['vitest', 'run', 'scripts/', '--reporter=dot', '--no-file-parallelism'], { cwd: ROOT, encoding: 'utf8' });
// On red, say WHICH test failed (the FAIL lines), not only the tail — a flake that names no test cannot be chased.
const vtOut = (vt.stdout + vt.stderr).split('\n');
const failed = vtOut.filter((l) => /\bFAIL\b|AssertionError|Error:/.test(l)).slice(0, 12);
results.push({ name: 'guard-self-tests', ok: vt.status === 0, out: [...failed, ...vtOut.slice(-6)].join('\n') });

let red = 0;
console.log('\n── guards ─────────────────────────────────────────────');
for (const r of results) {
  console.log(` ${r.ok ? '✓' : '✗'} ${r.name}`);
  if (!r.ok) { red++; console.log(r.out.split('\n').map((l) => '   ' + l).join('\n')); }
}
console.log(`──────────────────────────────────── ${results.length - red}/${results.length} green ──`);
process.exit(red ? 1 : 0);
