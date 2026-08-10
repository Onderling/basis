#!/usr/bin/env node
/**
 * lint-ungoverned-user-params — a `kind:user` param that NO register governs advertises settability it
 * cannot deliver (the #36 companion to lint-stale-params, closing review finding 2).
 *
 * ── Why this guard exists ────────────────────────────────────────────────────────────────────────────
 * `param({ kind: PARAM_KIND.USER, … })` at a declaration site is a PROMISE: this value is user-settable. But
 * settability is only real if some app's register actually DECLARES the key (`reg.declare({ key, … })` at
 * composition) — that declaration is what puts the key behind the `set-param` gate and into the settings form.
 * A `kind:user` site with no register entry is INERT: the switch is drawn on the box, wired to nothing. It
 * reads as a preference in every doc and screen census, and toggling it does nothing. Two such params
 * (`calendarEmission.defaultDurationMin`, `onlineCadence.pollIntervalMs`) shipped exactly this way — declared
 * settable, governed by no register — which is what this guard now makes impossible.
 *
 * This is the mechanical half of the gradual-adoption rule (docs/conventions/parameters.md): migrate a tunable
 * to `param()` freely, but the MOMENT you mark one `kind:user` you must also register it (or leave it
 * `kind:internal`, which is immutable by construction and needs no register). No half-migrated settability.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────────────────────
 * Both the SITE declaration and the register ENTRY are the same object-literal shape — `{ key:'…', … kind:… }`
 * — so they are told apart by the one thing that differs: a SITE literal is the argument to `param(`, a
 * register ENTRY is a bare literal in a declaration array. For every `kind:user` SITE key, that key must also
 * appear as a `kind:user` register ENTRY key somewhere in tracked source. Any that does not is ungoverned.
 * Text-level + under-reporting, like its siblings: a key mentioned as a register entry anywhere counts as
 * governed. No baseline — a `kind:user` site is either governed or it is a bug to fix (register it, or make it
 * `kind:internal`); there is no legitimate "known-ungoverned" state to carry.
 *
 *   node scripts/lint-ungoverned-user-params.mjs     check (exit 1 on any ungoverned kind:user site)
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = () => sh('git ls-files').split('\n').filter(Boolean);

const isTest = (f) => /(^|\/)(test|tests|e2e|test-browser|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isVendored = (f) => /(^|\/)vendor\//.test(f) || /\.min\.js$/.test(f) || f.includes('/node_modules/');
const isSource = (f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f) && !isVendored(f);
// Strip comments so a docstring example of the `{ key:…, kind:user }` shape (this file's, params.js's) is not
// miscounted as a real site or entry. Same de-comment the stale-param scan uses.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// A non-nesting object literal that carries a `key: '…'` and a user `kind`. Params/register-entries never nest
// braces (default is a literal or a const, never an object), so `[^{}]*` is a safe, unambiguous body match.
const USER_OBJ_RE = /\{[^{}]*\}/g;
const keyOf = (lit) => lit.match(/\bkey\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
const isUserKind = (lit) => /\bkind\s*:\s*(?:PARAM_KIND\.USER|['"]user['"])/.test(lit);
// A literal is a SITE (a `param({…})` argument) iff it is immediately preceded by `param(`; otherwise it is a
// register ENTRY (a bare literal in a declaration array / passed to `.declare()`).
const precededByParam = (src, at) => /\bparam\(\s*$/.test(src.slice(Math.max(0, at - 12), at));

const sites = new Map();      // key -> ["file", …]  (kind:user declaration sites)
const governed = new Set();   // key                 (kind:user register entries)

for (const f of tracked().filter(isSource)) {
  let src;
  try { src = stripComments(readFileSync(path.join(ROOT, f), 'utf8')); } catch { continue; }
  for (const m of src.matchAll(USER_OBJ_RE)) {
    const lit = m[0];
    if (!isUserKind(lit)) continue;
    const key = keyOf(lit);
    if (!key) continue;
    if (precededByParam(src, m.index)) sites.set(key, [...(sites.get(key) ?? []), f]);
    else governed.add(key);
  }
}

const ungoverned = [...sites].filter(([key]) => !governed.has(key)).sort(([a], [b]) => a.localeCompare(b));

if (ungoverned.length) {
  console.error(`\n✗ lint:ungoverned-user-params — ${ungoverned.length} kind:user param(s) that NO register governs:\n`);
  for (const [key, where] of ungoverned) console.error(`   - ${key}   ← ${[...new Set(where)].join(', ')}`);
  console.error(`
A param declared kind:user promises a user-settable value, but nothing behind it is settable until an app's
register DECLARES the key at composition — that declaration is what puts it behind the set-param gate and into
the settings form. Fix, in order of preference:
  1. REGISTER it — add { key:'<key>', scope:…, kind:PARAM_KIND.USER, default:… } to the owning app's register
     (e.g. BASIS_USER_PARAMS in apps/basis/src/v2/paramsService.js). This is what makes it actually settable.
  2. Make it kind:internal — if it should NOT be user-settable, flip the site to PARAM_KIND.INTERNAL. Internal
     params are immutable by construction and need no register.
`);
  process.exit(1);
}

console.log(`✓ lint:ungoverned-user-params: ${sites.size} kind:user site(s), all register-governed.`);
