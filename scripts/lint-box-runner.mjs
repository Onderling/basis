#!/usr/bin/env node
/**
 * lint-box-runner — the box runner (deploy/box) stays a working thing, not a script that rotted.
 * Runs `bash -n` over the runner + role scripts, checks every role still declares the repo paths its
 * image is built from (`scripts/box-role-paths.mjs` — stale means the box would rebuild the wrong set,
 * so a role would be interrupted by an unrelated release, or worse, NOT rebuilt by its own), and the
 * updater's own test suite (a real git remote, a fake docker: update, selective rebuild, rollback, HOLD,
 * RESET, Caddyfile + reload, install). Seconds; no docker daemon needed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A script that does not parse: bash's own error, with the place as file:line and what to do. */
export function bashSyntaxMessage(file, stderr) {
  const lines = String(stderr).trim().split('\n').filter(Boolean);
  const out = [`✗ lint-box-runner: ${file} does not parse (bash -n) — the box would fail on its next update:`];
  for (const l of lines) {
    const m = l.match(/^(.*?): line (\d+): (.*)$/);
    out.push(m ? `  ${file}:${m[2]}: ${m[3]}` : `  ${file}: ${l}`);
  }
  out.push(`  Fix: correct the syntax at that line, then check it with \`bash -n ${file}\`.`);
  return out.join('\n');
}

/** Failing updater/publish tests out of `node --test` TAP output: each as its name and file:line, and how to rerun. */
export function testFailureMessage(output, root = ROOT) {
  const out = ['✗ lint-box-runner: an updater or publish test failed — the box update, rollback or publish would misbehave:'];
  const files = new Set();
  for (const l of String(output).split('\n')) {
    const loc = l.match(/^\s*location: '(.*?):(\d+):\d+'/);
    if (loc) {
      const rel = path.relative(root, loc[1]);
      files.add(rel);
      out.push(`    at ${rel}:${loc[2]}`);
    } else if (/not ok|error|Error/.test(l)) out.push(l);
    if (out.length > 40) break;
  }
  const rerun = files.size ? [...files].join(' ') : 'deploy/box/test/ deploy/web/test/';
  out.push(`  Fix: make the test pass (or, if the behaviour changed on purpose, change the test with it); rerun with \`node --test ${rerun}\`.`);
  return out.join('\n');
}

function main() {
  const scripts = [
    ...['lib.sh', 'update.sh', 'install.sh'].map((f) => path.join('deploy/box', f)),
    ...readdirSync(path.join(ROOT, 'deploy/roles')).filter((f) => f.endsWith('.health')).map((f) => path.join('deploy/roles', f)),
  ];
  let red = 0;
  for (const s of scripts) {
    const r = spawnSync('bash', ['-n', s], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { red++; console.error(bashSyntaxMessage(s, r.stderr)); }
  }
  const paths = spawnSync(process.execPath, [path.join(ROOT, 'scripts/box-role-paths.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (paths.status !== 0) { red++; console.error((paths.stdout + paths.stderr).trim()); }
  const t = spawnSync(process.execPath, ['--test', 'deploy/box/test/', 'deploy/web/test/'], { cwd: ROOT, encoding: 'utf8' });
  if (t.status !== 0) { red++; console.error(testFailureMessage(t.stdout + t.stderr)); }
  console.log(red ? `box-runner: ${red} problem(s)` : `box-runner: ${scripts.length} scripts parse, role paths current, updater + publish tests green`);
  process.exit(red ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
