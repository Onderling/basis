/**
 * Who enters the Nearby room — web ≡ mobile: both decide it with the shared `nearbyRoomSelf` over the switcher's set
 * and a per-device remembered answer, paint `nearbyRoomSelfView` (the line, or the one question) with the same words,
 * and hand the face the room self. Neither decides it itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Nearby room self — parity', () => {
  it('both decide with the shared rule, paint the shared view and feed the face', () => {
    const web = code(read('../../basis/web/v2/circleApp.js')) + code(read('../../basis/web/v2/circleNearby.js'));
    const mobile = code(read('../src/screens/v2/CircleLauncherScreen.js')) + code(read('../src/core/agentBundle.js'));
    for (const src of [web, mobile]) {
      expect(src).toContain('nearbyRoomSelf(');
      expect(src).toContain('nearbyRoomSelfView(');
      expect(src, 'asking is handed as a state').toContain('roomSelfFor(');
      expect(src).toMatch(/roomSelf: \(\) =>/);
      for (const k of ['as_self', 'as_self_pick', 'as_self_caveat']) expect(src, k).toContain(`circle.nearbyScreen.${k}`);
      // an ask is weighed against the room self's drivers, and the shared-skills line shows its offerings — from the identity
      expect(src, 'getDrivers from the identity').toMatch(/getDrivers:\s*\(\)\s*=>\s*\(?[\w?.]*[Nn]earbyIdentity/);
      expect(src, 'mySkills from the identity').toMatch(/mySkills:\s*\(\)\s*=>\s*[\w?.]*[Nn]earbyIdentity/);
    }
  });
});
