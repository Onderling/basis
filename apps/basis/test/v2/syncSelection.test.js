/**
 * The selection (sync-policy §11): what THIS device holds — per silo, per kring, the file bytes — enforced by the
 * receiver, never on the wire. Hold nothing, still carry; a kring off is refused on landing; a flip holds live.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeSyncSelection, HOLD_EVERYTHING, parseKringenOff, serializeKringenOff, SYNC_SILO_PARAM_KEYS, SYNC_KRINGEN_OFF_PARAM_KEY, SYNC_FILE_BYTES_PARAM_KEY } from '../../src/v2/syncSelection.js';
import { buildCircleLanes } from '../../src/v2/circleLanes.js';
import { CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { TASK_BROADCAST } from '../../src/v2/taskRail.js';

const stmt = { body: { kind: 'chat', subject: 'm1', hash: 'h1' }, sig: 'sig' };
const chatPayload = { subtype: CHAT_STATEMENT_BROADCAST, circleId: 'k1', event: stmt, msgId: 'm1', ts: 1 };
const taskStmt = { body: { kind: 'snapshot', subject: 't1', hash: 'h2' }, sig: 'sig' };
const taskPayload = { subtype: TASK_BROADCAST, circleId: 'k1', event: taskStmt, msgId: 'task:h2', ts: 1 };

describe('the reader', () => {
  it('defaults: every silo held, every kring on, bytes in full — and junk reads as the default', () => {
    const sel = makeSyncSelection({ getParamValue: () => undefined });
    expect(sel.holds('chat', 'k1')).toBe(true);
    expect(sel.holds('tasks')).toBe(true);
    expect(sel.keepsBytes()).toBe(true);
    const junk = makeSyncSelection({ getParamValue: () => 'garbage' });
    expect(junk.holds('chat', 'k1')).toBe(true);
    expect(junk.keepsBytes()).toBe(true);
    expect(HOLD_EVERYTHING.holds('anything', 'k9')).toBe(true);
  });
  it('a silo off holds nothing of that silo; a kring off holds nothing FOR that circle, every silo; bytes as chosen', () => {
    const values = { [SYNC_SILO_PARAM_KEYS.chat]: false, [SYNC_KRINGEN_OFF_PARAM_KEY]: 'k2, k3', [SYNC_FILE_BYTES_PARAM_KEY]: 'description' };
    const sel = makeSyncSelection({ getParamValue: (k) => values[k] });
    expect(sel.holds('chat', 'k1')).toBe(false);
    expect(sel.holds('tasks', 'k1')).toBe(true);
    expect(sel.holds('tasks', 'k2')).toBe(false);
    expect(sel.kringOn('k3')).toBe(false);
    expect(sel.keepsBytes()).toBe(false);
    expect([...sel.kringenOff()].sort()).toEqual(['k2', 'k3']);
    expect(serializeKringenOff(parseKringenOff('b,a,,a'))).toBe('a,b');
  });
  it('reads LIVE: a flip holds at the next question, no restart', () => {
    let v = true;
    const sel = makeSyncSelection({ getParamValue: () => v });
    expect(sel.holds('chat')).toBe(true);
    v = false;
    expect(sel.holds('chat')).toBe(false);
  });
});

describe('the receiver enforces it — the lane table', () => {
  const railStub = (over = {}) => ({
    ingest: vi.fn(async (_c, s) => ({ ok: true, existed: false, entry: { id: s.body.subject } })),
    verify: vi.fn(async () => ({ ok: true })),
    hasEntry: () => false, storedStatements: () => [], statementsFor: () => [], frontier: () => ({}),
    headsFor: () => ({}), serve: () => [], declaredKinds: [], newerThan: () => [], owed: () => [], ...over,
  });
  const agentWith = (values, carry = vi.fn(async () => ({ attempted: 1 }))) => ({
    siblingCarry: { carry },
    chatRail: railStub(), taskRail: railStub(),
    sendPeerMessage: async () => ({}),
    getParamValue: (k) => values[k],
    carry,
  });

  it('a SILO OFF: what lands is verified, NOT appended, and still carried to the siblings', async () => {
    const agent = agentWith({ [SYNC_SILO_PARAM_KEYS.chat]: false });
    const { handlers } = buildCircleLanes({ agent });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:member-bea', chatPayload);
    expect(agent.chatRail.verify).toHaveBeenCalledWith('k1', stmt);
    expect(agent.chatRail.ingest, 'hold nothing').not.toHaveBeenCalled();
    expect(agent.carry, 'still carry').toHaveBeenCalledTimes(1);
    expect(agent.carry.mock.calls[0][0]).toMatchObject({ subtype: CHAT_STATEMENT_BROADCAST, circleId: 'k1', event: stmt });
    expect(agent.carry.mock.calls[0][1]).toEqual({ from: 'addr:member-bea' });
    // tasks are still held on this device
    await handlers[TASK_BROADCAST]('addr:member-bea', taskPayload);
    expect(agent.taskRail.ingest).toHaveBeenCalledTimes(1);
  });
  it('a silo off never carries what did NOT verify — a carrier is not an authority', async () => {
    const agent = agentWith({ [SYNC_SILO_PARAM_KEYS.chat]: false });
    agent.chatRail.verify = vi.fn(async () => ({ ok: false, reason: 'bad sig' }));
    const { handlers } = buildCircleLanes({ agent });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:x', chatPayload);
    expect(agent.carry).not.toHaveBeenCalled();
  });
  it('a KRING OFF: refused on landing — not appended, not carried, said once per circle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = agentWith({ [SYNC_KRINGEN_OFF_PARAM_KEY]: 'k1' });
    const { handlers } = buildCircleLanes({ agent });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:box', chatPayload);
    await handlers[TASK_BROADCAST]('addr:box', taskPayload);
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:box', { ...chatPayload, msgId: 'm2' });
    expect(agent.chatRail.ingest).not.toHaveBeenCalled();
    expect(agent.taskRail.ingest).not.toHaveBeenCalled();
    expect(agent.carry).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter(([m]) => /does not hold kring k1/.test(String(m)))).toHaveLength(1);
    warn.mockRestore();
    // another circle is untouched
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:box', { ...chatPayload, circleId: 'k2' });
    expect(agent.chatRail.ingest).toHaveBeenCalledTimes(1);
  });
  it('a KRING OFF pulls nothing: the catch-up kicks skip it, for every lane', async () => {
    const sent = [];
    const agent = agentWith({ [SYNC_KRINGEN_OFF_PARAM_KEY]: 'k1' });
    agent.sendPeerMessage = async (to, payload) => { sent.push({ to, subtype: payload.subtype, circleId: payload.circleId }); return {}; };
    agent.membershipRail = railStub(); agent.keyRail = railStub();
    const { catchUps } = buildCircleLanes({ agent });
    const callSkill = async (_o, op, a) => (op === 'listMyCircles' ? { circles: ['k1', 'k2'] }
      : op === 'listGroupMembers' ? { members: [{ webid: 'w', circleAddress: `addr:${a.groupId}` }] } : {});   // the derived roster (2026-09-21)
    for (const cu of [catchUps.membership, catchUps.key, catchUps.task, catchUps.chat]) await cu.requestAll({ callSkill });
    expect(sent.every((s) => s.circleId === 'k2'), JSON.stringify(sent)).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
    expect(await catchUps.membership.requestFrom('addr:k1', 'k1'), 'a direct pull for a kring off is a no-op').toBeUndefined();
  });
  it('a composition without a register holds everything, as before', async () => {
    const agent = agentWith({}); delete agent.getParamValue;
    const { handlers } = buildCircleLanes({ agent });
    await handlers[CHAT_STATEMENT_BROADCAST]('addr:x', chatPayload);
    expect(agent.chatRail.ingest).toHaveBeenCalledTimes(1);
    expect(agent.carry).toHaveBeenCalledTimes(1);
  });
});

describe('a KRING OFF is off the roster on this device: no announce at boot, no pairing', () => {
  it('the boot announce skips it; every other circle announces as before', async () => {
    const { announceCircleAddresses } = await import('../../src/v2/circleSecurityPriming.js');
    const announced = [];
    const agent = {
      identity: { pubKey: 'me' },
      getParamValue: (k) => (k === SYNC_KRINGEN_OFF_PARAM_KEY ? 'koor' : undefined),
      circleAddressFor: (cid) => `addr:${cid}`,
      signCircleLink: () => 'proof',
      callSkill: async (app, op, args) => {
        if (op === 'listMyCircles') return { circles: ['circle', 'koor'] };
        if (op === 'listGroupMembers') return { members: [] };
        if (op === 'broadcastCircleAddresses') { announced.push(args.groupId); return { sent: 1, errors: [] }; }
        return { ok: true };
      },
    };
    const out = await announceCircleAddresses({ agent, onWarn: () => {} });
    expect(out.circleIds).toEqual(['circle']);
    expect(announced).toEqual(['circle']);
  });
  it('the household pairing skips it', async () => {
    const { feedHouseholdRoster } = await import('../../src/v2/householdRosterPairing.js');
    const added = [];
    const agent = {
      getParamValue: (k) => (k === SYNC_KRINGEN_OFF_PARAM_KEY ? 'koor' : undefined),
      addCirclePeer: (_c, addr) => { added.push(addr); },
      listCirclePeers: async () => [],
      peer: { address: 'me' },
      callSkill: async (_a, op) => (op === 'listGroupRoster' ? { members: [{ addr: 'anna' }] } : {}),
    };
    expect(await feedHouseholdRoster({ agent, circleId: 'koor' })).toBe(0);
    expect(added).toEqual([]);
    expect(await feedHouseholdRoster({ agent, circleId: 'circle' })).toBeGreaterThan(0);
    expect(added).toEqual(['anna']);
  });
});

describe('the chat rail\'s verify is the same gate as its ingest (hold nothing, still carry — never carry what would not land)', () => {
  it('what ingest refuses, verify refuses, for the same reason; what ingest lands, verify passes', async () => {
    const { makeChatRail } = await import('../../src/v2/chatRail.js');
    const { AgentIdentity, signSpine } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const id = await AgentIdentity.generate(new VaultMemory());
    const entries = [];
    const eventLog = { query: () => entries, append: (e) => { entries.push(e); return e; }, appendSilentEntry: (e) => { entries.push(e); return e; } };
    const rail = makeChatRail({ eventLog, circleIdentityFor: async () => id, myRef: 'me', callSkill: async () => ({ members: [] }) });
    const good = signSpine(id, { kind: 'message', circleId: 'k1', subject: 'm1', payload: { msgId: 'm1', text: 'hoi', authorRef: 'me' }, parent: null, deps: [] });
    expect((await rail.verify('k1', good)).ok).toBe(true);
    expect((await rail.ingest('k1', good)).ok).toBe(true);
    const noRef = signSpine(id, { kind: 'message', circleId: 'k1', subject: 'm2', payload: { msgId: 'm2', text: 'x' }, parent: null, deps: [] });
    expect(await rail.verify('k1', noRef)).toEqual({ ok: false, reason: 'missing authorRef' });
    expect(await rail.ingest('k1', noRef)).toEqual({ ok: false, reason: 'missing authorRef' });
    const wrongCircle = signSpine(id, { kind: 'message', circleId: 'k2', subject: 'm3', payload: { msgId: 'm3', authorRef: 'me' }, parent: null, deps: [] });
    expect((await rail.verify('k1', wrongCircle)).ok).toBe(false);
    expect((await rail.ingest('k1', wrongCircle)).ok).toBe(false);
  });
});
