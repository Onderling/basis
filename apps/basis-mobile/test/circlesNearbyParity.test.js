/**
 * The phone's Circles and Nearby (web twin: apps/basis/test/v2/circlesNearbySweep.dom.test.js): no "Nearby: N devices"
 * row on Circles, the create/join pair in Vandaag's words and one style, no "← circles" on the Nearby tab, "Ask the
 * room" a button, and the room names you by your handle. RN cannot render under Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../src/screens/v2/CircleLauncherScreen.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Circles and Nearby on the phone', () => {
  it('no Nearby row on Circles; the pair in Vandaag\'s words, one style', () => {
    expect(src).not.toMatch(/testID="circle-nearby"/);
    expect(src).toMatch(/variant="primary" testID="launcher-new" label=\{t\('circle\.vandaag\.onboarding_begin_create'\)\}/);
    expect(src).toMatch(/variant="primary" testID="launcher-join" label=\{t\('circle\.vandaag\.onboarding_begin_join'\)\}/);
  });
  it('Nearby: no back link, Ask the room a button, the room names you by your handle', () => {
    expect(src).not.toMatch(/testID="circle-nearby-back"/);
    expect(src).toMatch(/<Btn variant="primary" onPress=\{onCompose\} testID="nearby-ask-compose"/);
    expect(src).toMatch(/nearbyRoomSelfView\(roomR, heldSelves, \{ handle: roomHandle \}\)/);
  });
});
