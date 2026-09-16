#!/usr/bin/env node
// Fitness guard: a lane module never names the profile identity — a statement on a lane signs with the
// per-circle key (or the device's delegation key), and a door on a lane admits those, never the shared
// profile key.
//
// Why it exists: on 2026-09-14 the revoke walk found that own-device traffic and every lane's catch-up
// request spoke as the profile key — the one key a revoked device keeps forever — and were refused at
// every member's gate, so member-to-member catch-ups had never served. It was fixed door by door. Nothing
// declared which key a lane should use, so nothing had failed when the wrong one crept in. This guard is
// the declaration: the lane modules below may not reference the profile identity's identifiers at all.
// Comments are ignored (explaining WHY NOT is allowed); an ALLOWED row carries a deliberate exception
// with its reason, which is the sentence review should read.
//
// Usage:
//   node scripts/lint-lanes-sign-per-circle.mjs        # exit 1 on any hit

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/** The lane modules: everything that signs, fans, serves or admits a statement between devices. */
export const LANE_MODULES = [
  'apps/basis/src/v2/chatRail.js',
  'apps/basis/src/v2/taskRail.js',
  'apps/basis/src/v2/grantsRail.js',
  'apps/basis/src/v2/membershipRail.js',
  'apps/basis/src/v2/keyRail.js',
  'apps/basis/src/v2/circleEntryRail.js',
  'apps/basis/src/v2/governanceAppWiring.js',
  'apps/basis/src/v2/governanceCatchUp.js',
  'apps/basis/src/v2/frontierReplay.js',
  'apps/basis/src/v2/contactTurnFan.js',
  'apps/basis/src/v2/knownPeersSync.js',
  'apps/basis/src/v2/circleLanes.js',
  'apps/basis/src/v2/rosterSeed.js',
  'apps/basis/src/v2/circleAddressAnnounce.js',
];

/** Identifiers that mean "the shared profile identity" in this codebase. Exact words. */
export const FORBIDDEN = ['chatId', 'profileIdentity', 'agentIdentity', 'ownerRoot', 'defaultProfileSeed', 'deriveAgentSeed', 'profileSeed', 'custodySeed'];

/** Deliberate exceptions: `{ '<file>': { '<token>': '<reason>' } }`. Empty on purpose — add a row with a reason. */
export const ALLOWED = {};

/** Code only: block and line comments blanked, and the BODIES of strings and template literals too — a
 *  vault key named after the profile identity is not a signing use. Line structure is preserved. */
export function stripComments(src) {
  let out = ''; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += ' '.repeat(end - i); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j += 1; j += 1; }
      out += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + (j < n ? c : ''); i = j + 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** The check, pure for the self-test: `{ hits: [{file, token, line}], missing: [file] }`. */
export function auditLaneModules({ files = LANE_MODULES, read, exists = () => true, forbidden = FORBIDDEN, allowed = ALLOWED } = {}) {
  const hits = []; const missing = [];
  for (const f of files) {
    if (!exists(f)) { missing.push(f); continue; }
    const code = stripComments(read(f));
    const lines = code.split('\n');
    for (const token of forbidden) {
      if (allowed[f]?.[token]) continue;
      const re = new RegExp(`\\b${token}\\b`);
      lines.forEach((l, idx) => { if (re.test(l)) hits.push({ file: f, token, line: idx + 1 }); });
    }
  }
  return { hits, missing };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const { hits, missing } = auditLaneModules({
    read: (f) => readFileSync(path.join(ROOT, f), 'utf8'),
    exists: (f) => existsSync(path.join(ROOT, f)),
  });
  if (missing.length) {
    console.error(`\n✗ lint:lanes-sign-per-circle — ${missing.length} lane module(s) in the list no longer exist: ${missing.join(', ')}\n   Update LANE_MODULES (this guard) — a stale list guards nothing.\n`);
    process.exit(1);
  }
  if (hits.length) {
    console.error(`\n✗ lint:lanes-sign-per-circle — ${hits.length} reference(s) to the profile identity in a lane module:\n`);
    for (const h of hits) console.error(`   - ${h.file}:${h.line}  ${h.token}`);
    console.error('\n   A lane signs with the per-circle key or the device\'s delegation key and admits those; the shared\n   profile key is what a revoked device keeps. If this one is deliberate, add an ALLOWED row with the reason.\n');
    process.exit(1);
  }
  const allowedCount = Object.values(ALLOWED).reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(`✓ lint:lanes-sign-per-circle: ${LANE_MODULES.length} lane module(s) name no profile identity (${allowedCount} allowed exception(s)).`);
}
