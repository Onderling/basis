#!/usr/bin/env node
/**
 * lint-host-tick — a host has ONE clock. Nothing in the basis app code keeps an interval of its own.
 *
 * Every timed thing a host does — reminders, the nightly export, the model watch, the unlocked-key sweep — is a job
 * on the host's tick (`apps/basis/src/v2/hostTick.js`), started in a fixed order, each on its own period. Before it,
 * the box ran four separate `setInterval`s, each added by a feature that needed "every so often", none visible
 * beside the others, and the next feature would have added a fifth. Nothing failed when it did; this is the check.
 *
 * A new timed thing is `hostTick.add(name, { every, run })` — or, for pending work a person or an app wants done
 * later, an intention on the stores. Plumbing timers inside the transport packages are not app behaviour and are
 * out of scope. A one-shot `setTimeout` (a delay, a retry, a debounce) is not a clock and is allowed.
 *
 *   node scripts/lint-host-tick.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
/** The app code the rule covers: the basis app (its shared code, the box, the web shell) and the mobile shell. */
const SCOPE = ['apps/basis', 'apps/basis-mobile'];
/** The one clock. */
const THE_TICK = 'apps/basis/src/v2/hostTick.js';
const NOT_APP_CODE = /\/node_modules\/|\/test\/|\/test-browser\/|\/e2e\/|__tests__|\.test\.|\.spec\.|\/dist\/|\/build\/|\/android\/|\/ios\//;

function files() {
  const out = execSync(
    `grep -rlE "setInterval\\s*\\(" ${SCOPE.join(' ')} --include=*.js --include=*.mjs --include=*.jsx --include=*.ts --include=*.tsx 2>/dev/null || true`,
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  return out ? out.split('\n').filter((f) => !NOT_APP_CODE.test(`/${f}`)) : [];
}

const problems = [];
for (const file of files()) {
  if (file === THE_TICK) continue;
  // calls, not prose: a comment naming setInterval is not a timer
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const at = lines.map((l, i) => [l, i + 1]).filter(([l]) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /setInterval\s*\(/.test(l)).map(([, n]) => n);
  if (at.length) problems.push(`${file}:${at.join(',')} keeps its own interval. A host has one clock: add a job — hostTick.add(name, { every, run }).`);
}

if (problems.length) {
  console.error('lint-host-tick: an interval outside the host tick\n');
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log('lint-host-tick: one clock per host — no interval outside the host tick.');
