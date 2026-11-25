#!/usr/bin/env node
/**
 * lint-wire-shapes — a peer message's declared shape does not change without its version, and its version does not
 * rise without a reader that sees it.
 *
 * The wire register (apps/basis/src/v2/wireRegister.js) declares every subtype's fields and `v`. This guard compares it
 * with the committed copy, `scripts/wire-shapes.json` (the declared fields, one row per line, so a review diff shows
 * what changed), and is red when:
 *   - a row's fields changed while its `v` stayed (an older build would read the new shape as the old one);
 *   - a row's `v` rose without WIRE_VERSION rising (protocol/wire.js) and without `additive: '<why an older build still
 *     reads it>'` on the row: a payload carries no per-subtype version, so a raised `v` alone is a number nobody reads;
 *   - a row is in one and not the other.
 * `node scripts/lint-wire-shapes.mjs --update` rewrites the committed copy, and refuses while any of the first two holds.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const COMMITTED = path.join(HERE, 'wire-shapes.json');

/** The committed form of a row: its `v` and its fields as one sorted line. */
export function committedShapeOf(r) {
  return { v: r.v, fields: Object.keys(r.fields).sort().map((k) => `${k}:${r.fields[k]}`).join(' ') };
}

/**
 * Every problem between the register and the committed copy.
 * @param {Record<string, {v: number, fields: object, additive?: string}>} register
 * @param {{wire: number, rows: Record<string, {v: number, fields: string}>}} committed
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
    if (!before) { out.push(`'${name}' is not in scripts/wire-shapes.json: run node scripts/lint-wire-shapes.mjs --update`); continue; }
    const fieldsChanged = before.fields !== now.fields;
    if (fieldsChanged && now.v === before.v) {
      out.push(`'${name}': its fields changed (${before.fields} → ${now.fields}) while v stayed ${now.v}`);
      continue;
    }
    if (now.v !== before.v) {
      const reason = typeof r.additive === 'string' && r.additive.trim() ? r.additive : null;
      if (now.v < before.v) out.push(`'${name}': v went down (${before.v} → ${now.v})`);
      else if (!wireRose && !reason) out.push(`'${name}': v rose (${before.v} → ${now.v}) without WIRE_VERSION rising, and without additive: '<why an older build still reads it>'`);
    }
  }
  for (const name of Object.keys(was)) if (!register[name]) out.push(`'${name}' is no longer in the wire register: run --update if it was removed on purpose`);
  return out;
}

/** The register (named and unnamed rows) and the wire version, read from the source. */
async function load(root = ROOT) {
  const { WIRE, UNNAMED } = await import(pathToFileURL(path.join(root, 'apps/basis/src/v2/wireRegister.js')).href);
  const { WIRE_VERSION } = await import(pathToFileURL(path.join(root, 'packages/core/src/protocol/wire.js')).href);
  return { register: { ...WIRE, ...UNNAMED }, wireVersion: WIRE_VERSION };
}

const readCommitted = () => (existsSync(COMMITTED) ? JSON.parse(readFileSync(COMMITTED, 'utf8')) : { wire: null, rows: {} });

/** The repo's problems (empty when clean). */
export async function check(root = ROOT) {
  const { register, wireVersion } = await load(root);
  return shapeProblems(register, readCommitted(), wireVersion);
}

/** One row per line, sorted, so a review diff reads row by row. */
function render(register, wireVersion) {
  const names = Object.keys(register).sort();
  const lines = names.map((n, i) => `    ${JSON.stringify(n)}: ${JSON.stringify(committedShapeOf(register[n]))}${i < names.length - 1 ? ',' : ''}`);
  return `{\n  "wire": ${wireVersion},\n  "rows": {\n${lines.join('\n')}\n  }\n}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { register, wireVersion } = await load();
  const problems = shapeProblems(register, readCommitted(), wireVersion);
  if (process.argv.includes('--update')) {
    const blocking = problems.filter((p) => !/run .*--update/.test(p));
    if (blocking.length) { console.error(`lint-wire-shapes: not updated, fix these first:\n  ${blocking.join('\n  ')}`); process.exit(1); }
    writeFileSync(COMMITTED, render(register, wireVersion));
    console.log(`lint-wire-shapes: wrote ${Object.keys(register).length} rows to scripts/wire-shapes.json`);
    process.exit(0);
  }
  if (problems.length) { console.error(`lint-wire-shapes:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`lint-wire-shapes: ${Object.keys(register).length} rows agree with scripts/wire-shapes.json`);
}
