#!/usr/bin/env node
/**
 * lint-entry-kinds-complete — every entry kind declares all four BINDING cells from the vocabularies, the unknown
 * kind refuses, and every lane a manifest appends to is a declared, accepted kind.
 *
 * The entry-kind table (`ENTRY_KINDS`, `packages/item-store/src/entryKinds.js`) is the one declaration of how a
 * logged entry behaves — and, since 2026-09-15, who must have signed it (`signs`), what it is about (`subject`),
 * which verifier a receiver folds it with (`accepts`) and whether a person's own devices carry it (`syncPolicy`). A
 * row missing a cell, or naming a level no vocabulary has, is a door with no declared lock; an undeclared kind must
 * be REFUSED by construction (`UNKNOWN_KIND` accepts none). Read statically, off disk, like every tier-1 lint here.
 *
 *   1. every ENTRY_KINDS row passes a binding: `LOCAL_BINDING`, `CIRCLE_BINDING(…)`, or an object naming all four
 *      cells, and every `SIGNS.X` / `SUBJECT.X` / `ACCEPTS.X` / `SYNC.X` it uses exists in that vocabulary;
 *   2. `UNKNOWN_KIND` is the local binding (accepts none);
 *   3. every manifest `appends: [{ lane: X_LANE, … }]` names a lane whose kind is a declared row with accepts ≠ none.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const KINDS_FILE = 'packages/item-store/src/entryKinds.js';
const MANIFEST_GLOB = "apps/basis/src/v2/*Manifest.js";
const CELLS = ['signs', 'subject', 'accepts', 'syncPolicy'];
const VOCAB_OF = { signs: 'SIGNS', subject: 'SUBJECT', accepts: 'ACCEPTS', syncPolicy: 'SYNC' };

export function parseVocab(src, name) {
  const body = src.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`))?.[1];
  if (!body) throw new Error(`lint-entry-kinds-complete: vocabulary ${name} not found`);
  const out = {};
  for (const m of body.matchAll(/\b([A-Z_]+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** Each row's binding argument text (the fifth K argument), or null when the row passes none. */
export function parseRows(src) {
  const table = src.match(/export const ENTRY_KINDS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1];
  if (!table) throw new Error('lint-entry-kinds-complete: ENTRY_KINDS table not found — the parse needle moved');
  const rows = {};
  for (const m of table.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*K\(([^\n]*)\)\s*,?\s*(?:\/\/.*)?$/gm)) {
    const kind = m[1] ?? m[2];
    const args = m[3];
    // the four fixed args, then the binding — split at top level only
    const parts = []; let depth = 0, cur = '';
    for (const ch of args) { if (ch === '(' || ch === '{' || ch === '[') depth++; if (ch === ')' || ch === '}' || ch === ']') depth--; if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) parts.push(cur.trim());
    rows[kind] = parts.length >= 5 ? parts.slice(4).join(',').trim() : null;
  }
  return rows;
}

export function parseUnknown(src) {
  return src.match(/export const UNKNOWN_KIND = K\(([^\n]*)\);/)?.[1] ?? null;
}

/** The lanes manifests append to: `[{ file, laneConst, lane }]` (lane null when the constant is not in that file). */
export function parseManifestLanes(files, read) {
  const out = [];
  for (const f of files) {
    const src = read(f);
    const consts = {};
    for (const m of src.matchAll(/export const ([A-Z_]+_LANE) = '([^']+)';/g)) consts[m[1]] = m[2];
    for (const m of src.matchAll(/appends:\s*\[\s*\{\s*lane:\s*([A-Z_]+)/g)) out.push({ file: f, laneConst: m[1], lane: consts[m[1]] ?? null });
  }
  return out;
}

export function audit({ rows, unknown, vocab, manifestLanes }) {
  const problems = [];
  const check = (kind, binding) => {
    if (binding == null) { problems.push(`'${kind}': no binding — the four cells (${CELLS.join(' · ')}) are missing`); return; }
    if (/^LOCAL_BINDING$/.test(binding)) return;
    if (/^CIRCLE_BINDING\(/.test(binding)) { checkTokens(kind, binding); return; }
    if (/^\{[\s\S]*\}$/.test(binding)) {
      for (const c of CELLS) if (!new RegExp(`\\b${c}\\s*:`).test(binding)) problems.push(`'${kind}': binding lacks the '${c}' cell`);
      checkTokens(kind, binding);
      return;
    }
    problems.push(`'${kind}': binding '${binding}' is not LOCAL_BINDING, CIRCLE_BINDING(…) or an object naming the four cells`);
  };
  const checkTokens = (kind, text) => {
    for (const [cell, name] of Object.entries(VOCAB_OF)) {
      for (const m of text.matchAll(new RegExp(`\\b${name}\\.([A-Z_]+)`, 'g'))) {
        if (!(m[1] in vocab[name])) problems.push(`'${kind}': ${cell} names ${name}.${m[1]}, which the ${name} vocabulary does not have`);
      }
    }
  };
  for (const [kind, binding] of Object.entries(rows)) check(kind, binding);
  if (unknown == null) problems.push('UNKNOWN_KIND: not found');
  else if (!/LOCAL_BINDING\s*$/.test(unknown)) problems.push(`UNKNOWN_KIND: must be the local binding (accepts none — an undeclared kind is refused by construction), got: ${unknown}`);
  for (const l of manifestLanes) {
    if (!l.lane) { problems.push(`${l.file}: appends to ${l.laneConst}, which that manifest does not define`); continue; }
    if (!(l.lane in rows)) { problems.push(`${l.file}: appends to lane '${l.lane}', which is not a declared ENTRY_KINDS row`); continue; }
    const b = rows[l.lane] ?? '';
    if (/^LOCAL_BINDING$/.test(b) || /accepts:\s*ACCEPTS\.NONE/.test(b)) problems.push(`${l.file}: appends to lane '${l.lane}', whose kind accepts nothing from a peer`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const src = read(KINDS_FILE);
  const vocab = Object.fromEntries(Object.values(VOCAB_OF).map((n) => [n, parseVocab(src, n)]));
  const manifests = execSync(`git ls-files '${MANIFEST_GLOB}'`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const problems = audit({ rows: parseRows(src), unknown: parseUnknown(src), vocab, manifestLanes: parseManifestLanes(manifests, read) });
  if (problems.length) {
    console.error(`\n✗ lint:entry-kinds-complete — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\n   Every entry kind declares who signs it, what it is about, which verifier accepts it and whether own');
    console.error('   devices carry it; the unknown kind refuses; a manifest appends only to declared, accepted lanes.\n');
    process.exit(1);
  }
  const n = Object.keys(parseRows(src)).length;
  console.log(`✓ lint:entry-kinds-complete: ${n} kind(s) carry all four binding cells; UNKNOWN_KIND refuses; ${manifests.length} manifest(s) append to declared lanes.`);
}
