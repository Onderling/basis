/**
 * FITNESS — both shells hand the agent the relay map, and both surface the relays they are on.
 *
 * A device is on its own relay AND on every relay its kringen ride (2026-09-08). Three seams make that
 * true rather than merely available, and each one was inert on some shell at some point:
 *
 *   - `circlePointsFor` — the circle → relays map. The routing seam under it had existed since July and
 *     was dead the whole time because NO shell passed the map in: every circle rode whichever relay came
 *     first. A seam nothing reaches is not built.
 *   - `circlesForPeer` — the person → kringen half, which is what lets a message with no circle (a DM, a
 *     receipt) go to a relay that person is actually on instead of only to this device's own.
 *   - `relays` into the connection-points surface — without it the screen labels points from memory and
 *     tells someone a relay that is carrying their kring's traffic is idle.
 *
 * A third shell is fine; a third shell that forgets is not.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

/** Where each shell builds the agent. Mobile composes it across two files — App.js holds what the React
 *  tree owns, `agentBundle.js` what the boot owns — so the shell is both of them together. */
const AGENT_SITES = [
  { name: 'web (circleApp.js)', src: read('../../web/v2/circleApp.js') },
  {
    name: 'mobile (App.js + agentBundle.js)',
    src: read('../../../basis-mobile/App.js') + read('../../../basis-mobile/src/core/agentBundle.js'),
  },
];

/** Where each shell paints the connection points. */
const PANEL_SITES = [
  { name: 'web (circleApp.js)',            src: read('../../web/v2/circleApp.js') },
  { name: 'mobile (CircleLauncherScreen)', src: read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js') },
];

const MAP_SEAMS = [
  ['circlePointsFor', 'every kring rides whichever relay happens to answer first, and a kring on someone '
    + 'else’s relay is unreachable from this device'],
  ['circlesForPeer', 'a direct message goes out over this device’s own relay even when the only relays '
    + 'the recipient is on belong to the kringen we share'],
];

describe('FITNESS — the relay map reaches the agent from every shell', () => {
  for (const { name, src } of AGENT_SITES) {
    for (const [seam, why] of MAP_SEAMS) {
      it(`${name} passes \`${seam}\``, () => {
        expect(src.includes(seam), `${name} does not pass \`${seam}\` — ${why}`).toBe(true);
      });
    }
  }
});

describe('FITNESS — the connection-points surface reads the LIVE relay list', () => {
  for (const { name, src } of PANEL_SITES) {
    it(`${name} feeds the panel from agent.relays.list()`, () => {
      expect(/relays[:=]/.test(src) && src.includes('relays?.list?.()'),
        `${name} labels connection points from memory instead of from the sockets that are open`).toBe(true);
    });
    it(`${name} can add a relay by hand`, () => {
      expect(src.includes('addRelay'),
        `${name} offers no way to be on a relay someone hosts themselves`).toBe(true);
    });
  }
});
