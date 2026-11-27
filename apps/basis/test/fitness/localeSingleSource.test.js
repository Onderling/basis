/**
 * FITNESS FUNCTION — locale single-source & web≡mobile parity.
 *
 * The recurring drift this repo fights (CLAUDE.md): duplicated locales — a
 * `circle.*` string edited in the web bundle AND a mobile copy, drifting apart.
 * The cure already landed: `circle.*` lives in ONE shared source
 * (apps/basis/src/locales/circle.{en,nl}.json), merged into BOTH shells.
 * These checks make the cure self-enforcing — re-introducing a mobile circle
 * copy, or adding a key to one language only, FAILS CI here.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));

const circleEn = read('../../src/locales/circle.en.json');
const circleNl = read('../../src/locales/circle.nl.json');

// Blocks that were consolidated into the shared source the same way `circle.*` was (invariant #3 —
// finishing the consolidation `circle.*` started). Each must live ONCE (src/locales/) and be merged
// into both shells, never re-declared per-shell.
const sharedBlocks = ['circle', 'consequence', 'role'];
const sharedByBlock = {
  circle: [circleEn, circleNl],
  consequence: [read('../../src/locales/consequence.en.json'), read('../../src/locales/consequence.nl.json')],
  role: [read('../../src/locales/role.en.json'), read('../../src/locales/role.nl.json')],
};

/** Collect every leaf path that carries a `text` string. */
function leafPaths(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  if (typeof obj.text === 'string') { out.add(prefix); return out; }
  for (const [k, v] of Object.entries(obj)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

describe('FITNESS: shared locale blocks are a single shared source', () => {
  const mobileEn = read('../../../basis-mobile/locales/en.json');
  const mobileNl = read('../../../basis-mobile/locales/nl.json');
  const webEn = read('../../locales/en.json');
  const webNl = read('../../locales/nl.json');
  for (const block of sharedBlocks) {
    it(`neither shell re-declares its own ${block}.* block (both merge the shared source)`, () => {
      for (const [name, bundle] of [['web en', webEn], ['web nl', webNl], ['mobile en', mobileEn], ['mobile nl', mobileNl]]) {
        expect(block in bundle, `${name}.json must not re-declare ${block}.* — use the shared source`).toBe(false);
      }
    });
  }
});

describe('FITNESS: shared locale blocks en ≡ nl by construction', () => {
  for (const block of sharedBlocks) {
    const [blockEn, blockNl] = sharedByBlock[block];
    it(`${block}: no leaf has an empty string in either language (the key check for every block is below)`, () => {
      const empties = [];
      const walk = (obj, lang, prefix = '') => {
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.text === 'string') { if (!obj.text.trim()) empties.push(`${lang}:${prefix}`); return; }
        for (const [k, v] of Object.entries(obj)) walk(v, lang, prefix ? `${prefix}.${k}` : k);
      };
      walk(blockEn, 'en'); walk(blockNl, 'nl');
      expect(empties, `${block}: empty locale strings: ${empties.join(', ')}`).toEqual([]);
    });
  }
});

// EVERY locale file pair, not a hand-kept list: each shared block in src/locales (found by its `.en.json`) and each
// shell's own bundle holds the same keys in English and in Dutch. A block in one language only is declared here with
// its reason; a new one is red until it is.
const ONE_LANGUAGE = {
  'chat-hints.nl.json': 'the Dutch hint beside the manifest\'s own English one (lint-chat-hints-localised)',
};
describe('FITNESS: every locale file holds the same keys in en and nl', () => {
  const dir = here('../../src/locales/');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const pairs = files.filter((f) => f.endsWith('.en.json'))
    .map((f) => [`src/locales/${f}`, `../../src/locales/${f}`, `../../src/locales/${f.replace(/\.en\.json$/, '.nl.json')}`]);
  pairs.push(['the web bundle', '../../locales/en.json', '../../locales/nl.json']);
  pairs.push(['the mobile bundle', '../../../basis-mobile/locales/en.json', '../../../basis-mobile/locales/nl.json']);
  it('a file in one language only is a declared one', () => {
    const alone = files.filter((f) => !files.includes(f.endsWith('.en.json') ? f.replace(/\.en\.json$/, '.nl.json') : f.replace(/\.nl\.json$/, '.en.json')));
    expect(alone.sort()).toEqual(Object.keys(ONE_LANGUAGE).sort());
  });
  for (const [name, enPath, nlPath] of pairs) {
    it(`${name}: every English leaf key exists in Dutch and vice versa`, () => {
      const en = leafPaths(read(enPath));
      const nl = leafPaths(read(nlPath));
      const missingInNl = [...en].filter((k) => !nl.has(k));
      const missingInEn = [...nl].filter((k) => !en.has(k));
      expect(missingInNl, `${name}: keys present in EN but missing in NL: ${missingInNl.join(', ')}`).toEqual([]);
      expect(missingInEn, `${name}: keys present in NL but missing in EN: ${missingInEn.join(', ')}`).toEqual([]);
    });
  }
});
