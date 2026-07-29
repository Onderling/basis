/**
 * β.3 — locale parity for the four `circle.kind.*` section-header keys
 * the launcher uses to group tiles (household / buurt / vriendenkring /
 * other).  Confirms the keys exist in BOTH locales of BOTH apps + that
 * the en↔nl key sets match overall.
 *
 * The repo-wide `test/localisation.test.js` already enforces general
 * en↔nl parity for the web app, but its setup pulls in `@onderling/app-manifest`
 * via `src/renderer.js`, which doesn't resolve under the worktree
 * `node_modules` layout used by sub-agents.  This file is intentionally
 * self-contained so the launcher slice always has a runnable parity
 * smoke alongside the DOM tests.
 */
import { describe, it, expect } from 'vitest';
import enWebRaw from '../../locales/en.json' with { type: 'json' };
import nlWebRaw from '../../locales/nl.json' with { type: 'json' };
import enMobRaw from '../../../basis-mobile/locales/en.json' with { type: 'json' };
import nlMobRaw from '../../../basis-mobile/locales/nl.json' with { type: 'json' };
import { sharedCircleLocale } from '../../src/locales/index.js';
import { KRING_KINDS } from '../../src/v2/kringTemplates.js';
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

/**
 * `circle.kind.*` serves TWO readers: the launcher's section headers and the create wizard's kind
 * picker. They are not the same set — the launcher needs a catch-all (`other`) that is not a kind you
 * can pick, and the wizard needs every kind in `KRING_KINDS`. Derive the union rather than hardcoding
 * it: this list was pinned at four while `KRING_KINDS` grew to include `team`, so the picker rendered
 * the raw key `circle.kind.team` on screen in both languages (found walking S3, 2026-07-29) and this
 * test still passed. A hardcoded list of a vocabulary that lives elsewhere only ever goes stale.
 */
const KIND_KEYS = [...new Set([...KRING_KINDS, 'other'])]
  .map((k) => `circle.kind.${k}`).sort();

describe('β.3 — circle.kind.* locale parity', () => {
  it('web en + nl both expose every kind key (launcher headers + wizard picker)', () => {
    const e = flatKeys(enWeb).filter((k) => k.startsWith('circle.kind.')).sort();
    const n = flatKeys(nlWeb).filter((k) => k.startsWith('circle.kind.')).sort();
    expect(e).toEqual(KIND_KEYS);
    expect(n).toEqual(KIND_KEYS);
  });

  it('mobile en + nl both expose every kind key (launcher headers + wizard picker)', () => {
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
