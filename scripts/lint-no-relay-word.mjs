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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = currentHits();
  if (hits.length) {
    console.error('✗ "relay" in a text a person reads: say "verbindingspunt" / "connection point" (Frits 2026-11-17):');
    for (const h of hits) console.error(`   ${h}`);
    process.exit(1);
  }
  console.log('✓ no "relay" in a text a person reads');
}
