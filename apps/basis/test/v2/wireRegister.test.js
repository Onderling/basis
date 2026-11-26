// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * The wire register: the shape check refuses what is not a row's shape, and the register agrees with the constants the
 * rails and doors send by. The check runs under test at the one wire call (test/support/wireShapeCheck.setup.js) and in
 * no shell build.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WIRE, UNNAMED, NOT_HERE, WIRE_HOMES, VALUE_KINDS, wireShapeProblem, wireNamesOf, wireShapeCheckSet } from '../../src/v2/wireRegister.js';
import { DIRECT_WIRE } from '../../src/v2/directDoors.js';
import { CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { KEY_STATEMENT_BROADCAST } from '../../src/v2/keyRail.js';
import { ITEMS_BROADCAST, OWN_ITEMS_CATCHUP_SUBTYPES } from '../../src/v2/itemsRail.js';
import { MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { GRANTS_BROADCAST } from '../../src/v2/grantsRail.js';
import { SCREEN_OFFER_SUBTYPE, SCREEN_WAITING_SUBTYPE, SCREEN_REFUSED_SUBTYPE } from '../../src/v2/screenView.js';
import { COMPANION_GRANT_SUBTYPE } from '../../src/v2/companionGrant.js';
import { IDENTITY_LINK_SUBTYPE, IDENTITY_LINK_REVOKE_SUBTYPE } from '../../src/v2/identityLink.js';
import { SCREEN_NUDGE_SUBTYPE } from '../../src/v2/screenNudge.js';
import { SURFACE_NUDGE_SUBTYPE } from '../../src/v2/surfaceNudge.js';
import { SCREEN_STEP_UP_SUBTYPE } from '../../src/v2/screenStepUp.js';
import { CONNECTION_GRANT_SUBTYPE } from '../../src/v2/connectionPairing.js';
import { NEARBY_ROOM_SUBTYPES } from '../../src/v2/nearbyRoomBinding.js';
import { NOT_UNDERSTOOD_SUBTYPE } from '../../src/v2/notUnderstood.js';
import { PERSON_KEY_CHAIN_SUBTYPES } from '../../src/v2/personKeyChain.js';
import { CONTACT_TURN_BROADCAST } from '../../src/v2/contactTurnFan.js';
import { PRIMARY_DEVICE_SUBTYPES, SPINE_POINT_SUBTYPES } from '../../src/v2/primaryDevice.js';
import { CIRCLE_FOLLOW_SUBTYPES } from '../../src/v2/circleFollowSync.js';
import { DEFAULT_CONTACT_SUBTYPES } from '../../src/v2/contactThreadChannel.js';

describe('the shape check', () => {
  it('a row\'s own shape passes, flat or inside the A2A data part', () => {
    expect(wireShapeProblem({ subtype: 'delivery-receipt', messageId: 'm1' })).toBeNull();
    expect(wireShapeProblem({ type: 'message', parts: [{ type: 'DataPart', data: { subtype: 'delivery-receipt', messageId: 'm1' } }] })).toBeNull();
  });
  it('a subtype with no row is refused', () => {
    expect(wireShapeProblem({ subtype: 'made-up-kind' })).toMatch(/no row/);
  });
  it('a key that is not a field, a missing required field, and a wrong kind are each refused', () => {
    expect(wireShapeProblem({ subtype: 'delivery-receipt', messageId: 'm1', extra: 1 })).toMatch(/'extra' is not a field/);
    expect(wireShapeProblem({ subtype: 'delivery-receipt' })).toMatch(/'messageId' is required and missing/);
    expect(wireShapeProblem({ subtype: 'delivery-receipt', messageId: 7 })).toMatch(/'messageId' is string, sent number/);
    expect(wireShapeProblem({ subtype: 'device-known-peers', peers: {} })).toMatch(/'peers' is list, sent object/);
  });
  it('an optional field may be absent or null; a required one may not be null', () => {
    expect(wireShapeProblem({ subtype: 'not-understood', of: 'x' })).toBeNull();
    expect(wireShapeProblem({ subtype: 'not-understood', of: 'x', wire: null })).toBeNull();
    expect(wireShapeProblem({ subtype: 'not-understood', of: null })).toMatch(/'of' is required, sent null/);
  });
  it('a payload with no subtype passes only as a declared unnamed row', () => {
    expect(wireShapeProblem({ __pairReq: { addr: 'a', circleId: 'c' } })).toBeNull();
    expect(wireShapeProblem({ text: 'hoi' })).toMatch(/no subtype/);
  });
});

describe('the register', () => {
  it('every row has a known home, version 1 for now, and fields of known kinds', () => {
    const bad = [];
    for (const [name, r] of Object.entries({ ...WIRE, ...UNNAMED })) {
      if (!WIRE_HOMES.includes(r.home)) bad.push(`${name}: home ${r.home}`);
      if (r.v !== 1) bad.push(`${name}: v ${r.v}`);
      for (const [k, kind] of Object.entries(r.fields)) if (!VALUE_KINDS.includes(kind.replace(/\?$/, ''))) bad.push(`${name}.${k}: ${kind}`);
    }
    expect(bad).toEqual([]);
  });
  it('agrees with the constants the rails and doors send by (the constant and its row are one fact)', () => {
    const named = [
      CHAT_STATEMENT_BROADCAST, KEY_STATEMENT_BROADCAST, ITEMS_BROADCAST, MEMBERSHIP_BROADCAST, GRANTS_BROADCAST,
      SCREEN_OFFER_SUBTYPE, SCREEN_WAITING_SUBTYPE, SCREEN_REFUSED_SUBTYPE, COMPANION_GRANT_SUBTYPE, IDENTITY_LINK_SUBTYPE,
      IDENTITY_LINK_REVOKE_SUBTYPE, SCREEN_NUDGE_SUBTYPE, SURFACE_NUDGE_SUBTYPE, SCREEN_STEP_UP_SUBTYPE, CONNECTION_GRANT_SUBTYPE,
      NOT_UNDERSTOOD_SUBTYPE, CONTACT_TURN_BROADCAST, ...NEARBY_ROOM_SUBTYPES, ...Object.values(PERSON_KEY_CHAIN_SUBTYPES),
      ...Object.values(OWN_ITEMS_CATCHUP_SUBTYPES), ...Object.values(PRIMARY_DEVICE_SUBTYPES), ...Object.values(SPINE_POINT_SUBTYPES),
      ...Object.values(CIRCLE_FOLLOW_SUBTYPES), ...Object.values(DEFAULT_CONTACT_SUBTYPES),
    ];
    expect(named.filter((s) => !WIRE[s])).toEqual([]);
  });
  it('the Nearby room speaks only direct rows (a block holds in the room)', () => {
    expect(NEARBY_ROOM_SUBTYPES.filter((s) => WIRE[s]?.home !== 'direct')).toEqual([]);
    expect(wireNamesOf('direct')).toContain(NOT_UNDERSTOOD_SUBTYPE);
  });
  it('names what it does not hold, each pointing at the file that does', () => {
    for (const k of ['hello', 'skillCalls', 'laneStatements', 'relayFrames', 'links', 'podRows']) expect(NOT_HERE[k], k).toMatch(/held by /);
  });
});

describe('no behaviour change: the outbound block list is what it was before the register', () => {
  it('DIRECT_WIRE is exactly the old list', () => {
    const OLD = [
      'contact-msg', 'contact-reply', 'file-share', 'chat-message', 'shared-copy', 'delivery-receipt', 'calendar-invite',
      'calendar-rsvp', 'calendar-cancel', 'group-redeem-request', 'group-redeem-response',
      'screen-offer', 'screen-waiting', 'companion-grant', 'identity-link-revoke', 'screen-nudge', 'surface-lane-nudge',
      ...NEARBY_ROOM_SUBTYPES, 'not-understood',
    ];
    expect([...DIRECT_WIRE].sort()).toEqual([...OLD].sort());
  });
});

describe('the check is on under test and in no shell', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  it('the test setup set it, and the one wire call runs it', () => {
    expect(wireShapeCheckSet()).toBe(true);
    expect(readFileSync(path.join(root, 'src/core/agent/realAgent.js'), 'utf8')).toMatch(/async function wireSend\([^)]*\) \{\n(?:\s*\/\/[^\n]*\n)*\s*runWireShapeCheck\(payload\);/);
  });
  it('no file outside test/ calls the setter', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (f === 'node_modules' || f.startsWith('.') || f === 'test' || f === 'test-browser') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(m?js|jsx)$/.test(f) && /\bsetWireShapeCheck\(/.test(readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
      }
    };
    for (const d of ['src', 'web', 'bin', '../basis-mobile/src']) walk(path.join(root, d));
    expect(offenders.filter((f) => f !== 'src/v2/wireRegister.js')).toEqual([]);
  });
});
