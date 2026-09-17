#!/usr/bin/env node
/**
 * lint-rails-named-verifier — every signed rail is constructed with a NAMED binding verifier, and the name agrees
 * with what the entry-kind table says the lane ACCEPTS.
 *
 * The entry-kind table (`ENTRY_KINDS`, `packages/item-store/src/entryKinds.js`) declares per kind which verifier a
 * receiver folds it with (`accepts`). The rails choose their verifier at wiring time. Two layers, one fact: a rail
 * whose default verifier drifts from the table — or a rail composed with none — is a door with the wrong lock or no
 * lock, and nothing failed when the task lane's kind name disagreed with the table (2026-09-14). This guard reads
 * both statically, off disk, the stance every tier-1 lint here takes.
 *
 * Three rules:
 *   1. every rail module in RAILS names its verifier — the default expression the module falls back to, or, where
 *      the rail takes it from the caller, the ONE composition site that hands it a named one;
 *   2. that verifier's ACCEPTS level equals the table's `accepts` for the rail's lane kind;
 *   3. `makeCircleEntryRail(` is called only inside RAILS, and every such call passes `verifyBinding`.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const KINDS_FILE = 'packages/item-store/src/entryKinds.js';

/** Verifier function name → the ACCEPTS level it implements (the table's vocabulary). */
export const VERIFIER_ACCEPTS = Object.freeze({
  rosterBindingVerifier:     'roster-binding',
  membershipBindingVerifier: 'membership-binding',
  keyBindingVerifier:        'key-binding',
  deviceSetBindingVerifier:  'device-set',
});

/**
 * The rails. `lane` is the manifest's lane constant (resolved from `laneFile`), `verifierIn` the module whose
 * source must contain the named default; `composedIn` names the ONE site handing a named verifier to a rail
 * that takes it from the caller.
 */
export const RAILS = Object.freeze([
  { file: 'apps/basis/src/v2/chatRail.js',            laneFile: 'apps/basis/src/v2/chatManifest.js',       laneConst: 'CHAT_LANE' },
  { file: 'apps/basis/src/v2/taskRail.js',            laneFile: 'apps/basis/src/v2/taskManifest.js',       laneConst: 'TASK_LANE' },
  { file: 'apps/basis/src/v2/governanceAppWiring.js', laneFile: 'apps/basis/src/v2/governanceManifest.js', laneConst: 'GOVERNANCE_LANE' },
  { file: 'apps/basis/src/v2/membershipRail.js',      laneFile: 'apps/basis/src/v2/membershipManifest.js', laneConst: 'MEMBERSHIP_LANE' },
  { file: 'apps/basis/src/v2/keyRail.js',             laneFile: 'apps/basis/src/v2/keyManifest.js',        laneConst: 'KEY_LANE' },
  { file: 'apps/basis/src/v2/grantsRail.js',          laneFile: 'apps/basis/src/v2/grantsManifest.js',     laneConst: 'GRANTS_LANE',
    composedIn: { file: 'apps/basis/src/core/agent/realAgent.js', handle: 'deviceSetVerifier' } },
]);

/** The `accepts` level per kind, parsed from the table source (the same shapes lint-entry-kinds-complete reads). */
export function parseAccepts(src) {
  const table = src.match(/export const ENTRY_KINDS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1];
  if (!table) throw new Error('lint-rails-named-verifier: ENTRY_KINDS table not found — the parse needle moved');
  const vocab = parseVocab(src, 'ACCEPTS');
  const out = {};
  for (const m of table.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*K\(([^\n]*)\)\s*,?\s*(?:\/\/.*)?$/gm)) {
    const kind = m[1] ?? m[2];
    const args = m[3];
    const explicit = args.match(/accepts:\s*ACCEPTS\.([A-Z_]+)/);
    if (explicit) out[kind] = vocab[explicit[1]] ?? `<unknown ACCEPTS.${explicit[1]}>`;
    else if (/CIRCLE_BINDING\(/.test(args)) out[kind] = vocab.ROSTER;
    else if (/LOCAL_BINDING/.test(args)) out[kind] = vocab.NONE;
    else out[kind] = null;
  }
  return out;
}

/** `export const NAME = Object.freeze({ KEY: 'value', … })` → { KEY: 'value' }. */
export function parseVocab(src, name) {
  const body = src.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`))?.[1];
  if (!body) throw new Error(`lint-rails-named-verifier: vocabulary ${name} not found`);
  const out = {};
  for (const m of body.matchAll(/\b([A-Z_]+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** The lane kind a manifest names: `export const X_LANE = 'kind';`. */
export function parseLane(src, laneConst) {
  return src.match(new RegExp(`export const ${laneConst} = '([^']+)';`))?.[1] ?? null;
}

/** The named verifier a rail module defaults to: `verifyBinding ?? <name>(`. Null when it names none. */
export function namedDefault(src) {
  const m = src.match(/verifyBinding\s*\?\?\s*([A-Za-z]+BindingVerifier)\(/);
  return m ? m[1] : null;
}

/** The named verifier a composition site hands over: `<handle> = <name>(` and `verifyBinding: <handle>`. */
export function namedAtComposition(src, handle) {
  const built = src.match(new RegExp(`\\b${handle}\\s*=\\s*([A-Za-z]+BindingVerifier)\\(`));
  const handed = new RegExp(`verifyBinding:\\s*${handle}\\b`).test(src);
  return built && handed ? built[1] : null;
}

/** Every `makeCircleEntryRail(` call: the file it is in and whether its argument names `verifyBinding`. */
export function rawRailCalls(files, read) {
  const calls = [];
  for (const f of files) {
    const src = read(f);
    let at = 0;
    for (;;) {
      const i = src.indexOf('makeCircleEntryRail(', at);
      if (i < 0) break;
      if (src.slice(Math.max(0, i - 16), i).includes('function ')) { at = i + 1; continue; }   // the definition
      const argText = src.slice(i, src.indexOf('});', i) + 3);
      calls.push({ file: f, passesVerifier: /verifyBinding/.test(argText) });
      at = i + 1;
    }
  }
  return calls;
}

export function audit({ rails, accepts, read, exists, railCalls }) {
  const problems = [];
  for (const r of rails) {
    if (!exists(r.file)) { problems.push(`${r.file}: rail module missing`); continue; }
    const lane = exists(r.laneFile) ? parseLane(read(r.laneFile), r.laneConst) : null;
    if (!lane) { problems.push(`${r.laneFile}: ${r.laneConst} not found`); continue; }
    if (!(lane in accepts)) { problems.push(`${r.file}: lane kind '${lane}' is not a declared ENTRY_KINDS row`); continue; }
    let verifier = namedDefault(read(r.file));
    if (!verifier && r.composedIn) verifier = exists(r.composedIn.file) ? namedAtComposition(read(r.composedIn.file), r.composedIn.handle) : null;
    if (!verifier) { problems.push(`${r.file}: constructed with NO named verifier (no \`verifyBinding ?? <name>(\` default${r.composedIn ? `, and ${r.composedIn.file} hands it no \`${r.composedIn.handle} = <name>(\`` : ''})`); continue; }
    const level = VERIFIER_ACCEPTS[verifier];
    if (!level) { problems.push(`${r.file}: verifier '${verifier}' is not one of the named verifiers (${Object.keys(VERIFIER_ACCEPTS).join(', ')})`); continue; }
    if (accepts[lane] !== level) problems.push(`${r.file}: lane '${lane}' is folded with ${verifier} (${level}) but ENTRY_KINDS says accepts: ${accepts[lane]}`);
  }
  const known = new Set(rails.map((r) => r.file));
  for (const c of railCalls) {
    if (!known.has(c.file)) problems.push(`${c.file}: makeCircleEntryRail( called outside the RAILS table — a rail this guard does not know`);
    else if (!c.passesVerifier) problems.push(`${c.file}: makeCircleEntryRail( called without verifyBinding`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const exists = (f) => existsSync(path.join(ROOT, f));
  const files = execSync("git ls-files 'apps/basis/src/**/*.js'", { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const problems = audit({ rails: RAILS, accepts: parseAccepts(read(KINDS_FILE)), read, exists, railCalls: rawRailCalls(files, read) });
  if (problems.length) {
    console.error(`\n✗ lint:rails-named-verifier — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\n   Every signed rail names the verifier it folds with, and that name must agree with the entry-kind');
    console.error('   table\'s `accepts` for the lane. Fix the rail, the table, or the RAILS row — the doors and the declaration are one fact.\n');
    process.exit(1);
  }
  console.log(`✓ lint:rails-named-verifier: ${RAILS.length} rail(s) name their verifier and agree with the entry-kind table.`);
}
