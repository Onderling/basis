/**
 * The one sibling carry (L100): a person's other devices as a standing peer of every circle lane — one
 * mechanism, the lane's own wire payload, after a write and after a landing, never for what a sibling carried.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeSiblingCarry } from '../../src/v2/siblingCarry.js';
import { buildCircleLanes, carryLandedStatement } from '../../src/v2/circleLanes.js';
import { CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { TASK_BROADCAST } from '../../src/v2/taskRail.js';

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

  it('refuses what is not a lane payload', async () => {
    const { carry } = makeSiblingCarry({ siblings: async () => SIBS, sendToPeer: vi.fn() });
    for (const bad of [null, {}, { subtype: 'x' }, { circleId: 'k1' }]) expect((await carry(bad)).skipped).toBe('not-a-lane-payload');
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
