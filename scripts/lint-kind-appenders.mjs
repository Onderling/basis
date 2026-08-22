#!/usr/bin/env node
/**
 * lint-kind-appenders — every declared entry kind must have a production APPENDER.
 *
 * ── Why this guard exists ────────────────────────────────────────────────────────────────────────────
 * The entry-kind table (`ENTRY_KINDS` in `@onderling/item-store`) is the log's one behaviour table: lane,
 * wake rule, retention, auditability all key off the KIND. A kind declared there with NO production write
 * path is the taxonomy LOOKING complete while the runtime routes around the log — exactly how the
 * `'key-event'` row sat reserved for a month while the sealed-key flow lived in a session-scoped in-memory
 * side store with no signature, no authority and no catch-up (found 2026-08-22, Frits' challenge). The
 * architecture doc's mismatch section asked for "each row a guard (fail-until-built)"; this is that guard
 * for the kind table.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────────────────────
 * The kind list is parsed from `entryKinds.js` (static, off disk — same stance as lint-stale-params). Each
 * kind must have a row in the APPENDERS map below naming its production write path: an evidence file that
 * must exist and contain the evidence needle. Three outcomes:
 *   • evidence present            → green;
 *   • row marked `pending`        → carried loudly as FAIL-UNTIL-BUILT debt (the build that lands the
 *                                   writer DELETES the pending row — never add one without a plan pointer);
 *   • kind with NO row, a row for a kind no longer in the table, or evidence that no longer holds → RED.
 * So a NEW kind cannot land without naming what writes it, and evidence rots loudly instead of silently.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const KINDS_FILE = 'packages/item-store/src/entryKinds.js';

/**
 * kind → its production appender: `{file, needle}` (file exists AND contains needle), or
 * `{pending: '<reason + plan pointer>'}` for a declared-but-unwritten kind carried as explicit debt.
 */
export const APPENDERS = {
  'chat-message':    { file: 'apps/basis/src/v2/chatRail.js', needle: 'CHAT_LANE' },
  task:              { file: 'apps/basis/src/v2/taskRail.js', needle: 'TASK_LANE' },
  ask:               { file: 'apps/basis/src/core/agent/realAgent.js', needle: "'ask'" },
  offer:             { file: 'apps/basis/src/core/agent/realAgent.js', needle: "'offer'" },
  lend:              { file: 'apps/basis/web/v2/circleNoticeboard.js', needle: "'lend'" },
  governance:        { file: 'apps/basis/src/v2/governanceAppWiring.js', needle: 'GOVERNANCE_LANE' },
  report:            { file: 'apps/basis/src/feedback/feedbackSurface.js', needle: "'report'" },
  'roster-updated':  { file: 'packages/circles/src/circleRoster.js', needle: "'roster-updated'" },
  'delivery-state':  { file: 'apps/basis/src/v2/chatRail.js', needle: "'delivery-state'" },
  'key-event':       { file: 'apps/basis/src/v2/keyRail.js', needle: 'KEY_LANE' },
  membership:        { file: 'apps/basis/src/v2/membershipRail.js', needle: 'MEMBERSHIP_LANE' },
  grants:            { file: 'apps/basis/src/v2/grantsRail.js', needle: 'GRANTS_LANE' },
  'agent-action':    { file: 'apps/basis/src/core/agent/realAgent.js', needle: 'agent-action' },
  'settings-change': { file: 'apps/basis/src/core/agent/realAgent.js', needle: 'settings-change' },
  'audit-summary':   { file: 'apps/basis/src/eventLog.js', needle: 'audit-summary' },
};

/** Parse the declared kind keys out of the ENTRY_KINDS table source. Exported for the self-test. */
export function parseKinds(src) {
  const table = src.match(/export const ENTRY_KINDS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1];
  if (!table) throw new Error('lint-kind-appenders: ENTRY_KINDS table not found — the parse needle moved');
  const kinds = [];
  for (const m of table.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*K\(/gm)) {
    kinds.push(m[1] ?? m[2]);
  }
  return kinds;
}

/**
 * The check, pure for the self-test: returns `{missing, stale, broken, pending}`.
 * @param {object} a
 * @param {string[]} a.kinds        declared kind keys
 * @param {object}   a.appenders    the APPENDERS-shaped map
 * @param {(file:string)=>boolean}  a.exists
 * @param {(file:string)=>string}   a.read
 */
export function auditKinds({ kinds, appenders, exists, read }) {
  const missing = kinds.filter((k) => !(k in appenders));
  const stale = Object.keys(appenders).filter((k) => !kinds.includes(k));
  const broken = [];
  const pending = [];
  for (const k of kinds) {
    const row = appenders[k];
    if (!row) continue;
    if (row.pending) { pending.push([k, row.pending]); continue; }
    if (!exists(row.file)) { broken.push([k, `evidence file missing: ${row.file}`]); continue; }
    if (!read(row.file).includes(row.needle)) broken.push([k, `needle "${row.needle}" no longer in ${row.file}`]);
  }
  return { missing, stale, broken, pending };
}

// ── run (skipped when imported by the self-test) ─────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const kinds = parseKinds(readFileSync(path.join(ROOT, KINDS_FILE), 'utf8'));
  const { missing, stale, broken, pending } = auditKinds({
    kinds,
    appenders: APPENDERS,
    exists: (f) => existsSync(path.join(ROOT, f)),
    read: (f) => readFileSync(path.join(ROOT, f), 'utf8'),
  });

  let failed = false;
  if (missing.length) {
    failed = true;
    console.error(`\n✗ lint:kind-appenders — ${missing.length} declared kind(s) with NO appender row:\n`);
    for (const k of missing) console.error(`   - '${k}'`);
    console.error('\n   A kind in ENTRY_KINDS must name its production write path in APPENDERS (this guard),');
    console.error('   or be carried as an explicit `pending` row with a plan pointer. Declared-but-unwritten');
    console.error('   is how the key-event drift hid for a month.\n');
  }
  if (stale.length) {
    failed = true;
    console.error(`\n✗ lint:kind-appenders — ${stale.length} APPENDERS row(s) for kind(s) no longer declared: ${stale.map((k) => `'${k}'`).join(', ')}\n`);
  }
  if (broken.length) {
    failed = true;
    console.error(`\n✗ lint:kind-appenders — ${broken.length} appender evidence row(s) no longer hold:\n`);
    for (const [k, why] of broken) console.error(`   - '${k}': ${why}`);
    console.error('\n   The write path moved — repoint the evidence at where the kind is appended now.\n');
  }
  if (failed) process.exit(1);

  for (const [k, why] of pending) {
    console.warn(`⚠ lint:kind-appenders — FAIL-UNTIL-BUILT: '${k}' — ${why}`);
  }
  console.log(`✓ lint:kind-appenders: ${kinds.length} declared kind(s), ${pending.length} carried as pending, rest have verified appenders.`);
}
