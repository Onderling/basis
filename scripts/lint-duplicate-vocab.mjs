#!/usr/bin/env node
/**
 * lint-duplicate-vocab.mjs — a shared VOCABULARY is defined in exactly ONE place.
 *
 * The structural guards (dep-boundaries, unreached-exports, coverage) all miss the same failure: the SAME
 * closed vocabulary — a per-class table, an enum, a label map — defined TWICE, in two files, drifting apart.
 * That is how the retention window ended up as a count-based `RETENTION_WINDOW` in `entryKinds` AND a
 * duration-based `RETENTION_DEFAULTS` in `eventLog` on 2026-08-06 (consolidated same day). This guard catches
 * that class: for each REGISTERED shared vocabulary (its canonical home + key-set), it fails if a frozen
 * constant with that key-signature is defined anywhere but its home.
 *
 * A re-export (`export { X } from …`) is NOT a definition and is fine — the point is a second SOURCE of truth,
 * not a second reference. Extend `VOCABULARIES` when you add a shared vocabulary (its home + its keys).
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The registered shared vocabularies. `keys` is the canonical key-set (sorted); a frozen constant with this
 * exact key-set is THIS vocabulary and must live only at `home`.
 */
export const VOCABULARIES = [
  {
    name: 'retention-classes',
    home: 'packages/item-store/src/entryKinds.js',
    keys: ['audit', 'chat', 'named', 'record', 'short'],   // the RETAIN classes (the home's literal keys — computed-key TABLES over them are references, not copies)
  },
  {
    name: 'delivery-ladder',
    home: 'packages/kring-host/src/deliveryState.js',
    keys: ['failed', 'maybe', 'pending', 'stored', 'undeliverable'],   // DELIVERY — the one delivery vocabulary (the substrate-audit extraction)
  },
];

/** apps/<x>/src + packages/<x>/src *.js (skip tests, node_modules, dist). */
export function sourceFiles(root = ROOT) {
  const out = [];
  const roots = ['apps', 'packages'].map((d) => path.join(root, d));
  const skip = new Set(['node_modules', 'dist', 'build', '.git', '_archive', 'coverage']);
  const walk = (dir) => {
    let names; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (skip.has(n)) continue;
      const full = path.join(dir, n);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (n.endsWith('.js') && !n.endsWith('.test.js')) out.push(full);
    }
  };
  for (const r of roots) walk(r);
  return out;
}

/** Normalise a key token: bare `short` → `short`; computed `[RETAIN.SHORT]` → `short`. */
export function normKey(raw) {
  const m = raw.match(/^\[?\s*['"]?([A-Za-z0-9_$.]+)['"]?\s*\]?$/);
  if (!m) return raw.toLowerCase();
  const parts = m[1].split('.');
  return parts[parts.length - 1].toLowerCase();
}

/** Every `export const NAME = Object.freeze({ … })` in a source, as `{ name, keys:Set }` (depth-1 keys). */
export function frozenExports(src) {
  const out = [];
  const re = /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*Object\.freeze\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1;   // at the opening `{`
    let depth = 0;
    const keys = new Set();
    let atEntryStart = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { depth++; atEntryStart = depth === 1; continue; }
      if (c === '}') { depth--; if (depth === 0) break; continue; }
      if (depth === 1 && atEntryStart) {
        const km = src.slice(i).match(/^\s*(\[[^\]]+\]|['"][^'"]+['"]|[A-Za-z0-9_$]+)\s*:/);
        if (km) {
          // A COMPUTED key (`[DELIVERY.PENDING]: …`) is a REFERENCE to a vocabulary, not a second
          // definition of it — a label map keyed by the home's export is the correct consumption
          // pattern, and flagging it would push call sites toward literal copies (the actual drift).
          // Only literal keys count toward a definition's key-set.
          if (!km[1].startsWith('[')) keys.add(normKey(km[1]));
          i += km[0].length - 1; atEntryStart = false; continue;
        }
      }
      if (c === ',' && depth === 1) atEntryStart = true;
    }
    out.push({ name: m[1], keys });
  }
  return out;
}

export const sameSet = (keys, arr) => keys.size === arr.length && arr.every((k) => keys.has(k));

/** Returns a list of problem strings (empty = clean). Pure over the given file list. */
export function checkVocabularies(files = sourceFiles()) {
  const problems = [];
  for (const vocab of VOCABULARIES) {
    const definers = [];
    for (const file of files) {
      let src; try { src = readFileSync(file, 'utf8'); } catch { continue; }
      for (const exp of frozenExports(src)) {
        if (sameSet(exp.keys, vocab.keys)) definers.push({ file: path.relative(ROOT, file), name: exp.name });
      }
    }
    const offHome = definers.filter((d) => d.file !== vocab.home);
    if (offHome.length) {
      problems.push(
        `✗ vocabulary "${vocab.name}" (keys: ${vocab.keys.join(', ')}) is defined OUTSIDE its home `
        + `${vocab.home}:\n    ${offHome.map((d) => `${d.name} in ${d.file}`).join('\n    ')}\n`
        + `    → define it once at the home and import/re-export it elsewhere (this is the retention drift class).`,
      );
    } else if (!definers.length) {
      problems.push(`✗ vocabulary "${vocab.name}" is registered but NOT defined at its home ${vocab.home} — fix the registry or the home.`);
    }
  }
  return problems;
}

// Run only when invoked directly (the self-test imports the helpers above without triggering the scan).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkVocabularies();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`✓ lint-duplicate-vocab: ${VOCABULARIES.length} shared vocabular${VOCABULARIES.length === 1 ? 'y' : 'ies'} each defined once.`);
}
