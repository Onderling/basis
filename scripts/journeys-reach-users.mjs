/**
 * journeys-reach-users — the CORE of the "a journey walks a corridor a person can walk" check.
 *
 * Split from the guard that runs it (`lint-journeys-reach-users.mjs`) for the same reason
 * `integration-index.mjs` is split from its lint: the interesting part is a pure comparison, and a
 * pure comparison can be driven with made-up inputs. The guard's own test used to need the tree to
 * contain an unreached op in order to prove that unreached ops fail — so the moment the last one was
 * closed, the test asserting "this fails" stopped being able to fail, and went red. A check that can
 * only be tested while it is broken is not much of a check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Comments do not dispatch anything — strip them before asking what a file CALLS. */
export const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/** The verbs that only LOOK. A journey driving one of these is asserting, not exercising a feature. */
export const READ_VERBS = new Set(['list', 'help', 'get', 'view', 'show']);

export const walk = (dir, out = []) => {
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

/**
 * The ops a file drives, as `app:op`.
 *
 * Two idioms, both literal-only (a computed op is unknowable statically, and the generic dispatchers
 * legitimately compute one): `callSkill('app','op', …)` and its aliases — anything ending in
 * `skill`/`Skill`, which is how `rawCallSkill` and `skill` reach the same waist — plus the journeys'
 * own `call(node, 'op', …)` helper, whose app is fixed where the helper is defined.
 */
export function opsIn(text, journeyApp = null) {
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
export function reachedIn(text) {
  const s = strip(text);
  const out = new Set();
  for (const m of s.matchAll(/\b[A-Za-z_]*[sS]kill\(\s*['"][\w-]+['"]\s*,\s*['"]([\w.-]+)['"]/g)) out.add(m[1]);
  for (const m of s.matchAll(/\b(?:register|wire)\(\s*['"]([\w.-]+)['"]/g)) out.add(m[1]);
  return out;
}

/**
 * THE COMPARISON. An op is reported only when all three hold — see the guard's header for why each
 * one alone is noise.
 *
 * @param {object} a
 * @param {Iterable<string>} a.journeyOps  `app:op` keys the journeys drive
 * @param {Set<string>|Iterable<string>} a.reached  bare op ids production code reaches
 * @param {Map<string,string>} a.verbs     op id → its manifest verb
 * @returns {string[]} sorted `app:op` keys with no way in
 */
export function findUnreached({ journeyOps, reached, verbs }) {
  const canReach = reached instanceof Set ? reached : new Set(reached ?? []);
  const verbOf = verbs instanceof Map ? verbs : new Map(Object.entries(verbs ?? {}));
  return [...journeyOps]
    .filter((key) => {
      const id = key.split(':')[1];
      const verb = verbOf.get(id);
      if (verb === undefined || READ_VERBS.has(verb)) return false;   // unknown or read-only: not a feature claim
      return !canReach.has(id);
    })
    .sort();
}

/** Every op each app manifest declares, with its verb — the source of truth for "does this WRITE". */
export async function verbsByOp(root) {
  const specs = [
    ['apps/basis/manifest.js',     'basisManifest'],
    ['apps/household/manifest.js', 'householdManifest'],
    ['apps/stoop/manifest.js',     'stoopManifest'],
    ['apps/folio/manifest.js',     'folioManifest'],
    ['apps/tasks-v0/manifest.js',  'tasksManifest'],
  ];
  const verbs = new Map();
  for (const [rel, pick] of specs) {
    let mod; try { mod = await import(path.join(root, rel)); } catch { continue; }
    const manifest = mod[pick] ?? mod.default;
    for (const op of manifest?.operations ?? []) {
      if (op?.id && !verbs.has(op.id)) verbs.set(op.id, String(op.verb ?? ''));
    }
  }
  return verbs;
}
