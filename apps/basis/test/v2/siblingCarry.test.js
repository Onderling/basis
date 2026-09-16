/**
 * The one sibling carry (L100): a person's other devices as a standing peer of every circle lane — one
 * mechanism, the lane's own wire payload, after a write and after a landing, never for what a sibling carried.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeSiblingCarry } from '../../src/v2/siblingCarry.js';
import { buildCircleLanes, carryLandedStatement } from '../../src/v2/circleLanes.js';
import { CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { TASK_BROADCAST } from '../../src/v2/taskRail.js';
import { MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { KEY_STATEMENT_BROADCAST } from '../../src/v2/keyRail.js';
import { makeGrantsFan, GRANTS_BROADCAST } from '../../src/v2/grantsRail.js';
import { makeContactTurnFan, CONTACT_TURN_BROADCAST } from '../../src/v2/contactTurnFan.js';
import { createKnownPeersSync, KNOWN_PEERS_BROADCAST } from '../../src/v2/knownPeersSync.js';
import { makeCircleGovernancePeerHandler } from '../../src/v2/circleLogReceiver.js';

const SIBS = ['addr:box', 'addr:laptop'];
const stmt = { body: { kind: 'chat', subject: 'm1', hash: 'h1' }, sig: 'sig' };
const chatPayload = { subtype: CHAT_STATEMENT_BROADCAST, circleId: 'k1', event: stmt, msgId: 'm1', ts: 1 };

describe('makeSiblingCarry', () => {
  it('an OWN write goes to every sibling, over hold-forward, with the lane payload untouched', async () => {
    const sendToPeer = vi.fn(async () => ({ delivered: true }));
    const { carry } = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer });
    const r = await carry(chatPayload);
    expect(r).toMatchObject({ attempted: 2, skipped: null });
    expect(sendToPeer.mock.calls.map((c) => c[0]).sort()).toEqual([...SIBS].sort());
    for (const [, payload, opts] of sendToPeer.mock.calls) { expect(payload).toBe(chatPayload); expect(opts).toEqual({ guarantee: 'hold-forward' }); }
  });

  it('a statement that LANDED from a member goes to every sibling but never back to the carrier', async () => {
    const sendToPeer = vi.fn(async () => ({ held: true }));
    const { carry } = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer });
    const r = await carry(chatPayload, { from: 'addr:member-bea' });
    expect(r.attempted).toBe(2);
    expect(r.outcomes.map((o) => o.held)).toEqual([true, true]);
  });

  it('what a SIBLING carried here is not carried on — the set was already reached', async () => {
    const sendToPeer = vi.fn();
    const { carry } = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer });
    expect(await carry(chatPayload, { from: 'addr:box' })).toEqual({ attempted: 0, skipped: 'carried-by-a-sibling', outcomes: [] });
    expect(sendToPeer).not.toHaveBeenCalled();
  });

  it('a one-device person, an unavailable sibling lookup, or a failing send: nothing thrown, the outcome says so', async () => {
    const onWarn = vi.fn();
    const none = makeSiblingCarry({ siblings: async () => [], sendToPeer: vi.fn() });
    expect((await none.carry(chatPayload)).attempted).toBe(0);
    const broken = makeSiblingCarry({ siblings: async () => { throw new Error('roster down'); }, sendToPeer: vi.fn() });
    expect((await broken.carry(chatPayload)).attempted).toBe(0);
    const failing = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer: async () => { throw new Error('no route'); }, onWarn });
    const r = await failing.carry(chatPayload);
    expect(r.outcomes.every((o) => o.delivered === false && o.error === 'no route')).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(2);
  });

  it('refuses what is not a lane payload; a PERSONAL channel payload (no circle) is carried', async () => {
    const sendToPeer = vi.fn(async () => ({ delivered: true }));
    const { carry } = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer });
    for (const bad of [null, {}, { circleId: 'k1' }, { subtype: '' }]) expect((await carry(bad)).skipped).toBe('not-a-lane-payload');
    expect((await carry({ subtype: GRANTS_BROADCAST, event: stmt })).attempted).toBe(2);
  });
});

describe('the lane table hands every landed chat and task statement to the carry', () => {
  // Enough of a rail for the lane table's catch-ups to construct; only ingest matters here.
  const railStub = (ingest) => ({
    ingest, hasEntry: () => false, storedStatements: () => [], statementsFor: () => [], frontier: () => ({}),
    headsFor: () => ({}), serve: () => [], declaredKinds: [], newerThan: () => [], owed: () => [],
  });
  const fakeAgent = (carry) => ({
    siblingCarry: { carry },
    chatRail: railStub(async (_c, s) => ({ ok: true, existed: false, entry: { id: s.body.subject } })),
    taskRail: railStub(async () => ({ ok: true, existed: false, entry: { id: 'task:h1' } })),
    sendPeerMessage: async () => ({}),
  });

  it('chat: the landed statement rides the lane payload, with the address it arrived from', async () => {
    const carry = vi.fn(async () => ({ attempted: 1 }));
    const { handlers } = buildCircleLanes({ agent: fakeAgent(carry) });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:member-bea', chatPayload);
    expect(carry).toHaveBeenCalledTimes(1);
    const [payload, opts] = carry.mock.calls[0];
    expect(payload).toMatchObject({ subtype: CHAT_STATEMENT_BROADCAST, circleId: 'k1', event: stmt, msgId: 'm1' });
    expect(opts).toEqual({ from: 'addr:member-bea' });
  });

  it('task: the same, keyed by the statement hash', async () => {
    const carry = vi.fn(async () => ({ attempted: 1 }));
    const { handlers } = buildCircleLanes({ agent: fakeAgent(carry) });
    const taskStmt = { body: { kind: 'snapshot', subject: 't1', hash: 'h1' }, sig: 'sig' };
    await handlers[TASK_BROADCAST]('addr:member-bea', { subtype: TASK_BROADCAST, circleId: 'k1', event: taskStmt, msgId: 'task:h1', ts: 1 });
    expect(carry.mock.calls[0][0]).toMatchObject({ subtype: TASK_BROADCAST, circleId: 'k1', event: taskStmt, msgId: 'task:h1' });
    expect(carry.mock.calls[0][1]).toEqual({ from: 'addr:member-bea' });
  });

  it('a statement already held is NOT carried again (the rail said existed)', async () => {
    const carry = vi.fn();
    const agent = fakeAgent(carry);
    agent.chatRail.ingest = async () => ({ ok: true, existed: true, entry: { id: 'm1' } });
    agent.taskRail.ingest = async () => ({ ok: true, existed: true, entry: { id: 'task:h1' } });
    const { handlers } = buildCircleLanes({ agent });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:x', chatPayload);
    await handlers[TASK_BROADCAST]('addr:x', { subtype: TASK_BROADCAST, circleId: 'k1', event: stmt, msgId: 'task:h1' });
    expect(carry).not.toHaveBeenCalled();
  });

  it('a composition without a carry lands statements exactly as before', async () => {
    const agent = fakeAgent(null); delete agent.siblingCarry;
    const { handlers } = buildCircleLanes({ agent });
    await expect(handlers[CHAT_STATEMENT_BROADCAST]('addr:x', chatPayload)).resolves.toBeUndefined();
    expect(await carryLandedStatement({ carry: null, subtype: CHAT_STATEMENT_BROADCAST, circleId: 'k1', statement: stmt })).toBe(null);
  });
});

describe('the other lanes hand a landed statement to the same carry', () => {
  const railStub = (ingest) => ({
    ingest, hasEntry: () => false, storedStatements: () => [], statementsFor: () => [], frontier: () => ({}),
    headsFor: () => ({}), serve: () => [], declaredKinds: [], newerThan: () => [], owed: () => [], readVerifiedBodies: () => [],
  });
  const landing = async () => ({ ok: true, existed: false, entry: { id: 'x' } });
  const held = async () => ({ ok: true, existed: true, entry: { id: 'x' } });

  it('membership + keys: carried once, keyed by the statement hash, never when the rail already held it', async () => {
    const carry = vi.fn(async () => ({ attempted: 1 }));
    const agent = { siblingCarry: { carry }, membershipRail: railStub(landing), keyRail: railStub(landing), rosterReads: { invalidate: () => {} }, sendPeerMessage: async () => ({}) };
    const { handlers } = buildCircleLanes({ agent });
    const mem = { body: { kind: 'role', subject: 'w:bob', hash: 'mh' }, sig: 's' };
    const key = { body: { kind: 'key-rotate', subject: 'v2', hash: 'kh' }, sig: 's' };
    await handlers[MEMBERSHIP_BROADCAST]('addr:bea', { subtype: MEMBERSHIP_BROADCAST, circleId: 'k1', event: mem });
    await handlers[KEY_STATEMENT_BROADCAST]('addr:bea', { subtype: KEY_STATEMENT_BROADCAST, circleId: 'k1', event: key });
    expect(carry.mock.calls.map((c) => [c[0].subtype, c[0].msgId, c[1].from])).toEqual([
      [MEMBERSHIP_BROADCAST, 'mem:mh', 'addr:bea'], [KEY_STATEMENT_BROADCAST, 'key:kh', 'addr:bea'],
    ]);
    const quiet = vi.fn();
    const again = buildCircleLanes({ agent: { ...agent, siblingCarry: { carry: quiet }, membershipRail: railStub(held), keyRail: railStub(held) } });
    await again.handlers[MEMBERSHIP_BROADCAST]('addr:bea', { subtype: MEMBERSHIP_BROADCAST, circleId: 'k1', event: mem });
    await again.handlers[KEY_STATEMENT_BROADCAST]('addr:bea', { subtype: KEY_STATEMENT_BROADCAST, circleId: 'k1', event: key });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('governance: the shells hand their handler the lane table\'s reaction; it fires for a NEW statement only', async () => {
    const carry = vi.fn(async () => ({ attempted: 1 }));
    const { landedCarrier } = buildCircleLanes({ agent: { siblingCarry: { carry }, sendPeerMessage: async () => ({}) } });
    const gov = { body: { kind: 'vote', subject: 'p1', hash: 'gh', payload: {} }, sig: 's' };
    const eventLog = { query: () => [] };
    const handler = makeCircleGovernancePeerHandler({ eventLog, rail: { ingest: async () => ({ ok: true }) }, onLanded: landedCarrier.governance });
    await handler('addr:bea', { subtype: 'circle-governance-broadcast', circleId: 'k1', event: gov });
    expect(carry.mock.calls[0][0]).toMatchObject({ subtype: 'circle-governance-broadcast', circleId: 'k1', event: gov, msgId: 'gov:gh' });
    expect(carry.mock.calls[0][1]).toEqual({ from: 'addr:bea' });
    const seen = makeCircleGovernancePeerHandler({ eventLog: { query: () => [{ id: 'governance:gh' }] }, rail: { ingest: async () => ({ ok: true }) }, onLanded: landedCarrier.governance });
    await seen('addr:bea', { subtype: 'circle-governance-broadcast', circleId: 'k1', event: gov });
    expect(carry).toHaveBeenCalledTimes(1);
  });
});

describe('the three older sibling fans are callers of the one carry — same wire, same set, no loop of their own', () => {
  it('grants', async () => {
    const sendToPeer = vi.fn(async () => ({ delivered: true }));
    const fan = makeGrantsFan({ siblings: async () => SIBS, sendToPeer });
    expect(await fan(stmt)).toEqual({ attempted: 2 });
    expect(sendToPeer.mock.calls.map((c) => c[1])).toEqual([{ subtype: GRANTS_BROADCAST, event: stmt }, { subtype: GRANTS_BROADCAST, event: stmt }]);
  });
  it('contact turns', async () => {
    const sendToPeer = vi.fn(async () => ({ held: true }));
    const fan = makeContactTurnFan({ siblings: async () => SIBS, sendToPeer });
    const r = await fan({ direction: 'out', contactId: 'c1', text: 'hoi', ts: 5 });
    expect(r.attempted).toBe(2);
    expect(r.outcomes.map((o) => o.held)).toEqual([true, true]);
    expect(sendToPeer.mock.calls[0][1]).toEqual({ subtype: CONTACT_TURN_BROADCAST, turn: { direction: 'out', contactId: 'c1', text: 'hoi', ts: 5 } });
    expect(await fan({ contactId: 'c1' })).toEqual({ attempted: 0, outcomes: [] });
  });
  it('known peers (the live rows)', async () => {
    const sendToPeer = vi.fn(async () => ({ delivered: true }));
    const sync = createKnownPeersSync({
      siblings: async () => SIBS, selfPubKey: 'me', sendToPeer, snapshot: async () => ({ peers: [], contacts: [] }),
      learnPeerKey: () => 'established', contacts: { has: async () => false, add: async () => {} },
    });
    expect(await sync.fanPeer({ address: 'addr:x', pubKey: 'PK' })).toEqual({ attempted: 2 });
    expect(sendToPeer.mock.calls[0][1]).toMatchObject({ subtype: KNOWN_PEERS_BROADCAST });
  });
});
