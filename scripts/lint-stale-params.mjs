#!/usr/bin/env node
/**
 * lint-stale-params — a REGISTERED param that NOTHING reads is dead (the #36 fork of lint-unreached-exports).
 *
 * ── Why this guard exists ────────────────────────────────────────────────────────────────────────────
 * The parameter register (#36) puts every tunable in one discoverable place via `param({ … })` at its
 * declaration site — the same benefit the locale files give strings. That benefit only holds if the register
 * cannot silently accumulate params nobody consumes: a declared-but-unread param is the parameter-shaped
 * version of the inert seam `lint-unreached-exports` catches, and it reads as configurability in every doc
 * that cites it while doing nothing. So: a param whose value is never read is DEBT — delete it or wire it.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────────────────────
 * The census is STATIC, from source (decision A: `param()` mutates no runtime global — the declarations are
 * read off disk here, exactly as `lint-unreached-exports` reads exports). For each
 * `export const NAME = param({ key:'…', scope:'…', kind:'…', … })` in tracked, non-test source, the param is
 * READ if its bound const NAME is referenced anywhere else, OR its `key` string appears anywhere else (a
 * `register.valueOf('key')` lookup / a settings-form projection). Either consumption style counts.
 *
 * ── Deliberately text-level + under-reporting ────────────────────────────────────────────────────────
 * Like its parent, this is a text scan, not a resolver — it cannot see dynamic key lookups, so it is tuned to
 * UNDER-report: any appearance of the name or key outside the declaration counts as read, even in a comment.
 * A false "read" is a missed finding; a false "unread" would train people to ignore the guard, and that is
 * the worse failure. Known-unread params are baselined (green day one); a NEW unread param fails.
 *
 *   node scripts/lint-stale-params.mjs            check (exit 1 on anything new)
 *   node scripts/lint-stale-params.mjs --update   rewrite the baseline from what is on disk now
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const BASELINE = path.join(ROOT, 'scripts', 'stale-params-baseline.json');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = () => sh('git ls-files').split('\n').filter(Boolean);

const isTest = (f) => /(^|\/)(test|tests|e2e|test-browser|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isVendored = (f) => /(^|\/)vendor\//.test(f) || /\.min\.js$/.test(f) || f.includes('/node_modules/');
const isSource = (f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f) && !isVendored(f);

// Every `const NAME = param({ key:'…', scope:'…', kind:'…', … })` — the declaration form the register helper
// forces, exported OR module-private (a param is a param either way; an unread private one is just as dead).
// `param()` from the item-store substrate itself is the helper, not a param — its definition is
// `export function param`, which this `const … = param(` shape does not match.
const DECL_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*param\(\s*\{([\s\S]*?)\}\s*\)/g;
const field = (body, name) => body.match(new RegExp(`\\b${name}\\s*:\\s*(?:PARAM_[A-Z]+\\.[A-Z]+|['"]([^'"]+)['"])`))?.[1] ?? null;
// Strip comments before the DECLARATION scan so a docstring EXAMPLE of the `param({…})` form (this guard's own
// header, params.js's) is not miscounted as a real declaration. Reachability still scans full content (a name
// mentioned in a comment counts as read — the deliberate under-report bias, same as the parent guard).
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const files = tracked().filter(isSource);
const contentByFile = new Map();
for (const f of files) { try { contentByFile.set(f, readFileSync(path.join(ROOT, f), 'utf8')); } catch { /* skip */ } }

/** Collect every declared param: { file, name, key }. */
const params = [];
for (const [f, src] of contentByFile) {
  for (const m of stripComments(src).matchAll(DECL_RE)) {
    const name = m[1];
    const key = field(m[2], 'key');
    if (!key) continue;   // a real param spec always carries a `key: '…'` string literal — no key ⇒ not a declaration
    params.push({ file: f, name, key, decl: m[0] });
  }
}

/** A param is READ if its const NAME or its key string appears anywhere OTHER than its own declaration. */
function isRead(p) {
  const nameRe = new RegExp(`\\b${p.name.replace(/[$]/g, '\\$')}\\b`);
  const keyRe = new RegExp(p.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  for (const [f, content] of contentByFile) {
    if (f === p.file) {
      // Same file: strip the declaration itself, then look for another mention of the name or key.
      const rest = content.replace(p.decl, '');
      if (nameRe.test(rest) || keyRe.test(rest)) return true;
    } else if (nameRe.test(content) || keyRe.test(content)) {
      return true;
    }
  }
  return false;
}

const unread = params.filter((p) => !isRead(p)).map((p) => `${p.file}:${p.name}`).sort();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    $schema: 'stale-params-baseline/v0',
    description:
      'CEILING of registered params (`param({…})`) whose value nothing reads. A param here is DEBT: wire it '
      + '(read its value) or delete it. Removing entries is always allowed; adding one needs a reason in review.',
    total: unread.length,
    params: unread,
  }, null, 2)}\n`);
  console.log(`✓ baseline updated: ${unread.length} unread param(s), ${params.length} declared → ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

let known = new Set();
try { known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).params ?? []); } catch { /* none yet */ }
const fresh = unread.filter((k) => !known.has(k));

if (fresh.length) {
  console.error(`\n✗ lint:stale-params — ${fresh.length} registered param(s) that NOTHING reads:\n`);
  for (const k of fresh) console.error(`   - ${k}`);
  console.error(`
A param declared with param({…}) but whose value nothing reads is DEAD CONFIG — it reads as a tunable in every
doc that cites the register, and it does nothing. Fix, in order of preference:
  1. READ it — consume its value (its const, or register.valueOf('<key>')). That is what makes it a param.
  2. DELETE it — if nothing needs it, drop the declaration.
  3. Baseline it (--update) WITH A REASON in review, if it is a deliberate not-yet-wired declaration.
`);
  process.exit(1);
}

if (unread.length) {
  console.warn(`⚠ lint:stale-params — ${unread.length} known unread param(s) carried (declared but unread — wire or delete).`);
}
console.log(`✓ lint:stale-params: ${params.length} declared param(s), no newly-unread.`);
