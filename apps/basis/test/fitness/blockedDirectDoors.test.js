/**
 * FITNESS — EVERY DIRECT DOOR ASKS THE BLOCK LIST FIRST; NO CIRCLE DOOR DOES (Frits 2026-11-12: a block is about direct
 * contact, never a circle; Fable's condition on it). The secure agent enforces nothing, so a direct path that forgets to
 * ask lets a blocked person in. This reads every handler map a shell routes (the shared lane table, the shared inbound
 * wiring, web's own map, the box's own map) and fails when:
 *   - a routed subtype is in neither list of `src/v2/directDoors.js` (decide which it is), or in both;
 *   - a DIRECT subtype's handler is not wrapped in `blockedFirst(` (it would not ask);
 *   - a CIRCLE subtype's handler is (circle traffic must fold the same on every member's device).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIRECT_SUBTYPES, CIRCLE_SUBTYPES, isDirectPayload } from '../../src/v2/directDoors.js';

const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
function region(src, startRe, endRe) {
  const a = src.search(startRe); if (a < 0) return '';
  const rest = src.slice(a); const b = rest.search(endRe); return b < 0 ? rest : rest.slice(0, b);
}
/** Each handler key in a map block, with the handler text after it: [name, handlerText]. */
function entriesOf(block) {
  const out = [];
  const keyRe = /(?:'([a-z0-9][a-z0-9-]{3,})'|\[([A-Z_][A-Z0-9_]{3,})\]|\[[\w.]*[cC]ontactChannel\.subtypes\.(in|out)\]|\[[\w.]+\.subtypes\.(request|offer|batch)\])\s*:\s*/g;
  for (const m of block.matchAll(keyRe)) {
    const name = m[1] ?? m[2] ?? (m[3] ? (m[3] === 'in' ? 'contact-reply' : 'contact-msg') : `catchup:${m[4]}`);
    out.push([name, block.slice(m.index + m[0].length, m.index + m[0].length + 40)]);
  }
  return out;
}

const WEB = rd('../../web/v2/circleApp.js');
const BLOCKS = {
  lanes: rd('../../src/v2/circleLanes.js'),
  wiring: rd('../../src/v2/inboundWiring.js'),
  web: region(WEB, /const peerMessageRouter = makePeerRouter\(\{/, /\n\s*defaultHandler/),
  box: region(rd('../../bin/device-runner.mjs'), /makePeerRouter\(\{/, /\n\s*defaultHandler/),
};

describe('FITNESS — every direct door asks the block list first; no circle door does', () => {
  it('the lists do not overlap', () => {
    expect(DIRECT_SUBTYPES.filter((s) => CIRCLE_SUBTYPES.includes(s))).toEqual([]);
  });

  for (const [name, block] of Object.entries(BLOCKS)) {
    const entries = entriesOf(block);
    it(`${name}: reads a real handler map`, () => { expect(entries.length, `${name}: no handler keys found`).toBeGreaterThan(3); });

    it(`${name}: every routed subtype is DIRECT or CIRCLE`, () => {
      const unclassified = entries.map(([k]) => k).filter((k) => !DIRECT_SUBTYPES.includes(k) && !CIRCLE_SUBTYPES.includes(k));
      expect([...new Set(unclassified)], `${name}: routed but in neither list (src/v2/directDoors.js)`).toEqual([]);
    });

    it(`${name}: every DIRECT handler asks first (blockedFirst), no CIRCLE handler does`, () => {
      const unasked = entries.filter(([k, h]) => DIRECT_SUBTYPES.includes(k) && !/^blockedFirst\(/.test(h)).map(([k]) => k);
      expect(unasked, `${name}: a direct door that does not ask the block list`).toEqual([]);
      const asked = entries.filter(([k, h]) => CIRCLE_SUBTYPES.includes(k) && /^blockedFirst\(/.test(h)).map(([k]) => k);
      expect(asked, `${name}: a circle door that asks the block list (circle traffic must never)`).toEqual([]);
    });
  }

  it('the Nearby room\'s spread handlers (direct contact) are wrapped wherever they are spread', () => {
    for (const [name, src] of [['wiring', BLOCKS.wiring], ['web', BLOCKS.web], ['box', BLOCKS.box]]) {
      const bare = [...src.matchAll(/\.\.\.\(?\s*(?:ensureNearbyRoom\([^)]*\)|\w*[nN]earby\w*)\??\.handlers/g)].map((m) => m[0]);
      expect(bare, `${name}: the Nearby room's handlers spread without blockedAll`).toEqual([]);
    }
  });

  it('mobile: the phone\'s own composition routes through the shared wiring; a direct subtype it adds itself must ask too', () => {
    const phone = rd('../../../basis-mobile/src/core/phoneInboundWiring.js');
    expect(phone, 'the phone no longer builds through the shared wiring').toMatch(/buildInboundWiring\(/);
    const unasked = entriesOf(phone).filter(([k, h]) => DIRECT_SUBTYPES.includes(k) && !/^blockedFirst\(/.test(h)).map(([k]) => k);
    expect(unasked, 'mobile: a direct door of its own that does not ask the block list').toEqual([]);
  });

  it('outbound: a direct payload is recognised by its wire subtype, flat or inside the A2A part; circle traffic is not', () => {
    expect(isDirectPayload({ subtype: 'contact-msg' })).toBe(true);
    expect(isDirectPayload({ subtype: 'delivery-receipt' })).toBe(true);
    expect(isDirectPayload({ subtype: 'screen-offer' })).toBe(true);
    expect(isDirectPayload({ type: 'message', parts: [{ type: 'DataPart', data: { subtype: 'chat-message' } }] })).toBe(true);
    expect(isDirectPayload({ subtype: 'circle-governance-broadcast' })).toBe(false);
    expect(isDirectPayload({ subtype: 'membership-statement' })).toBe(false);
  });
});
