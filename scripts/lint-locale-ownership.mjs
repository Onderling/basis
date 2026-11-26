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
import { lineAt, lineOfKey } from './guard-where.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const WEB = 'apps/basis/locales';
const MOB = 'apps/basis-mobile/locales';
const SHARED = 'apps/basis/src/locales';
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src'];

const T_CALL = /(?:(?:^|[^A-Za-z0-9_.$])(?:t|tr|tt)|\b(?:ctx|opts)\.t)\(\s*'([A-Za-z0-9_.\-]+)'/gm;
const INLINE_FALLBACK = /typeof\s+t\s*===\s*'function'\s*\?\s*t\s*:\s*\((\w*)\)\s*=>\s*\1/;

const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
/** `rel:line` of a key in a locale JSON file. */
const at = (rel, key) => `${rel}:${lineOfKey(readFileSync(join(ROOT, rel), 'utf8'), key)}`;

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

// EVERY language: a duplicate that exists only in the Dutch files is the same fault (the overlap checks below run per
// language; which code renders a key is read from the English tables, the languages share their keys)
const LANGS = ['en', 'nl'];
const byLang = {};
for (const lang of LANGS) {
  const sharedKeys = {};
  const sharedFileOf = {};
  for (const f of readdirSync(join(ROOT, SHARED)).filter((x) => x.endsWith(`.${lang}.json`))) {
    const own = leaves(json(`${SHARED}/${f}`));
    Object.assign(sharedKeys, own);
    for (const k of Object.keys(own)) sharedFileOf[k] ??= `${SHARED}/${f}`;
  }
  byLang[lang] = { webKeys: leaves(json(`${WEB}/${lang}.json`)), mobKeys: leaves(json(`${MOB}/${lang}.json`)), sharedKeys, sharedFileOf };
}
const { webKeys, mobKeys, sharedKeys } = byLang.en;

const refs = new Map();
const inlineFallbacks = [];
const firstRef = new Map();   // key → `file:line` of the first t() that reaches it from shared code
for (const rel of walk('apps/basis/src').concat(walk('apps/basis/web'), walk('apps/basis-mobile/src'))) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  if (INLINE_FALLBACK.test(src) && !rel.endsWith('locales/translatorOr.js')) inlineFallbacks.push(`${rel}:${lineAt(src, src.search(INLINE_FALLBACK))}`);
  for (const m of src.matchAll(T_CALL)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(shellOf(rel));
    if (shellOf(rel) === 'shared' && !firstRef.has(m[1])) firstRef.set(m[1], `${rel}:${lineAt(src, m.index)}`);
  }
}

const problems = [];

for (const lang of LANGS) {
  const { webKeys: w, mobKeys: m } = byLang[lang];
  for (const k of Object.keys(w)) {
    if (k in m) {
      problems.push(`${at(`${WEB}/${lang}.json`, k)} and ${at(`${MOB}/${lang}.json`, k)}: both shells define "${k}"`
        + `\n    Fix: if both need it, it is shared by definition: move it to a block in ${SHARED}/ (both languages) and delete it from both shell bundles.`);
    }
  }
}

// …and a shell key that ALSO exists in the shared blocks is the same fault wearing a different hat:
// the merge would resolve it silently (shared wins), so the shell's copy is dead weight that can drift
// without anyone seeing a conflict. Found by red-checking this guard: the first version compared only
// the two shells, and a shell-vs-shared duplicate walked straight past it.
for (const lang of LANGS) {
  const { webKeys: w, mobKeys: m, sharedKeys: s, sharedFileOf: sf } = byLang[lang];
  for (const [name, table, dir] of [['web', w, WEB], ['mobile', m, MOB]]) {
    for (const k of Object.keys(table)) {
      if (k in s) {
        problems.push(`${at(`${dir}/${lang}.json`, k)}: "${k}" is defined in the ${name} bundle AND in the shared blocks (${at(sf[k], k)})`
          + `\n    Fix: delete the shell's copy (in both languages); the merge already prefers the shared one.`);
      }
    }
  }
}

for (const [k, who] of refs) {
  const inShell = (k in webKeys) || (k in mobKeys);
  if (!inShell) continue;
  const shared = who.has('shared') || (who.has('web') && who.has('mob'));
  if (shared && !(k in sharedKeys)) {
    const home = k in webKeys ? `${WEB}/en.json` : `${MOB}/en.json`;
    const by = who.has('shared') ? `shared code (${firstRef.get(k)})` : 'both shells';
    problems.push(`${at(home, k)}: "${k}" is rendered by ${by} but lives in a shell bundle`
      + `\n    Fix: move it (both languages) to a block in ${SHARED}/ and delete the shell's copy.`);
  }
}

for (const rel of inlineFallbacks) {
  problems.push(`${rel}: re-implements the identity translator inline, so a missing t is silent`
    + `\n    Fix: use translatorOr(t, '<module>') from ${SHARED}/translatorOr.js instead.`);
}

if (problems.length) {
  console.error(`✖ lint-locale-ownership — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nThe rule and its reasoning: docs/conventions/localisation.md ("Adding a string").');
  process.exit(1);
}
console.log(`✓ lint-locale-ownership: one home per string (web ${Object.keys(webKeys).length} · mobile ${Object.keys(mobKeys).length} · shared ${Object.keys(sharedKeys).length}).`);
