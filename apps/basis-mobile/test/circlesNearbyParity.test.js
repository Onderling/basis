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
  it('a self switch fails closed: unlisted before the new self\'s level is read', () => {
    const m = src.match(/if \(levelSelfRef\.current !== roomSelfId\) \{[\s\S]*?\}/)?.[0] ?? '';
    expect(m).toMatch(/roomLevelSetRef\.current = false;/);
    expect(m).toMatch(/screenRef\.current\?\.levelChanged\?\.\(\);/);
    expect(src.indexOf('if (levelSelfRef.current !== roomSelfId)')).toBeLessThan(src.indexOf('await bundle?.nearbyIdentity?.levelState?.()'));
  });
  it('web, the same: the pick resets the level before reading the new one', () => {
    const web = readFileSync(resolve(__dirname, '../../basis/web/v2/circleApp.js'), 'utf8');
    const pick = web.match(/onPick: \(id\) => \{[\s\S]*?readRoomLevel\(\);/)?.[0] ?? '';
    expect(pick).toMatch(/roomLevelSet = false;\s*nearbyScreen\.levelChanged\(\);[\s\S]*readRoomLevel\(\);/);
  });
});
