#!/usr/bin/env node
/**
 * lint-catalogue-ops — every op in every app manifest is named on exactly ONE page of the functionality catalogue.
 *
 * The catalogue (`docs/catalogue/`) is per capability: what a person can do in an area, where it lives, what proves it.
 * Its use is ruling on absence: before "not built", read the area's page. That only works when every op HAS a page, and
 * one: an op on no page is invisible to the reader, an op on two pages has two answers.
 *
 * A page declares its ops in one machine-readable block (the prose names them for people):
 *
 *   <!-- catalogue-ops
 *   tasks: addTask claimTask completeTask
 *   household: addItem
 *   -->
 *
 * Red when: an op is named on two pages · a page names an op no manifest declares · an op is on no page and not in the
 * baseline · a baseline entry is now on a page or no longer exists (the baseline only shrinks; `--update` rewrites it).
 * The baseline (`scripts/catalogue-ops-baseline.json`) is the ops of the areas whose page is still owed: debt, visible.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allManifests } from '../apps/basis/src/v2/manifestSources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGES = path.join(ROOT, 'docs/catalogue');
const BASELINE = path.join(HERE, 'catalogue-ops-baseline.json');

/** The ops a page's `catalogue-ops` blocks name, as `app.op`. */
export function opsOnPage(text) {
  const out = [];
  for (const m of String(text).matchAll(/<!--\s*catalogue-ops\s*\n([\s\S]*?)-->/g)) {
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!mm) continue;
      for (const op of mm[2].split(/\s+/).filter(Boolean)) out.push(`${mm[1]}.${op}`);
    }
  }
  return out;
}

/** Every op the manifests declare, as `app.op`. */
export function declaredOps(manifests = allManifests()) {
  const out = new Set();
  for (const m of manifests) for (const op of m?.operations ?? []) if (m?.app && op?.id) out.add(`${m.app}.${op.id}`);
  return out;
}

/**
 * @param {{ declared: Set<string>, pages: Record<string, string[]>, baseline: string[] }} a
 * @returns {string[]} problems
 */
export function auditCatalogue({ declared, pages, baseline }) {
  const problems = [];
  const where = new Map();
  for (const [page, ops] of Object.entries(pages)) {
    for (const op of ops) {
      if (!declared.has(op)) problems.push(`${page} names ${op}, which no manifest declares`);
      where.set(op, [...(where.get(op) ?? []), page]);
    }
  }
  for (const [op, ps] of where) if (ps.length > 1) problems.push(`${op} is named on ${ps.length} pages (${ps.join(', ')}); one page per op`);
  const owed = new Set(baseline);
  for (const op of declared) if (!where.has(op) && !owed.has(op)) problems.push(`${op} is on no catalogue page (add it to its area's catalogue-ops block)`);
  for (const op of owed) {
    if (where.has(op)) problems.push(`baseline lists ${op}, which is now on ${where.get(op).join(', ')}: run with --update`);
    else if (!declared.has(op)) problems.push(`baseline lists ${op}, which no manifest declares any more: run with --update`);
  }
  return problems;
}

function readPages() {
  const pages = {};
  if (!existsSync(PAGES)) return pages;
  for (const f of readdirSync(PAGES).filter((x) => x.endsWith('.md') && x !== 'README.md')) pages[f] = opsOnPage(readFileSync(path.join(PAGES, f), 'utf8'));
  return pages;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const declared = declaredOps();
  const pages = readPages();
  if (process.argv.includes('--update')) {
    const named = new Set(Object.values(pages).flat());
    const owed = [...declared].filter((op) => !named.has(op)).sort();
    writeFileSync(BASELINE, `${JSON.stringify({ owed }, null, 2)}\n`);
    console.log(`lint-catalogue-ops: baseline rewritten, ${owed.length} op(s) owed a page`);
    process.exit(0);
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).owed ?? [] : [];
  const problems = auditCatalogue({ declared, pages, baseline });
  if (problems.length) {
    console.error(`✖ lint-catalogue-ops: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    process.exit(1);
  }
  const named = Object.values(pages).flat().length;
  console.log(`✓ lint-catalogue-ops: ${named} op(s) on ${Object.keys(pages).length} page(s), ${baseline.length} owed a page (baseline)`);
}
