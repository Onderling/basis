/**
 * THE "+" DOCKED IN THE TAB BAR — web ≡ mobile from ONE model (`src/v2/plusDial.js`): both bars paint their slots through
 * `barSlots` (the manifest's `plus.place`), both hosts ask `plusDialFor` which button sits where and `plusPress` what a
 * press does, both read the `plus.middle` setting, both run the same two views a dial button names, and neither keeps a
 * floating "+". The phone's back gesture folds the buttons back as Escape does on the web. `src/screens/**` cannot render
 * under vitest, so the wiring is pinned as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { barSlots } from '../../basis/src/v2/plusDial.js';
import { basisManifest } from '../../basis/src/index.js';
import { renderMobile } from '@onderling/app-manifest';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');

describe('the docked "+" — parity', () => {
  const webHost  = read('../../basis/web/v2/circleApp.js');
  const webTabs  = read('../../basis/web/v2/circleTabBar.js');
  const launcher = read('../src/screens/v2/CircleLauncherScreen.js');
  const tabs     = read('../src/screens/v2/CircleTabBar.js');

  it('the phone bar holds the "+" in the middle: Vandaag · Kringen · + · Contacten · In de buurt with a mesh', () => {
    const ids = barSlots(basisManifest, { renderer: renderMobile, hasMesh: true }).map((s) => (s.kind === 'plus' ? '+' : s.tab.id));
    expect(ids).toEqual(['screens', 'circles', '+', 'contacten', 'nearby']);
  });

  it('both bars paint their slots from the shared `barSlots`, the phone with `renderMobile`', () => {
    expect(webTabs).toMatch(/barSlots\(basisManifest/);
    expect(tabs).toMatch(/barSlots\(basisManifest, \{ renderer: renderMobile/);
  });

  it('both hosts take the dial and the press from the shared model, and read the person\'s middle-spot setting', () => {
    for (const src of [webHost, launcher]) {
      expect(src).toMatch(/plusDialFor\(basisManifest/);
      expect(src).toMatch(/plusPress\(/);
      expect(src).toMatch(/getParamValue\?\.\(PLUS_MIDDLE_KEY\)/);
    }
  });

  it('both hosts run the two views a dial button names, and an op through the waist', () => {
    for (const src of [webHost, launcher]) {
      expect(src).toMatch(/plusThread:/);
      expect(src).toMatch(/shareContact:/);
      expect(src).toMatch(/target\?\.kind === 'op'/);
    }
  });

  it('no shell keeps a floating "+" any more', () => {
    expect(webHost).not.toMatch(/mountPlusButton/);
    expect(launcher).not.toMatch(/onPlus=/);
  });

  it('the phone\'s back gesture folds the buttons back first (the web\'s Escape)', () => {
    expect(launcher).toMatch(/if \(plusDialOpen\) \{ setPlusDialOpen\(false\); return true; \}/);
    expect(webTabs).toMatch(/'Escape'/);
  });
});
