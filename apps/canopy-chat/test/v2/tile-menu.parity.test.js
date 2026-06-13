/**
 * β.5 — locale parity for the per-tile context-menu keys (`circle.tile.menu.*`).
 *
 * Verifies the seven new keys exist in BOTH locales of BOTH apps + that
 * the en↔nl key sets stay equal overall (no drift introduced by β.5).
 * Mirrors the self-contained pattern of circleKind.parity.test.js so
 * the slice always has a runnable smoke alongside the DOM tests.
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

const MENU_KEYS = [
  'circle.tile.menu.leave',
  'circle.tile.menu.leave_confirm',
  'circle.tile.menu.mute',
  'circle.tile.menu.pin',
  'circle.tile.menu.settings',
  'circle.tile.menu.unmute',
  'circle.tile.menu.unpin',
];

describe('β.5 — circle.tile.menu.* locale parity', () => {
  it('web en + nl both expose the seven context-menu keys', () => {
    const e = flatKeys(enWeb).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    const n = flatKeys(nlWeb).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    expect(e).toEqual(MENU_KEYS);
    expect(n).toEqual(MENU_KEYS);
  });

  it('mobile en + nl both expose the seven context-menu keys', () => {
    const e = flatKeys(enMob).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    const n = flatKeys(nlMob).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    expect(e).toEqual(MENU_KEYS);
    expect(n).toEqual(MENU_KEYS);
  });

  it('web en↔nl key sets match overall (no drift introduced by β.5)', () => {
    expect(flatKeys(enWeb).sort()).toEqual(flatKeys(nlWeb).sort());
  });

  it('mobile en↔nl key sets match overall (no drift introduced by β.5)', () => {
    expect(flatKeys(enMob).sort()).toEqual(flatKeys(nlMob).sort());
  });

  it('all four locale files agree on the tile.menu key set', () => {
    const e = flatKeys(enWeb).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    const en2 = flatKeys(enMob).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    const n = flatKeys(nlWeb).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    const nm = flatKeys(nlMob).filter((k) => k.startsWith('circle.tile.menu.')).sort();
    expect(en2).toEqual(e);
    expect(nm).toEqual(n);
  });
});
