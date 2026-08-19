/**
 * basis — post-join "share to this circle" round-trip + orchestrator routing.
 *
 * Member updates what they disclose to a circle AFTER joining:
 *   member → persona-props-update → admin
 *   admin  → stoop.recordMemberPersonaProperties → persona-props-ack → member
 *   member → pendingMap.resolve → the About-me surface confirms
 *
 * Same loopback NKN hub + real peer-router as group-redeem-roundtrip; only the stoop substrate call
 * is stubbed (this pins the envelope round-trip + the local-vs-peer orchestration, not stoop internals).
 */
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { createSecureAgent } from '@onderling/secure-agent';
import { VaultMemory }       from '@onderling/vault';

import { makePeerRouter } from '../src/core/handlers/peerRouter.js';
import {
  makeHandlePersonaPropsUpdate,
  makeHandlePersonaPropsAck,
  makeSendPersonaPropsUpdate,
  shareDisclosureToCircle,
} from '../src/core/handlers/personaPropsUpdate.js';

const MAX_NKN_PAYLOAD = 65_528;

function makeLoopbackNknHub() {
  const clients = new Map();
  const lookup = (addr) => clients.get(addr) ?? null;
  function factoryFor(address) {
    return {
      Client: function (_opts) {
        const instance = {
          addr: address,
          handlers: { connect: [], message: [], error: [] },
          on(event, cb) { (this.handlers[event] ??= []).push(cb); },
          async send(to, payload) {
            const wire = typeof payload === 'string' ? payload : String(payload);
            if (wire.length > MAX_NKN_PAYLOAD) return;
            const target = lookup(to);
            if (!target) return;
            for (const cb of target.handlers.message) cb({ src: address, payload: wire });
          },
          close() { clients.delete(address); },
        };
        clients.set(address, instance);
        queueMicrotask(() => { for (const cb of instance.handlers.connect) cb(); });
        return instance;
      },
    };
  }
  return { factoryFor };
}

async function makeMemberAndAdmin({ recordResult }) {
  const hub = makeLoopbackNknHub();
  let adminRouter = () => {};
  let memberRouter = () => {};

  const adminRecord = vi.fn(async () => recordResult);
  const adminCallSkill = vi.fn(async (_origin, op, args) => {
    if (op === 'recordMemberPersonaProperties') return adminRecord(args);
    return { ok: true };
  });

  const admin = await createSecureAgent({
    vault: new VaultMemory(),
    nknLib: hub.factoryFor('app.admin.test'),
    onPeerMessage: (env) => adminRouter(env),
  });
  adminRouter = makePeerRouter({
    handlers: {
      'persona-props-update': makeHandlePersonaPropsUpdate({
        callSkill: adminCallSkill,
        sendPeer: (addr, payload) => admin.peer.sendTo(addr, payload),
      }),
    },
  });

  const pendingMap = new Map();
  const member = await createSecureAgent({
    vault: new VaultMemory(),
    nknLib: hub.factoryFor('app.member.test'),
    onPeerMessage: (env) => memberRouter(env),
  });
  memberRouter = makePeerRouter({
    handlers: { 'persona-props-ack': makeHandlePersonaPropsAck({ pendingMap }) },
  });

  await admin.peer.connect();
  await member.peer.connect();

  const sendPersonaUpdate = makeSendPersonaPropsUpdate({
    sendPeer: (addr, payload) => member.peer.sendTo(addr, payload),
    isPeerConnected: () => member.peer.status === 'connected',
    pendingMap,
    timeoutMs: 8_000,
  });

  return { admin, member, sendPersonaUpdate, adminRecord, adminAddr: admin.peer.address };
}

describe('persona-props post-join round-trip', () => {
  it('member update → admin records against fromAddr → ack resolves OK', async () => {
    const { sendPersonaUpdate, adminRecord, adminAddr } = await makeMemberAndAdmin({
      recordResult: { ok: true, keys: ['place'] },
    });

    const reply = await sendPersonaUpdate({
      adminPeerAddr: adminAddr,
      groupId: 'circle-oost',
      personaProperties: { place: 'Groningen' },
    });

    expect(reply.ok).toBe(true);
    // Admin recorded against the AUTHENTICATED peer address, not a payload-supplied webid.
    expect(adminRecord).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'circle-oost',
      memberWebid: 'app.member.test',
      personaProperties: { place: 'Groningen' },
    }));
  });

  it('admin record failure (not-a-member) propagates back as an error', async () => {
    const { sendPersonaUpdate, adminAddr } = await makeMemberAndAdmin({
      recordResult: { ok: false, reason: 'not-a-member' },
    });
    const reply = await sendPersonaUpdate({ adminPeerAddr: adminAddr, groupId: 'x', personaProperties: {} });
    expect(reply.ok).toBeUndefined();
    expect(reply.error).toBe('not-a-member');
  });
});

describe('shareDisclosureToCircle — local-vs-peer routing', () => {
  const RELEASE = { released: { place: 'Groningen' } };

  it('PEER path: a remote admin in the roster ⇒ push over persona-props-update', async () => {
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getPersonaRelease') return RELEASE;
      if (op === 'listGroupRoster') return { members: [{ addr: 'admin.addr', role: 'admin' }] };
      return { ok: true };
    });
    const r = await shareDisclosureToCircle({ callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default' });
    expect(r).toEqual({ ok: true, via: 'peer' });
    expect(sendPersonaUpdate).toHaveBeenCalledWith({
      adminPeerAddr: 'admin.addr', groupId: 'c1', personaProperties: { place: 'Groningen' },
    });
  });

  it('LOCAL path: no admin in the roster (I AM the admin) ⇒ record directly', async () => {
    const sendPersonaUpdate = vi.fn();
    const calls = [];
    const callSkill = vi.fn(async (app, op, args) => {
      calls.push([op, args]);
      if (op === 'getPersonaRelease') return RELEASE;
      if (op === 'listGroupRoster') return { members: [] };   // self excluded ⇒ no admin entry
      if (op === 'recordMemberPersonaProperties') return { ok: true };
      return { ok: true };
    });
    const r = await shareDisclosureToCircle({ callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default' });
    // Wave B: the local path now also reports the changed keys (for the pull-me signal).
    expect(r).toMatchObject({ ok: true, via: 'local' });
    expect(sendPersonaUpdate).not.toHaveBeenCalled();
    expect(calls).toContainEqual(['recordMemberPersonaProperties', { groupId: 'c1', personaProperties: { place: 'Groningen' } }]);
  });

  it('remote admin but no peer sender ⇒ admin-unreachable (not silently local)', async () => {
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getPersonaRelease') return RELEASE;
      if (op === 'listGroupRoster') return { members: [{ addr: 'admin.addr', role: 'admin' }] };
      return { ok: true };
    });
    const r = await shareDisclosureToCircle({ callSkill, circleId: 'c1', personaId: 'default' });
    expect(r).toEqual({ ok: false, reason: 'admin-unreachable' });
  });

  it('an empty release still propagates (clearing what I disclose)', async () => {
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getPersonaRelease') return { released: {} };
      if (op === 'listGroupRoster') return { members: [{ addr: 'admin.addr', role: 'admin' }] };
      return { ok: true };
    });
    await shareDisclosureToCircle({ callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default' });
    expect(sendPersonaUpdate).toHaveBeenCalledWith(expect.objectContaining({ personaProperties: {} }));
  });
});
