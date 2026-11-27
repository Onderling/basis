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
 * baseline · a baseline entry is now on a page or no longer exists (the baseline only shrinks; `--update` only removes).
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

/** The 1-based line in a page where its catalogue-ops block names `app.op` (null when not found). */
function lineOnPage(text, appOp) {
  const dot = appOp.indexOf('.');
  const app = appOp.slice(0, dot), op = appOp.slice(dot + 1);
  const i = String(text ?? '').split('\n').findIndex((l) => {
    const m = l.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    return m && m[1] === app && m[2].split(/\s+/).includes(op);
  });
  return i < 0 ? null : i + 1;
}

/**
 * @param {{ declared: Set<string>, pages: Record<string, string[]>, baseline: string[], texts?: Record<string, string> }} a
 *   texts: the pages' text by name, and the baseline file's as `baseline`, so a problem can name its line
 * @returns {string[]} problems: what is wrong (with file:line where there is one), then a Fix line
 */
export function auditCatalogue({ declared, pages, baseline, texts = {} }) {
  const problems = [];
  const onPage = (page, op) => { const l = lineOnPage(texts[page], op); return `docs/catalogue/${page}${l ? `:${l}` : ''}`; };
  const inBaseline = (op) => {
    const i = String(texts.baseline ?? '').split('\n').findIndex((l) => l.includes(`"${op}"`));
    return `scripts/catalogue-ops-baseline.json${i < 0 ? '' : `:${i + 1}`}`;
  };
  const RUN_UPDATE = 'Fix: run node scripts/lint-catalogue-ops.mjs --update (it only removes entries).';
  const where = new Map();
  for (const [page, ops] of Object.entries(pages)) {
    for (const op of ops) {
      if (!declared.has(op)) problems.push(`${onPage(page, op)}: names ${op}, which no manifest declares.\n    Fix: correct the op id to the one the manifest declares, or remove it from the block.`);
      where.set(op, [...(where.get(op) ?? []), page]);
    }
  }
  for (const [op, ps] of where) if (ps.length > 1) problems.push(`${op} is named on ${ps.length} pages (${ps.map((pg) => onPage(pg, op)).join(', ')}); one page per op.\n    Fix: keep it on the page of the area it belongs to and remove it from the other block(s).`);
  const owed = new Set(baseline);
  for (const op of declared) if (!where.has(op) && !owed.has(op)) problems.push(`${op} is on no catalogue page (an op a manifest declares; no file names it yet).\n    Fix: add it to the catalogue-ops block of its area's page in docs/catalogue/.`);
  for (const op of owed) {
    if (where.has(op)) problems.push(`${inBaseline(op)}: baseline lists ${op}, which is now on ${where.get(op).join(', ')}.\n    ${RUN_UPDATE}`);
    else if (!declared.has(op)) problems.push(`${inBaseline(op)}: baseline lists ${op}, which no manifest declares any more.\n    ${RUN_UPDATE}`);
  }
  return problems;
}

/**
 * What `--update` writes: the baseline with the entries that are now on a page, or no longer declared, REMOVED. It never
 * adds: a new op on no page stays red until it goes on its area's page (a page not written yet is started by that PR,
 * its five headings may be stubs, its block real). Rebuilding from scratch would let the debt grow silently.
 * @returns {string[]}
 */
export function shrunkBaseline({ declared, pages, baseline }) {
  const named = new Set(Object.values(pages).flat());
  return [...new Set(baseline)].filter((op) => declared.has(op) && !named.has(op)).sort();
}

function readPages(texts = {}) {
  const pages = {};
  if (!existsSync(PAGES)) return pages;
  for (const f of readdirSync(PAGES).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
    texts[f] = readFileSync(path.join(PAGES, f), 'utf8');
    pages[f] = opsOnPage(texts[f]);
  }
  return pages;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const declared = declaredOps();
  const texts = {};
  const pages = readPages(texts);
  if (process.argv.includes('--update')) {
    const before = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).owed ?? [] : [];
    const owed = shrunkBaseline({ declared, pages, baseline: before });
    writeFileSync(BASELINE, `${JSON.stringify({ owed }, null, 2)}\n`);
    console.log(`lint-catalogue-ops: baseline shrunk ${before.length} → ${owed.length} (it never grows: a new op goes on its area's page)`);
    process.exit(0);
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).owed ?? [] : [];
  if (existsSync(BASELINE)) texts.baseline = readFileSync(BASELINE, 'utf8');
  const problems = auditCatalogue({ declared, pages, baseline, texts });
  if (problems.length) {
    console.error(`✖ lint-catalogue-ops: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    process.exit(1);
  }
  const named = Object.values(pages).flat().length;
  console.log(`✓ lint-catalogue-ops: ${named} op(s) on ${Object.keys(pages).length} page(s), ${baseline.length} owed a page (baseline)`);
}
