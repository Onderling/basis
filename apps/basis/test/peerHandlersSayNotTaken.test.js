/**
 * EVERY PEER HANDLER SAYS WHEN IT DID NOT TAKE A FRAME. The secure agent keeps a durable record of the messages this
 * device has taken (per sender and message id) and drops a repeat of one before any handler. It records a message
 * only when the handler's verdict is not `{ refused: true }`. So a handler that returns early on a state that can
 * still change — the signer not on the roster yet, the sender not yet known as a sibling, a pod ref not served yet,
 * an ingest that threw — must say `{ refused: true }`, or the copy that arrives after the fold is dropped as a repeat
 * and the message is lost for good.
 *
 * Each handler is named here, with the state it must refuse. A new `make…PeerHandler` in `src/v2` fails the last
 * test until it is added to the list below with its own case.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePeerRouter, NOT_TAKEN } from '../src/core/handlers/peerRouter.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { makeItemsPeerHandler, ITEMS_BROADCAST } from '../src/v2/itemsRail.js';
import { makeChatPeerHandler, CHAT_STATEMENT_BROADCAST } from '../src/v2/chatRail.js';
import { makeKeyPeerHandler, KEY_STATEMENT_BROADCAST } from '../src/v2/keyRail.js';
import { makeCircleGovernancePeerHandler, makeCircleReportPeerHandler } from '../src/v2/circleLogReceiver.js';
import { makeGrantsPeerHandler, GRANTS_BROADCAST } from '../src/v2/grantsRail.js';
import { makeContactTurnPeerHandler, CONTACT_TURN_BROADCAST } from '../src/v2/contactTurnFan.js';
import { REPORT_STATEMENT_KINDS } from '../src/v2/reportLane.js';

const refused = (v) => v?.refused === true;
const statement = { body: { kind: 'join', hash: 'h1', subject: 's1', payload: {} }, sig: 'sig' };
const notYetFolded = { ingest: async () => ({ ok: false, reason: 'signer-not-on-roster' }), verify: async () => ({ ok: false }), hasEntry: () => false };
const landed = { ingest: async () => ({ ok: true, existed: false }), verify: async () => ({ ok: true }), hasEntry: () => false };
const throwing = { ingest: async () => { throw new Error('store locked'); } };

/** name → { make(rail), payload } for the signed lanes: one shape, one table. */
const LANES = {
  makeMembershipPeerHandler:       { make: (rail) => makeMembershipPeerHandler({ rail }), payload: { subtype: MEMBERSHIP_BROADCAST, circleId: 'c', event: statement } },
  makeItemsPeerHandler:            { make: (rail) => makeItemsPeerHandler({ rail }), payload: { subtype: ITEMS_BROADCAST, circleId: 'c', event: statement } },
  makeChatPeerHandler:             { make: (rail) => makeChatPeerHandler({ rail }), payload: { subtype: CHAT_STATEMENT_BROADCAST, circleId: 'c', event: statement } },
  makeKeyPeerHandler:              { make: (rail) => makeKeyPeerHandler({ rail }), payload: { subtype: KEY_STATEMENT_BROADCAST, circleId: 'c', event: statement } },
  makeCircleGovernancePeerHandler: { make: (rail) => makeCircleGovernancePeerHandler({ rail, eventLog: { query: () => [] } }), payload: { subtype: 'circle-governance-broadcast', circleId: 'c', event: { ...statement, body: { ...statement.body, kind: 'vote' } } } },
  makeCircleReportPeerHandler:     { make: (rail) => makeCircleReportPeerHandler({ rail }), payload: { subtype: 'circle-report-broadcast', circleId: 'c', event: { ...statement, body: { ...statement.body, kind: REPORT_STATEMENT_KINDS[0] } } } },
  makeGrantsPeerHandler:           { make: (rail) => makeGrantsPeerHandler({ rail }), payload: { subtype: GRANTS_BROADCAST, event: statement } },
};

/** Handlers outside the lane shape, each with its own fold-pending case below. */
const OTHERS = ['makeContactTurnPeerHandler', 'makeCircleAddressAnnouncePeerHandler'];

describe('every peer handler says when it did not take a frame', () => {
  for (const [name, lane] of Object.entries(LANES)) {
    it(`${name}: a statement the rail refuses (its signer not folded yet) is NOT taken`, async () => {
      expect(refused(await lane.make(notYetFolded)('peer', lane.payload))).toBe(true);
    });
    it(`${name}: an ingest that throws is NOT taken`, async () => {
      expect(refused(await lane.make(throwing)('peer', lane.payload))).toBe(true);
    });
    it(`${name}: a statement that landed IS taken`, async () => {
      expect(refused(await lane.make(landed)('peer', lane.payload))).toBe(false);
    });
  }

  it('makeItemsPeerHandler / makeChatPeerHandler: a kring this device does not hold now is NOT taken (it may be turned on)', async () => {
    const items = makeItemsPeerHandler({ rail: landed, holds: () => null });
    const chat = makeChatPeerHandler({ rail: landed, holds: () => null });
    expect(refused(await items('peer', LANES.makeItemsPeerHandler.payload))).toBe(true);
    expect(refused(await chat('peer', LANES.makeChatPeerHandler.payload))).toBe(true);
  });

  it('makeChatPeerHandler: a pod ref that cannot be read yet is NOT taken', async () => {
    const chat = makeChatPeerHandler({ rail: landed, resolveRef: async () => null });
    expect(refused(await chat('peer', { subtype: CHAT_STATEMENT_BROADCAST, circleId: 'c', ref: 'pod://row', msgId: 'm1' }))).toBe(true);
  });

  it('makeContactTurnPeerHandler: a turn from a sibling this device has not folded yet is NOT taken', async () => {
    const h = makeContactTurnPeerHandler({ siblings: async () => [], selfPubKey: 'me', applyTurn: async () => {} });
    const turn = { contactId: 'k1', origin: 'user', text: 'hoi', messageId: 'm1', ts: 1 };
    const v = await h('new-sibling', { subtype: CONTACT_TURN_BROADCAST, turn });
    expect(refused(v)).toBe(true);
    const known = makeContactTurnPeerHandler({ siblings: async () => ['new-sibling'], selfPubKey: 'me', applyTurn: async () => {} });
    const ok = await known('new-sibling', { subtype: CONTACT_TURN_BROADCAST, turn });
    expect(refused(ok)).toBe(false);
  });

  it('the router hands the verdict on: a throw, a rejection and an unhandled subtype are NOT taken', async () => {
    const quiet = { info() {}, error() {}, debug() {} };
    const r = makePeerRouter({ logger: quiet, handlers: { boom: () => { throw new Error('x'); }, nope: async () => { throw new Error('y'); }, ok: () => undefined, no: () => ({ refused: true }) } });
    expect(await r({ from: 'p', payload: { subtype: 'boom' } })).toBe(NOT_TAKEN);
    expect(await r({ from: 'p', payload: { subtype: 'nope' } })).toBe(NOT_TAKEN);
    expect(await r({ from: 'p', payload: { subtype: 'unheard-of' } })).toBe(NOT_TAKEN);
    expect(refused(await r({ from: 'p', payload: { subtype: 'ok' } }))).toBe(false);
    expect(refused(await r({ from: 'p', payload: { subtype: 'no' } }))).toBe(true);
  });

  it('no peer handler factory in src/v2 is missing from this list', () => {
    const dir = fileURLToPath(new URL('../src/v2/', import.meta.url));
    const found = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/export function (make[A-Za-z]*PeerHandler)\b/g)) found.push(m[1]);
    }
    const covered = new Set([...Object.keys(LANES), ...OTHERS]);
    expect(found.filter((n) => !covered.has(n)), 'a peer handler with no not-taken case here — add it with the state it must refuse').toEqual([]);
  });
});
