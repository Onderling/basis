#!/usr/bin/env node
/**
 * lint-locale-ownership — a user-facing string is defined in exactly ONE place, and the place is
 * decided by who renders it.
 *
 * basis has two shells over one app. Each merges its own bundle with the shared blocks in
 * `apps/basis/src/locales/`, so there are three homes and one rule:
 *
 *   1. NO OVERLAP        — a dotted key is never defined in both shells' bundles.
 *   2. SHARED CODE       — a key reached from a file BOTH shells can render, or reached from both
 *                          shells' own files, lives in the shared blocks.
 *   3. NO SILENT FALLBACK — a shared module never re-implements the identity translator inline.
 *
 * Why it exists: on 2026-08-31 the two bundles held 37 duplicated keys, thirteen of which had drifted
 * to DIFFERENT wording — one shared projector, two sentences, depending on which shell you looked at.
 * Another ~100 strings written by shared code lived in the web bundle only, so a phone answered with
 * key names. Nothing failed, because a missing translation is a string and a duplicated one is two
 * strings. → docs/conventions/localisation.md, plans/PLAN-locale-consolidation.md.
 *
 * Deliberately NOT checked: whether a key is dead. A static scan cannot see interpolated keys
 * (`circle.kind.${id}`), and a guard that guesses at deletion would be worse than none.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const WEB = 'apps/basis/locales';
const MOB = 'apps/basis-mobile/locales';
const SHARED = 'apps/basis/src/locales';
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src'];

const T_CALL = /(?:(?:^|[^A-Za-z0-9_.$])(?:t|tr|tt)|\b(?:ctx|opts)\.t)\(\s*'([A-Za-z0-9_.\-]+)'/gm;
const INLINE_FALLBACK = /typeof\s+t\s*===\s*'function'\s*\?\s*t\s*:\s*\((\w*)\)\s*=>\s*\1/;

const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

function leaves(node, pre = '', out = {}) {
  if (node && typeof node === 'object') {
    if (typeof node.text === 'string') { out[pre] = true; return out; }
    for (const [k, v] of Object.entries(node)) leaves(v, pre ? `${pre}.${k}` : k, out);
  }
  return out;
}

function walk(dir, out = []) {
  let ents = [];
  try { ents = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Which shells can render this file — the same mapping the locale fitness test uses. */
const shellOf = (rel) =>
  (rel.startsWith('apps/basis/src/web/') || rel.startsWith('apps/basis/web/')) ? 'web'
  : (rel.startsWith('apps/basis/src/rn/') || rel.startsWith('apps/basis-mobile/')) ? 'mob'
  : 'shared';

const webKeys = leaves(json(`${WEB}/en.json`));
const mobKeys = leaves(json(`${MOB}/en.json`));
const sharedNames = readdirSync(join(ROOT, SHARED)).filter((f) => f.endsWith('.en.json'));
const sharedKeys = {};
for (const f of sharedNames) Object.assign(sharedKeys, leaves(json(`${SHARED}/${f}`)));

const refs = new Map();
const inlineFallbacks = [];
for (const rel of walk('apps/basis/src').concat(walk('apps/basis/web'), walk('apps/basis-mobile/src'))) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  if (INLINE_FALLBACK.test(src) && !rel.endsWith('locales/translatorOr.js')) inlineFallbacks.push(rel);
  for (const m of src.matchAll(T_CALL)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(shellOf(rel));
  }
}

const problems = [];

for (const k of Object.keys(webKeys)) {
  if (k in mobKeys) problems.push(`both shells define "${k}" — if both need it, it is shared by definition`);
}

// …and a shell key that ALSO exists in the shared blocks is the same fault wearing a different hat:
// the merge would resolve it silently (shared wins), so the shell's copy is dead weight that can drift
// without anyone seeing a conflict. Found by red-checking this guard: the first version compared only
// the two shells, and a shell-vs-shared duplicate walked straight past it.
for (const [name, table] of [['web', webKeys], ['mobile', mobKeys]]) {
  for (const k of Object.keys(table)) {
    if (k in sharedKeys) problems.push(`"${k}" is defined in the ${name} bundle AND in the shared blocks — delete the shell's copy, the merge already prefers the shared one`);
  }
}

for (const [k, who] of refs) {
  const inShell = (k in webKeys) || (k in mobKeys);
  if (!inShell) continue;
  const shared = who.has('shared') || (who.has('web') && who.has('mob'));
  if (shared && !(k in sharedKeys)) {
    problems.push(`"${k}" is rendered by ${who.has('shared') ? 'shared code' : 'both shells'} but lives in a shell bundle — move it to ${SHARED}/`);
  }
}

for (const rel of inlineFallbacks) {
  problems.push(`${rel} re-implements the identity translator inline — use translatorOr(t, '<module>') so a missing t is not silent`);
}

if (problems.length) {
  console.error(`✖ lint-locale-ownership — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nThe rule and its reasoning: docs/conventions/localisation.md ("Adding a string").');
  process.exit(1);
}
console.log(`✓ lint-locale-ownership: one home per string (web ${Object.keys(webKeys).length} · mobile ${Object.keys(mobKeys).length} · shared ${Object.keys(sharedKeys).length}).`);
