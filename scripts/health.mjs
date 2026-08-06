#!/usr/bin/env node
/**
 * health.mjs — the `/health` op (wave 2): the guard run exposed, across tiers, in one place.
 *
 * "Retention of what?" for the whole system: not one number. Three tiers a maintainer wants at a glance —
 *   1. GUARDS   — every `scripts/lint-*.mjs` design-claim guard, green/red (this is `guard-status`).
 *   2. SURFACES — ops missing a projection (from the surface-coverage snapshot): where the manifest declares
 *                 an op the shells don't yet paint.
 *   3. SHELLS   — the shell god-file line counts (they should FALL as logic extracts into shared `src/`).
 *
 * `npm run health`. Exits nonzero iff a GUARD is red (a design claim is violated). Surfaces + shell sizes are
 * INFORMATIONAL debt being tracked down, not gates — reported, never failed on.
 *
 * Not a manifest op / in-app skill: these are static/dev-time signals (a guard run, manifest coverage, source
 * line counts) a deployed browser app cannot compute about itself. It is the CI/maintainer health command.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scriptGuards } from './guard-index.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Tier 1 — run each script guard, green/red. */
export function guardStatus() {
  return scriptGuards().map((g) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, g.file)], { cwd: ROOT, encoding: 'utf8' });
    return { name: g.name, claim: g.claim, ok: r.status === 0 };
  });
}

/** Tier 2 — the surface-coverage snapshot: total ops + ops missing each projection. */
export function surfaceCoverage() {
  try {
    const md = readFileSync(path.join(ROOT, 'apps/basis/docs/surface-coverage.md'), 'utf8');
    const total = md.match(/\*\*totals\*\*\s*\|\s*(\d+)\s*ops/)?.[1] ?? '?';
    const missing = {};
    for (const k of ['gate', 'inline', 'chat']) {
      missing[k] = md.match(new RegExp(`\\*\\*missing ${k}\\*\\*\\s*\\((\\d+)/`))?.[1] ?? '?';
    }
    return { total, missing };
  } catch { return null; }
}

/** Tier 3 — the largest shell files by line count (the god-files logic should be leaving). */
export function shellSizes(top = 6) {
  const files = [];
  const skip = new Set(['node_modules', 'dist', 'build', 'coverage']);
  const walk = (dir) => {
    let names; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (skip.has(n)) continue;
      const full = path.join(dir, n);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(n) && !/\.test\.[cm]?jsx?$/.test(n)) {
        files.push({ file: path.relative(ROOT, full), lines: readFileSync(full, 'utf8').split('\n').length });
      }
    }
  };
  for (const base of ['apps/basis/web', 'apps/basis-mobile/src']) walk(path.join(ROOT, base));
  return files.sort((a, b) => b.lines - a.lines).slice(0, top);
}

function main() {
  const guards = guardStatus();
  const red = guards.filter((g) => !g.ok);
  const cov = surfaceCoverage();
  const shells = shellSizes();

  const out = [];
  out.push('\n══ health ══════════════════════════════════════════════════════');
  out.push(`\nGUARDS · ${guards.length - red.length}/${guards.length} green`);
  for (const g of guards) out.push(` ${g.ok ? '✓' : '✗'} ${g.name.padEnd(20)} ${g.claim}`);
  out.push('\nSURFACES · ops missing a projection (surface-coverage snapshot)');
  out.push(cov
    ? `  ${cov.total} ops · missing gate ${cov.missing.gate} · missing inline ${cov.missing.inline} · missing chat ${cov.missing.chat}`
    : '  (surface-coverage snapshot not found — run `npm run coverage` in apps/basis)');
  out.push('\nSHELLS · largest god-files (line counts should FALL as logic extracts to shared src/)');
  for (const s of shells) out.push(`  ${String(s.lines).padStart(6)}  ${s.file}`);
  out.push(`\n════════════════════════════════ ${red.length ? `${red.length} GUARD(S) RED` : 'all guards green'} ══\n`);
  console.log(out.join('\n'));
  process.exit(red.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
