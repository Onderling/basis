/**
 * FITNESS — EVERY LISTED SUBTYPE HAS A HANDLER IN THE WEB'S AND THE PHONE'S ROUTER, or is declared one shell's. Since a
 * subtype no handler takes is ANSWERED as not understood (src/v2/notUnderstood.js), a subtype one current shell routes
 * and another lacks would be answered between two current builds: a shell gap posing as an older Basis. This reads the
 * same handler maps as the direct-doors fitness test (the lane table, the shared inbound wiring, web's own map, the
 * phone's own map) and fails when a subtype on the lists of `src/v2/directDoors.js` is missing from a shell's router
 * without a declared reason below. (The reverse, a routed subtype on neither list, is that test's job.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIRECT_SUBTYPES, CIRCLE_SUBTYPES } from '../../src/v2/directDoors.js';

const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
function region(src, startRe, endRe) {
  const a = src.search(startRe); if (a < 0) return '';
  const rest = src.slice(a); const b = rest.search(endRe); return b < 0 ? rest : rest.slice(0, b);
}
/** The handler keys in a map block, by the same reading as blockedDirectDoors.test.js. */
function keysOf(block) {
  const out = new Set();
  const keyRe = /(?:'([a-z0-9][a-z0-9:-]{3,})'|\[([A-Z_][A-Z0-9_]{3,})\]|\[[\w.]*[cC]ontactChannel\.subtypes\.(in|out)\]|\[[\w.]+\.subtypes\.(request|offer|batch)\])\s*:\s*/g;
  for (const m of block.matchAll(keyRe)) out.add(m[1] ?? m[2] ?? (m[3] ? (m[3] === 'in' ? 'contact-reply' : 'contact-msg') : `catchup:${m[4]}`));
  return out;
}

const LANES = rd('../../src/v2/circleLanes.js');
const WIRING = rd('../../src/v2/inboundWiring.js');
const WEB = region(rd('../../web/v2/circleApp.js'), /const peerMessageRouter = makePeerRouter\(\{/, /\n\s*defaultHandler/);
const PHONE = rd('../../../basis-mobile/src/core/phoneInboundWiring.js');

/** What each shell's router holds: web spreads the lane table into its own map; the phone builds the shared wiring
 *  (which spreads the lane table) and adds its own. */
const SHELLS = {
  web: new Set([...keysOf(LANES), ...keysOf(WEB)]),
  phone: new Set([...keysOf(LANES), ...keysOf(WIRING), ...keysOf(PHONE)]),
};

/**
 * A listed subtype one shell does not route ON PURPOSE, with why. Anything else missing is a gap to fix (or declare).
 * Keyed by subtype, then shell.
 */
const ONE_SHELL = Object.freeze({
  // the box's own doors: a screen that offers to connect to it, a companion's grant, a bot link's revoke
  SCREEN_OFFER_SUBTYPE: { web: 'a box door: a screen offers to connect to the box', phone: 'a box door: a screen offers to connect to the box' },
  SCREEN_WAITING_SUBTYPE: { web: 'a box door: the screen says it waits for the box', phone: 'a box door: the screen says it waits for the box' },
  COMPANION_GRANT_SUBTYPE: { web: 'a box door: a companion grants the box access', phone: 'a box door: a companion grants the box access' },
  IDENTITY_LINK_REVOKE_SUBTYPE: { web: 'a bot\'s door: the person revokes a bot\'s link', phone: 'a bot\'s door: the person revokes a bot\'s link' },
});

describe('FITNESS — every listed subtype is routed by the web and by the phone, or declared one shell\'s', () => {
  for (const [shell, keys] of Object.entries(SHELLS)) {
    it(`${shell}: reads a real handler map`, () => { expect(keys.size, `${shell}: no handler keys found`).toBeGreaterThan(5); });
    it(`${shell}: no listed subtype is missing without a declared reason`, () => {
      const missing = [...DIRECT_SUBTYPES, ...CIRCLE_SUBTYPES].filter((s) => !keys.has(s) && !ONE_SHELL[s]?.[shell]);
      expect(missing, `${shell}: listed in directDoors.js but not routed here (a current build would answer it as not understood)`).toEqual([]);
    });
  }
  it('a declared exception is still true: the shell really does not route it', () => {
    const stale = [];
    for (const [s, per] of Object.entries(ONE_SHELL)) for (const shell of Object.keys(per)) if (SHELLS[shell]?.has(s)) stale.push(`${s} on ${shell}`);
    expect(stale, 'declared one-shell but routed here: drop the declaration').toEqual([]);
  });
});
