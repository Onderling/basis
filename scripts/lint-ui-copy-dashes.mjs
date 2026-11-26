#!/usr/bin/env node
/**
 * UI COPY IS PLAIN SENTENCES: NO DASH CONSTRUCTIONS (Frits, 2026-11-06). A spaced em dash, en dash or hyphen joining
 * two clauses (`wat je deelt — en met wie`) is the construction he asked to keep out of what a person reads. This reads
 * every user-facing locale file (the same set `lint-locale-duplicate-keys` reads: every tracked `locales/*.json`) and
 * flags a string VALUE that contains one. Allowed: a range without spaces (`9–17`), a value that is only a dash, a
 * hyphen inside a word (`e-mail`). Keys and `doc` strings are not copy and are not read.
 *
 * Today's hits are a BASELINE (`ui-copy-dashes.baseline.json`): they may only shrink. A new hit fails; a baseline entry
 * that no longer matches is reported so the file is pruned (`--write` rewrites it to today's hits).
 *
 * Found first: lint-locale-key-parity (key presence across shells), lint-locale-ownership (where a key is defined),
 * audit-locales (a report, not a gate) and lint-locale-duplicate-keys (a key twice in one object). None reads a value's
 * wording; this is its own guard over the same file set.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOf, lineOfKey } from './guard-where.mjs';

/** A spaced dash between two non-space characters: ` — `, ` – `, or ` - `. */
const SPACED_DASH = /\S\s+[—–-]\s+\S/;

/**
 * Every copy string in a parsed locale object that carries a spaced dash, with its key path.
 * @param {object} json
 * @returns {Array<{key: string, text: string}>}
 */
export function dashHits(json) {
  const out = [];
  const walk = (node, pre) => {
    if (typeof node === 'string') {
      if (SPACED_DASH.test(node)) out.push({ key: pre, text: node });
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'doc') continue;   // a translator's note, not copy
      walk(v, pre ? `${pre}.${k}` : k);
    }
  };
  walk(json, '');
  return out;
}

const BASELINE_FILE = 'scripts/ui-copy-dashes.baseline.json';

/** `file:line` of a hit (`file#key`): the line of its key, or of its nearest parent key when the string sits in an array. */
function whereHit(hit, read) {
  const [f, key] = [hit.slice(0, hit.indexOf('#')), hit.slice(hit.indexOf('#') + 1)];
  const text = read(f);
  const segs = key.split('.');
  for (let n = segs.length; n > 0; n -= 1) {
    const l = lineOfKey(text, segs.slice(0, n).join('.'));
    if (l > 1) return `${f}:${l}`;
  }
  return `${f}:1`;
}

/** The red message for new hits (`file#key`), or, when there are none, for baseline entries that no longer match: what
 *  is wrong, where (`file:line`) and a `Fix:` line. `read(rel)` gives a repo file's text. */
export function redMessage(added, gone, read = () => '') {
  if (added.length) {
    return [
      `✖ lint-ui-copy-dashes: ${added.length} new dash construction(s) in UI copy (a spaced ' — ', ' – ' or ' - ' joining two clauses):`,
      ...added.map((h) => `  • ${whereHit(h, read)}: ${h}`),
      "  Fix: write it as plain sentences: a full stop or a comma instead of the dash (a range like 9–17 or a word like e-mail is fine).",
    ].join('\n');
  }
  const base = read(BASELINE_FILE);
  return [
    `✖ lint-ui-copy-dashes: ${gone.length} baseline entr${gone.length === 1 ? 'y' : 'ies'} no longer match (the copy was fixed):`,
    ...gone.map((h) => `  • ${BASELINE_FILE}:${lineOf(base, `"${h}"`)}: ${h}`),
    `  Fix: delete those lines from ${BASELINE_FILE}, or run node scripts/lint-ui-copy-dashes.mjs --write to prune it.`,
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /(^|\/)locales\/.*\.json$/.test(f) && !f.includes('node_modules'));
  const now = [];
  for (const f of files) {
    let json;
    try { json = JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')); } catch { continue; }
    for (const h of dashHits(json)) now.push(`${f}#${h.key}`);
  }
  now.sort();
  if (process.argv.includes('--write')) {
    writeFileSync(path.join(ROOT, BASELINE_FILE), `${JSON.stringify(now, null, 2)}\n`);
    console.log(`✓ lint-ui-copy-dashes: baseline written (${now.length} entries).`);
    process.exit(0);
  }
  let baseline = [];
  try { baseline = JSON.parse(readFileSync(path.join(ROOT, BASELINE_FILE), 'utf8')); } catch { baseline = []; }
  const known = new Set(baseline);
  const added = now.filter((h) => !known.has(h));
  const gone = baseline.filter((h) => !now.includes(h));
  if (added.length || gone.length) {
    console.error(redMessage(added, gone, (f) => readFileSync(path.join(ROOT, f), 'utf8')));
    process.exit(1);
  }
  console.log(`✓ lint-ui-copy-dashes: ${files.length} locale files, no new dash construction (${baseline.length} in the baseline, to shrink).`);
}
