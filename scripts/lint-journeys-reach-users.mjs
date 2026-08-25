#!/usr/bin/env node
/**
 * lint-journeys-reach-users — a journey walks a corridor a PERSON can walk.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The end-to-end journeys are this repo's strongest evidence: real devices, a real relay, real
 * convergence. They are also the evidence most easily mistaken for more than it is, because a journey
 * reaches the waist directly — `callSkill(app, op, args)` — which is the ONE thing no person can do.
 *
 * `setMemberRole` is the worked example (2026-08-25). It was declared, gated, folded, and walked end
 * to end by a 26-check journey that passed. No shell painted a control for it, so an admin could not
 * promote anyone or step back from the app at all. Every layer was green and the feature was
 * unreachable; the journey said "handing over authority works", and what it actually proved was that
 * it works *if you can get to the op*.
 *
 * So: for every op a journey drives, some production shell code must reach the same op. That is the
 * cheapest true statement of "the journeys represent users" that a static check can make.
 *
 * ── What it does NOT prove, stated plainly ───────────────────────────────────────────────────────
 * That a call site exists is not that a person can find it, nor that the journey's corridor and the
 * person's corridor are the same one. A journey passes `{opId, args}` straight to the waist; a person
 * goes through a projector, a confirm, a gate. The real closer is a journey driven THROUGH the
 * surface rather than beside it — not built. This guard closes the coarsest hole: an op nothing
 * outside a test can reach at all.
 *
 * ── Three conditions, so that it says something true ─────────────────────────────────────────────
 * An op is reported only when ALL of these hold, because each one on its own produces noise:
 *
 *   1. A journey drives it.
 *   2. It WRITES. A journey reading `listRequests` to assert what happened is not claiming anybody
 *      reaches that op — it is the journey's eyes. Only ops whose manifest verb changes something
 *      are features a person needs a way to.
 *   3. Nothing in production reaches it — neither DISPATCHING it (under any app origin: basis
 *      re-exposes other apps' ops as its own, so an origin-strict match invents gaps that are not
 *      there) nor REGISTERING a handler for it (the receiving half of a two-device handshake, like
 *      device enrolment, is reached by the person on the other device).
 *
 * ── The shape ────────────────────────────────────────────────────────────────────────────────────
 * Baselined, like the other structural guards here: the existing gap is DEBT and is listed by name
 * with a reason, so it is visible without blocking; a NEW gap fails. Shrinking the baseline is the
 * work; growing it is the smell.
 *
 * Usage: node scripts/lint-journeys-reach-users.mjs [--update]   (runs inside `npm run guards`)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const BASELINE = path.join(HERE, 'journeys-reach-users-baseline.json');
const UPDATE = process.argv.includes('--update');

/** Where the journeys live, and where a person's corridor is composed. */
const JOURNEYS = 'apps/e2e-journeys';
const SHELLS = ['apps/basis/web', 'apps/basis-mobile/src', 'apps/basis/src'];

const walk = (dir, out = []) => {
  let names; try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git') continue;
    const f = path.join(dir, n);
    let st; try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) walk(f, out);
    else if (/\.(js|mjs)$/.test(n)) out.push(f);
  }
  return out;
};

/** Comments do not dispatch anything — strip them before asking what a file CALLS. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/**
 * The ops a file drives.
 *
 * Two idioms, both literal-only (a computed op is unknowable statically, and the generic dispatchers
 * legitimately compute one):
 *   · `callSkill('app', 'op', …)` and its aliases — anything ending in `skill`/`Skill`, which is how
 *     `rawCallSkill` and `skill` reach the same waist.
 *   · the journeys' own `call(node, 'op', …)` helper, whose app is fixed one line above it.
 */
function opsIn(text, journeyApp = null) {
  const s = strip(text);
  const out = new Set();
  for (const m of s.matchAll(/\b[A-Za-z_]*[sS]kill\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w.-]+)['"]/g)) {
    out.add(`${m[1]}:${m[2]}`);
  }
  if (journeyApp) {
    for (const m of s.matchAll(/\bcall\(\s*\w+\s*,\s*['"]([\w.-]+)['"]/g)) out.add(`${journeyApp}:${m[1]}`);
  }
  return out;
}

/** Bare op ids production code reaches — dispatched under ANY origin, or wired/registered as a handler. */
function reachedIn(text) {
  const s = strip(text);
  const out = new Set();
  for (const m of s.matchAll(/\b[A-Za-z_]*[sS]kill\(\s*['"][\w-]+['"]\s*,\s*['"]([\w.-]+)['"]/g)) out.add(m[1]);
  for (const m of s.matchAll(/\b(?:register|wire)\(\s*['"]([\w.-]+)['"]/g)) out.add(m[1]);
  return out;
}

/** Every op each app manifest declares, with its verb — the source of truth for "does this WRITE". */
async function verbsByOp() {
  const specs = [
    ['basis',     'apps/basis/manifest.js',              'basisManifest'],
    ['household', 'apps/household/manifest.js',          'householdManifest'],
    ['stoop',     'apps/stoop/manifest.js',              'stoopManifest'],
    ['folio',     'apps/folio/manifest.js',              'folioManifest'],
    ['tasks-v0',  'apps/tasks-v0/manifest.js',           'tasksManifest'],
  ];
  const verbs = new Map();
  for (const [, rel, pick] of specs) {
    let mod; try { mod = await import(path.join(ROOT, rel)); } catch { continue; }
    const manifest = mod[pick] ?? mod.default;
    for (const op of manifest?.operations ?? []) {
      if (op?.id && !verbs.has(op.id)) verbs.set(op.id, String(op.verb ?? ''));
    }
  }
  return verbs;
}

/** The verbs that only LOOK. A journey driving one of these is asserting, not exercising a feature. */
const READ_VERBS = new Set(['list', 'help', 'get', 'view', 'show']);

const journeyOps = new Map();   // "app:op" → the journey files that drive it
for (const f of walk(path.join(ROOT, JOURNEYS))) {
  const text = readFileSync(f, 'utf8');
  // The helper's app origin, read from the helper itself rather than assumed.
  const app = /callSkill\(\s*['"]([\w-]+)['"]\s*,\s*op\b/.exec(text)?.[1] ?? 'stoop';
  for (const op of opsIn(text, app)) {
    if (!journeyOps.has(op)) journeyOps.set(op, []);
    journeyOps.get(op).push(path.relative(ROOT, f));
  }
}

const reached = new Set();
for (const dir of SHELLS) {
  for (const f of walk(path.join(ROOT, dir))) {
    if (/[/.]test\./.test(f)) continue;             // a test is not a person
    for (const op of reachedIn(readFileSync(f, 'utf8'))) reached.add(op);
  }
}

const verbs = await verbsByOp();
const writes = (key) => {
  const verb = verbs.get(key.split(':')[1]);
  return verb !== undefined && !READ_VERBS.has(verb);
};

const gap = [...journeyOps.keys()]
  .filter((key) => writes(key) && !reached.has(key.split(':')[1]))
  .sort();

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* first run */ }

if (UPDATE) {
  const next = {};
  for (const op of gap) next[op] = baseline[op] ?? `walked by ${journeyOps.get(op)[0]}; no shell reaches it — REASON NEEDED`;
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ lint:journeys-reach-users — baseline written with ${gap.length} carried gap(s).`);
  process.exit(0);
}

const known = new Set(Object.keys(baseline));
const fresh = gap.filter((op) => !known.has(op));
const fixed = [...known].filter((op) => !gap.includes(op));

if (fresh.length) {
  console.error(`✖ lint:journeys-reach-users — ${fresh.length} op(s) a journey walks that NOTHING a person uses can reach:\n`);
  for (const op of fresh) {
    console.error(`  • ${op}\n      walked by ${journeyOps.get(op).join(', ')}`);
  }
  console.error('\nA green journey over an op no shell reaches proves the mechanism, not the feature —');
  console.error('that is how a role system came to be fully built and completely unusable. Paint the');
  console.error('control, or record the gap on purpose: node scripts/lint-journeys-reach-users.mjs --update');
  process.exit(1);
}

if (fixed.length) {
  console.error(`✖ lint:journeys-reach-users — ${fixed.length} baselined gap(s) are now REACHED. Drop them:\n`);
  for (const op of fixed) console.error(`  • ${op}`);
  console.error('\n  node scripts/lint-journeys-reach-users.mjs --update');
  process.exit(1);
}

if (gap.length) {
  console.log(`⚠ lint:journeys-reach-users — ${gap.length} carried gap(s): a journey walks them, no shell does.`);
}
console.log(`✓ lint:journeys-reach-users: ${journeyOps.size} op(s) walked by journeys, ${journeyOps.size - gap.length} reachable from a shell.`);
