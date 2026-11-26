#!/usr/bin/env node
/**
 * THE WORD "RELAY" IS NOT SHOWN TO A PERSON (Frits 2026-11-17): everywhere a person reads it, the thing is a
 * "verbindingspunt" / "connection point". This reads every text in the app's locale files (`apps/basis/src/locales/`,
 * both languages, every file: the circle texts, the host's replies, …) and fails on "relay" in one.
 *
 * No exceptions for what a person types either: the command is `/connection-point` (the op id `set-relay` is never
 * shown) and the transport modes read "nkn · verbindingspunt · beide" (`readTransportMode`).
 *
 *   node scripts/lint-no-relay-word.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOfKey } from './guard-where.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = 'apps/basis/src/locales';

/** What may say "relay" because the person never sees it: a placeholder's name, `{{relay}}`, which the text fills in. */
const TYPED = [/\{\{\s*relay\s*\}\}/gi];

/** The keys of one locale tree whose text a person reads and that says "relay" (outside the typed words). */
export function relayTexts(tree, path = '') {
  const out = [];
  if (tree && typeof tree === 'object') {
    if (typeof tree.text === 'string') {
      const shown = TYPED.reduce((s, re) => s.replace(re, ''), tree.text);
      if (/relay/i.test(shown)) out.push(path);
      return out;
    }
    for (const [k, v] of Object.entries(tree)) {
      if (typeof v === 'string') { if (!k.startsWith('_') && /relay/i.test(TYPED.reduce((s, re) => s.replace(re, ''), v))) out.push(`${path}.${k}`); }
      else out.push(...relayTexts(v, `${path}.${k}`));
    }
  }
  return out;
}

/** Every hit in the app's locale files: `['file key', ...]`. */
export function currentHits(root = ROOT) {
  const hits = [];
  for (const f of readdirSync(join(root, LOCALES)).filter((n) => n.endsWith('.json')).sort()) {
    const tree = JSON.parse(readFileSync(join(root, LOCALES, f), 'utf8'));
    for (const key of relayTexts(tree)) hits.push(`${f} ${key.replace(/^\./, '')}`);
  }
  return hits;
}

/** The red message for hits (`'file key'`, file inside the locales folder): what is wrong, each hit as `file:line` of its
 *  key, and a `Fix:` line. `read(rel)` gives a repo file's text. */
export function redMessage(hits, read = (rel) => readFileSync(join(ROOT, rel), 'utf8')) {
  const where = (h) => {
    const [f, key] = [h.slice(0, h.indexOf(' ')), h.slice(h.indexOf(' ') + 1)];
    const rel = `${LOCALES}/${f}`;
    let text = '';
    try { text = read(rel); } catch { /* missing file: point at its top */ }
    return `${rel}:${lineOfKey(text, key)}: ${key}`;
  };
  return [
    '✗ "relay" in a text a person reads (Frits 2026-11-17):',
    ...hits.map((h) => `   ${where(h)}`),
    '   Fix: say "verbindingspunt" (nl) / "connection point" (en) in that text; a placeholder named {{relay}} may stay.',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = currentHits();
  if (hits.length) {
    console.error(redMessage(hits));
    process.exit(1);
  }
  console.log('✓ no "relay" in a text a person reads');
}
