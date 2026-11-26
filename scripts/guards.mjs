#!/usr/bin/env node
/**
 * guards.mjs — THE aggregate. One command, every guard, one summary, nonzero exit on any red.
 *
 * The rule this enforces (CLAUDE.md): a guard outside this aggregate does not exist. Guards that rot
 * unrun are how this repo's drift survived for months — a guard is only a guard while something runs it.
 *
 * Tier 1 (this script): every `scripts/lint-*.mjs`, in parallel, + the guards' own self-tests (`vitest run scripts/`),
 * locally only when scripts/ changed (CI and `--all` always). Cheap by design, so it can run always. The behavioural tier (the twin) and the per-package
 * fitness suites run with their test commands; `/health` (wave 2) will report across all tiers.
 */
import { execSync, spawn, spawnSync } from 'node:child_process';
import { untrackedSource } from './untracked-source.mjs';
import { runPool, selfTestsNeeded, byteCompare, ALWAYS_STEPS } from './guard-run.mjs';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const lints = readdirSync(HERE).filter((f) => /^lint-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs')).sort(byteCompare);

// The lints in parallel, at most one per CPU: each is a read-only scan (none is passed --update here).
const runScript = (name, file, args = []) => () => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(HERE, file), ...args], { cwd: ROOT });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ name, ok: code === 0, out: out.trim() }));
});
// The always-steps (guard-run.mjs ALWAYS_STEPS) run with the lints, never behind the self-test skip.
const results = await runPool([
  ...lints.map((f) => runScript(f.replace(/^lint-|\.mjs$/g, ''), f)),
  ...ALWAYS_STEPS.map((s) => runScript(s.name, s.script, s.args)),
], availableParallelism());

// The guards' own self-tests — a guard whose test is red is not a guard. Locally only when something under scripts/
// differs from the branch's base (committed or not); CI and `--all` always run them.
const changedPaths = () => {
  try {
    const base = execSync('git merge-base HEAD origin/development', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const committed = execSync(`git diff --name-only ${base}`, { cwd: ROOT, encoding: 'utf8' });
    const loose = execSync('git ls-files --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' });
    return [...committed.split('\n'), ...loose.split('\n')].filter(Boolean);
  } catch { return null; }
};
const plan = selfTestsNeeded({ ci: !!process.env.CI, all: process.argv.includes('--all'), changed: changedPaths() });
if (plan.run) {
  // One file at a time: several self-tests write fixture files INTO the tree (a guard scans the real tree), and others
  // run a guard on the tree at the same moment — in parallel that went red now and then, green alone. ~25 s slower.
  const vt = spawnSync('npx', ['vitest', 'run', 'scripts/', '--reporter=dot', '--no-file-parallelism'], { cwd: ROOT, encoding: 'utf8' });
  // On red, say WHICH test failed (the FAIL lines), not only the tail — a flake that names no test cannot be chased.
  const vtOut = (vt.stdout + vt.stderr).split('\n');
  const failed = vtOut.filter((l) => /\bFAIL\b|AssertionError|Error:/.test(l)).slice(0, 12);
  results.push({ name: 'guard-self-tests', ok: vt.status === 0, out: [...failed, ...vtOut.slice(-6)].join('\n') });
}

let red = 0;
console.log('\n── guards ─────────────────────────────────────────────');
for (const r of results) {
  console.log(` ${r.ok ? '✓' : '✗'} ${r.name}`);
  if (!r.ok) { red++; console.log(r.out.split('\n').map((l) => '   ' + l).join('\n')); }
}
console.log(`──────────────────────────────────── ${results.length - red}/${results.length} green ──`);
if (!plan.run) console.log(`· guard self-tests skipped: ${plan.why}`);
// A guard reading `git ls-files` cannot see a file that is not added yet — say so, or a green here is a green of the
// tracked tree only (a red then appears a PR later). `git add -N <file>` is enough for the guards to see it.
let untracked = [];
try { untracked = untrackedSource(execSync('git ls-files --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)); } catch { /* not a git tree */ }
if (untracked.length) {
  console.log(`⚠ ${untracked.length} untracked source file(s) the guards did not see — \`git add -N\` them and run again:`);
  for (const f of untracked.slice(0, 10)) console.log(`   ${f}`);
  if (untracked.length > 10) console.log(`   … and ${untracked.length - 10} more`);
}
process.exit(red ? 1 : 0);
