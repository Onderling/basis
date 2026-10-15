/**
 * The header switcher — web ≡ mobile, from ONE source: both shells list the device's selves (`personasHere`), paint the
 * switcher from the shared `switcherModel`, run its op through the waist, show the ticked selves' circles
 * (`circlesInSet`) on Kringen and Vandaag and their contacts (`contactsInSet`), and write the "+" as the ticked self
 * (`writeAs`). RN cannot render under Vitest, so this reads the sources.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the header switcher — parity', () => {
  const webHost = code(read('../../basis/web/v2/circleApp.js'));
  const mobileHost = code(read('../src/screens/v2/CircleLauncherScreen.js'));
  it('both list the selves here and paint the shared model', () => {
    for (const src of [webHost, mobileHost]) {
      expect(src).toMatch(/personasHere\?\.\(\)/);
      expect(src).toMatch(/switcherModel\(\{/);
    }
    expect(code(read('../../basis/web/v2/personaSwitcher.js'))).toMatch(/model\.toggle\(/);
    expect(code(read('../src/screens/v2/PersonaSwitcherModal.js'))).toMatch(/model\.toggle\(/);
  });
  it('both show the ticked selves\' circles and contacts, and write the "+" as the ticked self', () => {
    for (const src of [webHost, mobileHost]) {
      expect(src).toMatch(/circlesInSet\(/);
      expect(src).toMatch(/contactsInSet\(/);
      expect(src).toMatch(/writeAs\(/);
      expect(src).toMatch(/selfSet: /);
      expect(src).not.toMatch(/personaSet\s*[:=]/);   // the set is the book's, changed only through the op
    }
  });
  it('Mij follows the switcher on both shells: the one ticked self is the screen\'s self', () => {
    for (const src of [webHost, mobileHost]) expect(src).toMatch(/mijSelf: \{ id: one|mijSelf = oneSelf/);
  });
});
