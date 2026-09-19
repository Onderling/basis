/**
 * Share my contact (2026-09-19) — web ≡ mobile, from ONE source: both shells resolve the panel through the shared
 * `loadShareMyContact` (the card + its link form), both read an arriving link through the one `contactCardFromLink`
 * (web's boot hash, mobile's link receiver via the QR classifier), and both speak the same `circle.shareContact.*`
 * keys. A shell that builds the link itself, parses the hash itself, or words its own panel is the drift this pins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('share my contact — parity', () => {
  const webHost      = read('../../basis/web/v2/circleApp.js');
  const webPanel     = read('../../basis/web/v2/shareMyContact.js');
  const webProfile   = read('../../basis/web/v2/circleProfile.js');
  const mobileScreen = read('../src/screens/v2/ShareMyContactScreen.js');
  const mobileProfile = read('../src/screens/v2/CircleProfileScreen.js');
  const mobileClassifier = read('../src/core/qrClassifiers.js');

  it('both shells resolve the panel through the shared loader — neither builds the link or asks stoop itself', () => {
    for (const src of [webHost, mobileScreen]) expect(src).toMatch(/loadShareMyContact\(/);
    // (comments describe; code decides — strip them before looking for a shell doing the loader's job)
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const src of [webHost, webPanel, mobileScreen]) expect(code(src)).not.toMatch(/#contact=|getContactShareQr/);
  });
  it('both shells read an arriving link through the one reader', () => {
    expect(webHost).toMatch(/contactCardFromLink\(window\.location\.hash\)/);
    expect(mobileClassifier).toMatch(/contactCardFromLink\(/);
  });
  it('Mij offers it on both shells under the same key; both panels speak the same keys', () => {
    for (const src of [webProfile, mobileProfile]) expect(src).toMatch(/circle\.profile\.share_contact/);
    for (const key of ['title', 'hint', 'code_label', 'link_label', 'error', 'back']) {
      for (const src of [webPanel, mobileScreen]) expect(src, key).toMatch(new RegExp(`circle\\.shareContact\\.${key}`));
    }
  });
});
