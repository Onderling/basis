/**
 * Vandaag's "+" — web ≡ mobile, from ONE source: both shells paint the acts from the shared `PLUS_ACTS`, compile a save
 * through `plusOp` (the op through the waist), add the showing block through `plusFollowUp`, and tag own rows through
 * `whereTag`. RN cannot render under Vitest, so this reads the sources.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Vandaag "+" — parity', () => {
  const webHost = code(read('../../basis/web/v2/circleApp.js'));
  const mobileHost = code(read('../src/screens/v2/CircleLauncherScreen.js'));
  it('both sheets paint the shared acts', () => {
    expect(code(read('../../basis/web/v2/vandaagPlus.js'))).toMatch(/PLUS_ACTS/);
    expect(code(read('../src/screens/v2/VandaagPlusModal.js'))).toMatch(/PLUS_ACTS/);
  });
  it('both hosts compile a save through plusOp and add the showing block through plusFollowUp', () => {
    for (const src of [webHost, mobileHost]) {
      expect(src).toMatch(/plusOp\(/);
      expect(src).toMatch(/plusFollowUp\(/);
      expect(src).not.toMatch(/OWN_DEVICES_SCOPE/);   // the scope is the model's to name, never a shell's
    }
  });
  it('both block painters tag a row through whereTag', () => {
    expect(code(read('../../basis/web/v2/circleScreen.js')).match(/whereTag\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(code(read('../src/screens/v2/CircleScreenView.js')).match(/whereTag\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
