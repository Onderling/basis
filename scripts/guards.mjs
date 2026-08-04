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
const vt = spawnSync('npx', ['vitest', 'run', 'scripts/', '--reporter=dot'], { cwd: ROOT, encoding: 'utf8' });
results.push({ name: 'guard-self-tests', ok: vt.status === 0, out: (vt.stdout + vt.stderr).split('\n').slice(-6).join('\n') });

let red = 0;
console.log('\n── guards ─────────────────────────────────────────────');
for (const r of results) {
  console.log(` ${r.ok ? '✓' : '✗'} ${r.name}`);
  if (!r.ok) { red++; console.log(r.out.split('\n').map((l) => '   ' + l).join('\n')); }
}
console.log(`──────────────────────────────────── ${results.length - red}/${results.length} green ──`);
process.exit(red ? 1 : 0);
