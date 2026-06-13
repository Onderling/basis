/**
 * β.3 — locale parity for the four `circle.kind.*` section-header keys
 * the launcher uses to group tiles (household / buurt / vriendenkring /
 * other).  Confirms the keys exist in BOTH locales of BOTH apps + that
 * the en↔nl key sets match overall.
 *
 * The repo-wide `test/localisation.test.js` already enforces general
 * en↔nl parity for the web app, but its setup pulls in `@canopy/app-manifest`
 * via `src/renderer.js`, which doesn't resolve under the worktree
 * `node_modules` layout used by sub-agents.  This file is intentionally
 * self-contained so the launcher slice always has a runnable parity
 * smoke alongside the DOM tests.
 */
import { describe, it, expect } from 'vitest';
import enWebRaw from '../../locales/en.json' with { type: 'json' };
import nlWebRaw from '../../locales/nl.json' with { type: 'json' };
import enMobRaw from '../../../canopy-chat-mobile/locales/en.json' with { type: 'json' };
import nlMobRaw from '../../../canopy-chat-mobile/locales/nl.json' with { type: 'json' };
import { sharedCircleLocale } from '../../src/locales/index.js';
// `circle.*` is now the SHARED source both shells merge — so web ≡ mobile for circle by construction.
const enWeb = { ...enWebRaw, circle: sharedCircleLocale.en };
const nlWeb = { ...nlWebRaw, circle: sharedCircleLocale.nl };
const enMob = { ...enMobRaw, circle: sharedCircleLocale.en };
const nlMob = { ...nlMobRaw, circle: sharedCircleLocale.nl };

function flatKeys(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !('text' in v)) out.push(...flatKeys(v, p));
    else out.push(p);
  }
  return out;
}

const KIND_KEYS = [
  'circle.kind.buurt',
  'circle.kind.household',
  'circle.kind.other',
  'circle.kind.vriendenkring',
];

describe('β.3 — circle.kind.* locale parity', () => {
  it('web en + nl both expose the four launcher section-header keys', () => {
    const e = flatKeys(enWeb).filter((k) => k.startsWith('circle.kind.')).sort();
    const n = flatKeys(nlWeb).filter((k) => k.startsWith('circle.kind.')).sort();
    expect(e).toEqual(KIND_KEYS);
    expect(n).toEqual(KIND_KEYS);
  });

  it('mobile en + nl both expose the four launcher section-header keys', () => {
    const e = flatKeys(enMob).filter((k) => k.startsWith('circle.kind.')).sort();
    const n = flatKeys(nlMob).filter((k) => k.startsWith('circle.kind.')).sort();
    expect(e).toEqual(KIND_KEYS);
    expect(n).toEqual(KIND_KEYS);
  });

  it('web en↔nl key sets match overall (no drift)', () => {
    expect(flatKeys(enWeb).sort()).toEqual(flatKeys(nlWeb).sort());
  });

  it('mobile en↔nl key sets match overall (no drift)', () => {
    expect(flatKeys(enMob).sort()).toEqual(flatKeys(nlMob).sort());
  });
});
