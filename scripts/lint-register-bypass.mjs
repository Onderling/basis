#!/usr/bin/env node
/**
 * lint-register-bypass — a settable value has ONE home, and it is the register.
 *
 * `src/v2/paramsService.js` is where every settable value lives: read through `agent.getParamValue(key)`,
 * written through `callSkill('params','set-param')`. A shell that reaches past it into raw storage gets a
 * value that the settings screen cannot see, the other shell does not share, and nothing reconciles — two
 * homes for one setting, which is how a preference comes to mean different things on the same device.
 *
 * Three raw keys legitimately mirror a param, because they are read BEFORE the agent exists: the pre-paint
 * theme hook (it runs before any module loads, or the first frame flashes the wrong ground), i18n init, and
 * the transport connect. They are declared as data in `PARAM_PREBOOT_MIRRORS` beside the params themselves,
 * and every site that touches one carries `// pre-boot cache of <param.key>` naming what it mirrors. The
 * marker is not a mute button: it is the sentence a reader needs to know the value has an authority
 * elsewhere, and its count is printed so it can only ever fall.
 *
 * Note the pairing cannot be found by comparing strings — `basis.theme` mirrors `display.theme`, and the
 * names differ because the storage key predates the register and is a shared web↔mobile contract of its
 * own. That is exactly why the map is declared rather than inferred.
 *
 *   node scripts/lint-register-bypass.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const REGISTER = 'apps/basis/src/v2/paramsService.js';
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src'];

/**
 * The params the register owns, read from the register's own declarations. Two are declared through a
 * constant imported from the module that also owns the feature (`SURFACE_PREF_PARAM_KEY` and friends),
 * so the identifier is resolved against `apps/basis/src` rather than skipped — a param the guard cannot
 * see is a param it cannot protect, and those two are exactly the privacy-shaped ones.
 */
function ownedParams(src) {
  const owned = new Set([...src.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]));
  const idents = [...src.matchAll(/\{\s*key:\s*([A-Z][A-Z0-9_]*)\s*,/g)].map((m) => m[1]);
  if (idents.length) {
    const exported = execSync(
      `grep -rhn "export const [A-Z][A-Z0-9_]* = '" --include=*.js apps/basis/src | grep -v node_modules || true`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    const table = new Map(
      [...exported.matchAll(/export const ([A-Z][A-Z0-9_]*) = '([^']+)'/g)].map((m) => [m[1], m[2]]),
    );
    for (const id of idents) {
      const v = table.get(id);
      if (v) owned.add(v);
      else problems.push(`${REGISTER} declares a param as \`${id}\`, whose value this guard cannot find. `
        + 'Export it as a string constant from `apps/basis/src`, or inline the key.');
    }
  }
  return owned;
}

/** The declared pre-boot mirrors: storage key → param key. */
function declaredMirrors(src) {
  const block = src.match(/PARAM_PREBOOT_MIRRORS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!block) return null;
  const out = new Map();
  for (const m of block[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Every raw storage touch in the scanned trees. Matched on the storage API (`getItem` / `setItem` /
 * `removeItem`), not on the receiver's NAME: the shared pref modules take the store as a parameter
 * (`storage?.getItem(KEY)`, `AsyncStorage?.getItem(KEY)`) precisely so one module serves both shells,
 * and a guard keyed on the identifier `localStorage` sees none of them — which is most of what it is
 * here to watch.
 */
function rawTouches() {
  const cmd = `grep -rn "\\.\\(get\\|set\\|remove\\)Item(" `
    + `--include=*.js ${SCAN.join(' ')} | grep -v node_modules || true`;
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!out) return [];
  return out.split('\n')
    .filter((l) => !/\/test\/|\.test\.|__tests__/.test(l))
    .map((l) => {
      const m = l.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) return null;
      return { file: m[1], no: Number(m[2]), line: m[3] };
    })
    .filter(Boolean);
}

/**
 * The storage key a line touches. Most sites name it inline; the shared pref modules bind it to a
 * file-local constant first (`const STORAGE_KEY = 'cc.relayUrl'`), which is deliberate — one contract,
 * one name — so the constant is resolved against the file rather than treated as unreadable. A guard
 * that only saw string literals would have called the relay mirror dead and told us to delete it, which
 * is how a guard teaches the wrong lesson very confidently.
 */
function keyOf(line, consts) {
  const lit = line.match(/\.(?:get|set|remove)Item\(\s*'([^']+)'/);
  if (lit) return { key: lit[1], viaConst: null };
  const ident = line.match(/\.(?:get|set|remove)Item\(\s*([A-Za-z_$][\w$]*)/);
  if (ident && consts.has(ident[1])) return { key: consts.get(ident[1]), viaConst: ident[1] };
  return { key: null, viaConst: null };
}

/** `const NAME = 'literal'` / `export const NAME = 'literal'` declared in one file. */
function constsIn(src) {
  const out = new Map();
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'\s*;/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

const problems = [];
const registerSrc = read(REGISTER);
const owned = ownedParams(registerSrc);
const mirrors = declaredMirrors(registerSrc);

if (!mirrors) {
  problems.push(`${REGISTER} no longer declares PARAM_PREBOOT_MIRRORS — this guard reads it to tell a `
    + 'legitimate pre-boot cache from a bypass. Restore the map (it may be empty).');
}

/**
 * Is this touch marked? The marker sits on the line or just above it — or, when the site names a
 * constant, at the constant's declaration, which is where one marker covers every use of it.
 */
const markerFor = (src, no, param, viaConst) => {
  const lines = src.split('\n');
  const near = [lines[no - 1] ?? '', lines[no - 2] ?? '', lines[no - 3] ?? ''];
  if (near.some((l) => l.includes(`pre-boot cache of ${param}`))) return true;
  if (!viaConst) return false;
  const declAt = lines.findIndex((l) => new RegExp(`const\\s+${viaConst}\\s*=`).test(l));
  if (declAt < 0) return false;
  return [lines[declAt], lines[declAt - 1] ?? '', lines[declAt - 2] ?? '']
    .some((l) => l.includes(`pre-boot cache of ${param}`));
};

let markers = 0;
const seenMirrorKeys = new Set();

const constsCache = new Map();
const constsOf = (file) => {
  if (!constsCache.has(file)) constsCache.set(file, constsIn(read(file)));
  return constsCache.get(file);
};

for (const touch of rawTouches()) {
  const { key, viaConst } = keyOf(touch.line, constsOf(touch.file));
  if (!key) continue;
  const param = mirrors?.get(key);
  if (param) {
    seenMirrorKeys.add(key);
    if (markerFor(read(touch.file), touch.no, param, viaConst)) { markers += 1; continue; }
    problems.push(
      `${touch.file}:${touch.no} touches '${key}', the pre-boot cache of the register param '${param}', `
      + `without saying so. Add \`// pre-boot cache of ${param}\` on the line or just above it — a reader `
      + 'here has to know the register is the authority and this is only its mirror.',
    );
    continue;
  }
  // A raw key that IS a param key (or sits under one) is a straight bypass: the register can serve it.
  const collides = owned.has(key) || [...owned].some((p) => key.startsWith(`${p}.`));
  if (collides) {
    problems.push(
      `${touch.file}:${touch.no} reads/writes '${key}' raw, which the register owns. Read it with `
      + "`agent.getParamValue('" + key + "')` and write it through `callSkill('params','set-param')`, or, "
      + `if it genuinely cannot wait for the agent, declare it in PARAM_PREBOOT_MIRRORS and mark the site.`,
    );
  }
}

// The mirror map must stay honest: an entry nothing touches any more is a cache that has been retired.
// "Touches" includes naming the key in a constant the shells store through — the cache is the KEY, not
// any one call site.
// The register file itself always names the key — it is where the map is declared — so it cannot count
// as evidence that the cache is still in use, or this check could never fire on anything.
const mentions = (key) => execSync(
  `grep -rl "'${key}'" --include=*.js --include=*.html ${SCAN.join(' ')} apps/basis/web/index.html `
  + `| grep -v node_modules | grep -v '${REGISTER}' || true`, { cwd: ROOT, encoding: 'utf8' },
).trim().length > 0;

for (const [key, param] of mirrors ?? []) {
  if (!seenMirrorKeys.has(key) && !mentions(key)) {
    problems.push(
      `PARAM_PREBOOT_MIRRORS declares '${key}' → '${param}', but nothing reads or writes it raw any more. `
      + 'Remove the entry — this list only shrinks.',
    );
  }
}

// Every mirrored key must still name a param that exists, or the marker points at nothing.
for (const [key, param] of mirrors ?? []) {
  if (!owned.has(param)) {
    problems.push(`PARAM_PREBOOT_MIRRORS maps '${key}' → '${param}', which the register does not declare.`);
  }
}

if (problems.length) {
  console.error(`✖ lint-register-bypass — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log(
  `✓ lint-register-bypass: ${owned.size} register params, no raw bypass; `
  + `${mirrors.size} declared pre-boot mirror(s) across ${markers} marked site(s).`,
);
