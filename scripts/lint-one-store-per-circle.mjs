#!/usr/bin/env node
/**
 * lint-one-store-per-circle — a circle owns ONE store, so a type cannot reach a peer some other way.
 *
 * `docs/architecture.md` (§3, the data plane) states it twice and this is the check for it:
 *
 *   > "Two stores for one circle is a defect, not a design."
 *   > "There is ONE fan-out path per circle. A type that reaches a peer some other way is a second
 *      implementation of sync and will drift from this one."
 *
 * What it costs when it drifts, measured: the composable lists built their own `createCircleStores` over
 * their own DataSource, beside the one the rail mirrors. Nothing failed — on one device, with one member,
 * lists worked — and a list reached NOBODY, in any circle, for as long as the feature existed. The feature
 * had grown a private pod path instead, which is the second half of the same rule broken.
 *
 * So: a per-circle store registry may be built in ONE place, and every other feature is handed that
 * circle's store (`agent.circleStoreFor(circleId)`). The allowances below are exhaustive and each says
 * why; adding one is the thing to argue about in review, which is the point.
 *
 *   node scripts/lint-one-store-per-circle.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Where a per-circle store registry may be constructed, and why. A path is allowed for its REASON, not
 * because it is where the code happens to be today.
 */
const ALLOWED = Object.freeze({
  'apps/basis/src/v2/householdApp.js':
    'THE circle registry — the store every typed item lives in and the rail mirrors. This is the one.',
  'packages/kring-host/src/circleLists.js':
    'The documented fallback for a composition with no circle store (tests, and a shell before its agent '
    + 'exists). A composition that HAS one passes `storeFor` and this branch is not taken.',
  'apps/basis/src/v2/ownDevicesStore.js':
    'The own-devices store — a person\'s (or a bot\'s) OWN typed items, keyed by the own-devices scope the grants lane '
    + 'rides: it reaches only their own devices, never a circle\'s members. A different scope, not a second store for a circle.',
  'apps/pinboard/src/lib/ContactBook.js':
    'The contact book\'s standalone default — an in-memory own-devices store for pinboard with no host (tests). A host '
    + 'passes its own store (`contactStore`) and this branch is not taken; not a circle\'s store.',
  'apps/basis/src/v2/contactDmStore.js':
    'The contact DM store — `getStore(\'dm\')`, a 1:1 thread, not a circle. A different scope, not a '
    + 'second store for the same one. Shared web≡mobile so the two shells cannot each build their own.',
});

/** Every source file that mentions the constructor, excluding tests and the substrate that defines it. */
function callSites() {
  const out = execSync(
    'grep -rln "createCircleStores(" --include=*.js apps packages | grep -v node_modules || true',
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  return out ? out.split('\n').filter((f) => !/\/test\/|\.test\.|__tests__/.test(f)) : [];
}

const problems = [];
for (const file of callSites()) {
  // The substrate that DEFINES + re-exports it, and files that only name it in prose, are not call sites.
  if (file === 'packages/item-store/src/circleStores.js' || file === 'packages/item-store/src/index.js') continue;
  // Count CALLS, not mentions: the constructor is named in prose all over the substrate (it is the thing
  // those files document), and a guard that cannot tell a sentence from a call reports the docs as the bug.
  const calls = [];
  read(file).split('\n').forEach((line, i) => {
    if (!/^\s*(\/\/|\*|\/\*)/.test(line) && /createCircleStores\s*\(/.test(line)) calls.push(i + 1);
  });
  if (calls.length === 0) continue;
  if (ALLOWED[file]) continue;
  for (const line of calls) {
    problems.push(
      `${file}:${line}: builds a per-circle store registry — a circle owns ONE store.\n`
      + '    Fix: take the circle\'s store from `agent.circleStoreFor(circleId)` instead. Only if this genuinely is not a '
      + `circle store, add it to ALLOWED in ${path.relative(ROOT, SELF)} with the reason — that is the sentence review should read.`,
    );
  }
}

/** Where ALLOWED names a file, as `guard:line`, so a stale entry points at the line to delete. */
function allowedAt(file) {
  const lines = readFileSync(SELF, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(`'${file}'`));
  return `${path.relative(ROOT, SELF)}:${i + 1}`;
}

// The allowances must stay honest: an entry naming a file that no longer builds one is stale.
for (const [file, why] of Object.entries(ALLOWED)) {
  let src = '';
  try { src = read(file); } catch { problems.push(`${allowedAt(file)}: ALLOWED names "${file}", which does not exist.\n    Fix: remove that entry.`); continue; }
  const builds = src.split('\n').some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /createCircleStores\s*\(/.test(line));
  if (!builds) {
    problems.push(`${allowedAt(file)}: ALLOWED names "${file}" (${why.slice(0, 40)}…) but it no longer builds one.\n    Fix: remove the allowance.`);
  }
}

if (problems.length) {
  console.error(`✖ lint-one-store-per-circle — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log(`✓ lint-one-store-per-circle: ${Object.keys(ALLOWED).length} allowed construction site(s), no others.`);
