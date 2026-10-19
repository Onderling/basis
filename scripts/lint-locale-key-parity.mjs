#!/usr/bin/env node
/**
 * lint-locale-key-parity — what one shell SAYS, the other says too, or the difference is a decision.
 *
 * A screen painted by hand (DOM on web, JSX on mobile) is invisible to the projector guards: nothing declares what it
 * shows, so a button, a line or a whole screen on one shell only goes unnoticed. Five did (the buttons assessment,
 * 2026-10-19: a file that could not be saved, the outbound shares and a removed member's revoke, a vote's deadline,
 * the reveal badge, a list's audience). What a screen shows passes through `t('circle.…')`, so the keys each shell
 * uses are the cheap fact to compare (Frits 2026-10-20: "mobile parity shouldn't be thin").
 *
 * Web = `apps/basis/web` + `apps/basis/src/web`; mobile = `apps/basis-mobile/src` + `apps/basis/src/rn`; the rest of
 * `apps/basis/src` is shared and counts for both. A `circle.*` key one shell uses and the other does not must be
 * DECLARED — a row in `docs/conventions/web-mobile-exceptions.md` that names the key or its prefix in backticks
 * (`circle.firstRun.*`) — or be in the BASELINE below, which only shrinks: red on a NEW one-sided key, red on a
 * baselined key that is no longer one-sided (remove it). Keys built at run time (`circle.scope.${x}`) are not seen.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/conventions/web-mobile-exceptions.md';
const BASELINE = 'scripts/locale-key-parity.baseline.json';
const WEB = ['apps/basis/web', 'apps/basis/src/web'];
const MOBILE = ['apps/basis-mobile/src', 'apps/basis/src/rn'];
const SHARED = 'apps/basis/src';

/** The `circle.*` keys a file's text names: any quoted string that IS a key of the locale (`known`) — a key reaches a
 *  screen through `t('…')`, but also as a `labelKey`, in a map, or as an argument; all of those are what it shows. */
export function keysIn(text, known = null) {
  const found = [...String(text).matchAll(/['"`](circle\.[A-Za-z0-9_.-]+)['"`]/g)].map((m) => m[1]);
  return known ? found.filter((k) => known.has(k)) : found;
}

/** The key PREFIXES a file's text builds at run time (`circle.scope.${x}`, 'circle.scope.' + x): a shell that builds
 *  `circle.scope.<anything>` says every key under it. */
export function dynamicPrefixesIn(text) {
  return [...String(text).matchAll(/[`'"](circle\.[A-Za-z0-9_.-]+\.)(?:\$\{|['"]\s*\+)/g)].map((m) => m[1]);
}

/** The leaf keys of a locale bundle (`{circle: {a: {text}}}` → `circle.a`). */
export function localeKeys(bundle) {
  const out = new Set();
  const walkKeys = (o, p) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.text === 'string') { out.add(p); return; }
    for (const [k, v] of Object.entries(o)) walkKeys(v, p ? `${p}.${k}` : k);
  };
  walkKeys(bundle, '');
  return out;
}

/** The keys or key prefixes the exceptions table declares one-sided: backticked `circle.…` words in its rows. */
export function declaredKeys(doc) {
  const at = String(doc).indexOf('## Current listed exceptions');
  const table = at > -1 ? String(doc).slice(at) : '';
  return [...table.matchAll(/`(circle\.[A-Za-z0-9_.-]+(?:\.\*)?)`/g)].map((m) => m[1]);
}

/** Whether a declaration (a key, or `prefix.*`) covers a key. */
export function covers(decl, key) {
  return decl.endsWith('.*') ? key.startsWith(decl.slice(0, -1)) : decl === key;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'locales') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(m?js|jsx)$/.test(p) && !/\.test\./.test(p)) acc.push(p);
  }
  return acc;
}
let KNOWN = null;
const known = () => (KNOWN ??= (() => {
  const b = JSON.parse(readFileSync(path.join(ROOT, 'apps/basis/src/locales/circle.nl.json'), 'utf8'));
  const keys = localeKeys(b);
  // the bundle may or may not carry its `circle` root: keys are `circle.*` either way
  return new Set([...keys].map((k) => (k.startsWith('circle.') ? k : `circle.${k}`)));
})());
const filesOf = (dirs, skip = []) => dirs.flatMap((d) => walk(path.join(ROOT, d)))
  .filter((f) => !skip.some((s) => f.startsWith(path.join(ROOT, s) + path.sep)));
const keysOf = (dirs, skip = []) => {
  const files = filesOf(dirs, skip).map((f) => readFileSync(f, 'utf8'));
  const keys = new Set(files.flatMap((tx) => keysIn(tx, known())));
  // a prefix built at run time says every known key under it
  for (const pre of files.flatMap(dynamicPrefixesIn)) for (const k of known()) if (k.startsWith(pre)) keys.add(k);
  return keys;
};

/** The one-sided keys of the tree: `{ web: [...], mobile: [...] }`, each sorted. */
export function oneSided() {
  const shared = keysOf([SHARED], [...WEB, ...MOBILE]);
  const web = new Set([...keysOf(WEB), ...shared]);
  const mobile = new Set([...keysOf(MOBILE), ...shared]);
  return {
    web: [...web].filter((k) => !mobile.has(k)).sort(),
    mobile: [...mobile].filter((k) => !web.has(k)).sort(),
    both: [...web].filter((k) => mobile.has(k)).length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sides = oneSided();
  const declared = declaredKeys(readFileSync(path.join(ROOT, DOC), 'utf8'));
  const undeclared = (keys) => keys.filter((k) => !declared.some((d) => covers(d, k)));
  const now = { web: undeclared(sides.web), mobile: undeclared(sides.mobile) };
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(path.join(ROOT, BASELINE), JSON.stringify(now, null, 2) + '\n');
    console.log(`wrote ${BASELINE}: ${now.web.length} web-only, ${now.mobile.length} mobile-only (${sides.both} on both)`);
    process.exit(0);
  }
  const base = existsSync(path.join(ROOT, BASELINE)) ? JSON.parse(readFileSync(path.join(ROOT, BASELINE), 'utf8')) : { web: [], mobile: [] };
  const problems = [];
  for (const side of ['web', 'mobile']) {
    for (const k of now[side]) if (!base[side].includes(k)) problems.push(`NEW ${side}-only key \`${k}\` — paint it on the other shell, or declare it in ${DOC}`);
    for (const k of base[side]) if (!now[side].includes(k)) problems.push(`stale baseline entry \`${k}\` (${side}) — it is no longer one-sided or now declared: remove it from ${BASELINE}`);
  }
  if (problems.length) {
    console.error('lint-locale-key-parity:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-locale-key-parity: ${sides.both} keys on both shells; one-sided and undeclared, baselined: ${now.web.length} web · ${now.mobile.length} mobile (only shrinks)`);
}
