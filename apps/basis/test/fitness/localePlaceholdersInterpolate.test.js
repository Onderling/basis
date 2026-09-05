/**
 * FITNESS FUNCTION — a placeholder in a locale string must be one a translator will actually replace.
 *
 * Found on a phone, 2026-08-31: the Advanced screen's hint read `In chat: {slash}` — the placeholder
 * itself, printed. Both translators interpolate `{{name}}` and neither touches `{name}`: web's i18next
 * is configured for the double form, and mobile's hand-rolled `t()` matches `{{k}}` literally. So a
 * single-brace placeholder is not a near-miss, it is a string that can never be finished, and it reaches
 * the screen looking like a bug in the app rather than a typo in a file.
 *
 * Ten keys carried one, in both languages — seventeen placeholders each: the governance tally
 * (`{yes} of {need} needed · {of} members`), the shared-with-me rows, the agent-activity lines, an
 * inbound calendar invite and `circle.boot_failed`, which is the
 * sentence a person reads when the app could not start at all. None of them is exotic copy; they are
 * ordinary lines that nothing checked.
 *
 * Nothing else could have caught it. `labelKeysResolve` proves a key RESOLVES, and every one of these
 * resolved — to a string with a placeholder in it. Parity guards compare the shells, and both shells
 * were equally wrong. This asks the one remaining question: once resolved, is the sentence finished?
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Every locale bundle both shells load: the shared blocks and each shell's own. */
const BUNDLES = [
  ['shared', here('../../src/locales')],
  ['web',    here('../../locales')],
  ['mobile', here('../../../basis-mobile/locales')],
];

/** `{name}` that is not part of a `{{name}}` — the form no translator here will substitute. */
const SINGLE_BRACE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

/** Every leaf string in a bundle, with the dotted path that reaches it. */
function leaves(node, prefix, out = []) {
  if (typeof node === 'string') { out.push([prefix, node]); return out; }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function offenders(dir) {
  const found = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const json = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    for (const [key, text] of leaves(json, '')) {
      if (key.endsWith('.doc')) continue;                    // documentation ABOUT a placeholder, not copy
      SINGLE_BRACE.lastIndex = 0;
      const hits = [...text.matchAll(SINGLE_BRACE)].map((m) => m[0]);
      if (hits.length) found.push(`${file} · ${key} · ${hits.join(' ')}`);
    }
  }
  return found;
}

describe('a placeholder in a locale string is one a translator will replace', () => {
  for (const [name, dir] of BUNDLES) {
    it(`${name}: no single-brace placeholder survives to the screen`, () => {
      expect(offenders(dir), 'write {{name}}, not {name} — both translators match the double form only')
        .toEqual([]);
    });
  }

  it('the check can actually see one (it is looking for the right shape)', () => {
    // The guard is a regex over data; a typo in it would pass everything forever and say so cheerfully.
    const found = [...'In chat: {slash} and {{ok}}'.matchAll(SINGLE_BRACE)].map((m) => m[0]);
    expect(found).toEqual(['{slash}']);
  });
});
