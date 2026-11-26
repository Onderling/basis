#!/usr/bin/env node
/**
 * lint-shapes — a declared shape does not change without its version, and a version does not rise without a reader
 * that sees it. Two registers, two committed copies, one rule:
 *
 * WIRE: the wire register (apps/basis/src/v2/wireRegister.js) declares every peer message kind's fields and `v`;
 * `scripts/wire-shapes.json` holds the committed copy (one row per line, so a review diff shows what changed). Red when:
 *   - a row's fields changed while its `v` stayed (an older build would read the new shape as the old one);
 *   - a row's `v` rose without WIRE_VERSION rising (protocol/wire.js) and without `additive: '<why an older build still
 *     reads it>'` on the row: a payload carries no per-kind version, so a raised `v` alone is a number nobody reads.
 *     The reason is committed with the row, so a SECOND rise needs a new reason, not the old one again;
 *   - a row's home or block-list mark changed (it moves the kind on or off the block list) until --update records it.
 *
 * STORED: the storage register (apps/basis/src/v2/storageRegister.js) declares each name's `shape`;
 * `scripts/stored-shapes.json` holds the committed copy. Red when:
 *   - a key's value kind changed in place (`v: 'none'`: nothing stored says which kind it is, so an older build reads the
 *     new value as the old kind): store it under a NEW key instead;
 *   - a stamped store's `v` went down; a rise or any other change of the declaration is red until --update records it
 *     (the stamp is read: a build that does not know it keeps the bytes and refuses to save over them).
 *
 * In both: a row in one and not the other is red until --update. `node scripts/lint-shapes.mjs --update` rewrites both
 * copies, and refuses while a red that --update does not settle holds.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const WIRE_FILE = path.join(HERE, 'wire-shapes.json');
const STORED_FILE = path.join(HERE, 'stored-shapes.json');
const UPDATE = 'run node scripts/lint-shapes.mjs --update';

const reasonOf = (r) => (typeof r.additive === 'string' && r.additive.trim() ? r.additive.trim() : null);

/**
 * The committed form of a wire row: its home, whether a blocked address is refused it, its `v`, its fields as one sorted
 * line, and the `additive` reason when it has one. Home and the block-list mark are in it because moving a kind decides
 * who may receive it: that is a review line.
 */
export function committedShapeOf(r) {
  const reason = reasonOf(r);
  return {
    home: r.home ?? null,
    ...(r.home === 'direct' ? { blockList: r.blockList !== false } : {}),
    v: r.v,
    fields: Object.keys(r.fields).sort().map((k) => `${k}:${r.fields[k]}`).join(' '),
    ...(reason ? { additive: reason } : {}),
  };
}

/**
 * Every problem between the wire register and its committed copy.
 * @param {Record<string, {v: number, fields: object, additive?: string}>} register
 * @param {{wire: number, rows: Record<string, {v: number, fields: string, additive?: string}>}} committed
 * @param {number} wireVersion  the current WIRE_VERSION
 * @returns {string[]}
 */
export function shapeProblems(register, committed, wireVersion) {
  const out = [];
  const wireRose = wireVersion > (committed?.wire ?? wireVersion);
  const was = committed?.rows ?? {};
  for (const [name, r] of Object.entries(register)) {
    const now = committedShapeOf(r);
    const before = was[name];
    if (!before) { out.push(`'${name}' is not in scripts/wire-shapes.json: ${UPDATE}`); continue; }
    if (before.home !== now.home) out.push(`'${name}': its home changed (${before.home} → ${now.home}), which moves it on or off the block list: ${UPDATE} to record it`);
    else if (before.blockList !== now.blockList) out.push(`'${name}': its block list mark changed (${before.blockList} → ${now.blockList}): ${UPDATE} to record it`);
    const fieldsChanged = before.fields !== now.fields;
    if (fieldsChanged && now.v === before.v) {
      out.push(`'${name}': its fields changed (${before.fields} → ${now.fields}) while v stayed ${now.v}: raise v in wireRegister.js, with WIRE_VERSION or an additive reason`);
      continue;
    }
    if (now.v !== before.v) {
      const reason = reasonOf(r);
      if (now.v < before.v) out.push(`'${name}': v went down (${before.v} → ${now.v}) in wireRegister.js: a version only rises`);
      else if (!wireRose && !reason) out.push(`'${name}': v rose (${before.v} → ${now.v}) without WIRE_VERSION rising: raise WIRE_VERSION (protocol/wire.js) or add additive: '<why an older build still reads it>' to the row`);
      else if (!wireRose && reason === before.additive) out.push(`'${name}': v rose again (${before.v} → ${now.v}) on the same additive reason: say why an older build still reads THIS change`);
    }
  }
  for (const name of Object.keys(was)) if (!register[name]) out.push(`'${name}' is no longer in the wire register: ${UPDATE} if it was removed on purpose`);
  return out;
}

/** The committed form of a stored row: 'opaque', or its `v` with its carrier or value kind. */
export function committedStoredShapeOf(r) {
  const s = r.shape;
  if (s === 'opaque') return 'opaque';
  if (!s || typeof s !== 'object') return null;
  return { v: s.v, ...(s.carrier ? { carrier: s.carrier } : {}), ...(s.value ? { value: s.value } : {}) };
}

/**
 * Every problem between the storage register and its committed copy.
 * @param {Record<string, {shape: any}>} register
 * @param {{rows: Record<string, any>}} committed
 * @returns {string[]}
 */
export function storedShapeProblems(register, committed) {
  const out = [];
  const was = committed?.rows ?? {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [id, r] of Object.entries(register)) {
    const now = committedStoredShapeOf(r);
    if (now == null) { out.push(`'${id}': no shape in storageRegister.js: give the row SNAP, LOG, ROWS, k('<kind>') or OPAQUE`); continue; }
    const before = was[id];
    if (before === undefined) { out.push(`'${id}' is not in scripts/stored-shapes.json: ${UPDATE}`); continue; }
    if (same(before, now)) continue;
    const keyed = (x) => x && typeof x === 'object' && x.v === 'none' && x.value;
    if (keyed(before) && keyed(now) && before.value !== now.value) {
      out.push(`'${id}': its value kind changed in place (${before.value} → ${now.value}); nothing stored says which kind it is, so an older build reads it as the old one: store the new kind under a NEW key (a new row)`);
      continue;
    }
    if (typeof before?.v === 'number' && typeof now?.v === 'number' && now.v < before.v) {
      out.push(`'${id}': v went down (${before.v} → ${now.v}) in storageRegister.js: a stamp only rises`);
      continue;
    }
    out.push(`'${id}': its shape changed (${JSON.stringify(before)} → ${JSON.stringify(now)}): ${UPDATE} to record it`);
  }
  for (const id of Object.keys(was)) if (!register[id]) out.push(`'${id}' is no longer in the storage register: ${UPDATE} if it was removed on purpose`);
  return out;
}

/** Both registers and the wire version, read from the source. */
async function load(root = ROOT) {
  const { WIRE, UNNAMED } = await import(pathToFileURL(path.join(root, 'apps/basis/src/v2/wireRegister.js')).href);
  const { WIRE_VERSION } = await import(pathToFileURL(path.join(root, 'packages/core/src/protocol/wire.js')).href);
  const { STORAGE } = await import(pathToFileURL(path.join(root, 'apps/basis/src/v2/storageRegister.js')).href);
  return { register: { ...WIRE, ...UNNAMED }, wireVersion: WIRE_VERSION, stored: STORAGE };
}

const readJson = (file, empty) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty);
const readWire = () => readJson(WIRE_FILE, { wire: null, rows: {} });
const readStored = () => readJson(STORED_FILE, { rows: {} });

/** The repo's problems (empty when clean). */
export async function check(root = ROOT) {
  const { register, wireVersion, stored } = await load(root);
  return [...shapeProblems(register, readWire(), wireVersion), ...storedShapeProblems(stored, readStored())];
}

/** One row per line, sorted, so a review diff reads row by row. */
function renderRows(rows) {
  const names = Object.keys(rows).sort();
  return names.map((n, i) => `    ${JSON.stringify(n)}: ${JSON.stringify(rows[n])}${i < names.length - 1 ? ',' : ''}`).join('\n');
}
const renderWire = (register, wireVersion) =>
  `{\n  "wire": ${wireVersion},\n  "rows": {\n${renderRows(Object.fromEntries(Object.entries(register).map(([n, r]) => [n, committedShapeOf(r)])))}\n  }\n}\n`;
const renderStored = (stored) =>
  `{\n  "rows": {\n${renderRows(Object.fromEntries(Object.entries(stored).map(([n, r]) => [n, committedStoredShapeOf(r)])))}\n  }\n}\n`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { register, wireVersion, stored } = await load();
  const problems = [...shapeProblems(register, readWire(), wireVersion), ...storedShapeProblems(stored, readStored())];
  if (process.argv.includes('--update')) {
    const blocking = problems.filter((p) => !p.includes(UPDATE));
    if (blocking.length) { console.error(`lint-shapes: not updated, fix these first:\n  ${blocking.join('\n  ')}`); process.exit(1); }
    writeFileSync(WIRE_FILE, renderWire(register, wireVersion));
    writeFileSync(STORED_FILE, renderStored(stored));
    console.log(`lint-shapes: wrote ${Object.keys(register).length} wire rows and ${Object.keys(stored).length} stored rows`);
    process.exit(0);
  }
  if (problems.length) { console.error(`lint-shapes:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`lint-shapes: ${Object.keys(register).length} wire rows agree with scripts/wire-shapes.json, ${Object.keys(stored).length} stored rows with scripts/stored-shapes.json`);
}
