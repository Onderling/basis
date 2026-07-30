/**
 * basis — group-join (membership-code peer-redeem) end-to-end
 * round-trip.
 *
 * Mirrors the cross-DEVICE join the mobile app does when a joiner
 * scans an admin's `onderling-invite://` QR but the joiner's local
 * substrate has no copy of the code (separate instances).  The join
 * wizard's `finalSubmit` falls back to `sendPeerRedeem`, which:
 *
 *   joiner → group-redeem-request → admin
 *   admin  → verifyMembershipCodeForPeer → group-redeem-response → joiner
 *   joiner → pendingMap.resolve → wizard completes
 *
 * This is the exact path that was failing on two phones — not because
 * of a code gap (the handlers were wired), but because the NKN address
 * rotated each launch (stale adminPeerAddr) and single-client delivery
 * dropped the request/response.  Both are fixed at the transport layer
 * (persisted identity + MultiClient).  This test pins the application-
 * layer round-trip so the wiring can't silently regress.
 *
 * Strategy: same loopback NKN hub as file-share-roundtrip — two real
 * createSecureAgent instances, real SecurityLayer + bilateral HI, the
 * real peer-router dispatching by subtype.  Only the stoop substrate
 * call (`verifyMembershipCodeForPeer`) is stubbed, since this test is
 * about the envelope round-trip, not stoop's code-vault internals.
 */
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { createSecureAgent } from '@onderling/secure-agent';
import { VaultMemory }       from '@onderling/vault';

import { makePeerRouter } from '../src/core/handlers/peerRouter.js';
import {
  makeHandleGroupRedeemRequest,
  makeHandleGroupRedeemResponse,
  makeSendGroupRedeemRequest,
} from '../src/core/handlers/groupRedeem.js';

/* ─── Loopback NKN hub (same shape as file-share-roundtrip) ─── */

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

/* ─── Two-agent fixture: admin + joiner ─────────────────── */

async function makeAdminAndJoiner({ verifyResult }) {
  const hub = makeLoopbackNknHub();

  // Mutable router holders so we can pass onPeerMessage at agent-
  // creation time (the file-share-roundtrip pattern) while still
  // building the routers AFTER the agents exist (the request handler
  // needs sendPeer = agent.peer.sendTo).
  let adminRouter  = () => {};
  let joinerRouter = () => {};

  // Admin: verifyMembershipCodeForPeer stubbed to the test's result.
  const adminVerify = vi.fn(async () => verifyResult);
  const adminCallSkill = vi.fn(async (_origin, op, args) => {
    if (op === 'verifyMembershipCodeForPeer') return adminVerify(args);
    return { ok: true };
  });

  // The router IS the onPeerMessage (it takes the {from,payload,ts}
  // env object directly) — same shape basis-mobile wires.
  const admin = await createSecureAgent({
    vault:  new VaultMemory(),
    nknLib: hub.factoryFor('app.admin.test'),
    onPeerMessage: (env) => adminRouter(env),
  });
  adminRouter = makePeerRouter({
    handlers: {
      'group-redeem-request': makeHandleGroupRedeemRequest({
        callSkill: adminCallSkill,
        sendPeer:  (addr, payload) => admin.peer.sendTo(addr, payload),
      }),
    },
  });

  // Joiner: owns a pendingMap shared between the sender + the
  // response handler (exactly the mobile/web wiring).
  const pendingMap = new Map();
  const joiner = await createSecureAgent({
    vault:  new VaultMemory(),
    nknLib: hub.factoryFor('app.joiner.test'),
    onPeerMessage: (env) => joinerRouter(env),
  });
  joinerRouter = makePeerRouter({
    handlers: {
      'group-redeem-response': makeHandleGroupRedeemResponse({ pendingMap }),
    },
  });

  await admin.peer.connect();
  await joiner.peer.connect();

  const sendPeerRedeem = makeSendGroupRedeemRequest({
    sendPeer:        (addr, payload) => joiner.peer.sendTo(addr, payload),
    isPeerConnected: () => joiner.peer.status === 'connected',
    pendingMap,
    timeoutMs:       8_000,
  });

  return { admin, joiner, sendPeerRedeem, adminVerify, adminAddr: admin.peer.address };
}

/* ─── Tests ──────────────────────────────────────────── */

describe('group-redeem cross-device round-trip', () => {
  it('valid code: joiner request → admin verify → response resolves OK', async () => {
    const { sendPeerRedeem, adminVerify, adminAddr } = await makeAdminAndJoiner({
      verifyResult: { codeId: 'code-1', validUntil: Date.now() + 60_000 },
    });

    const reply = await sendPeerRedeem({
      adminPeerAddr: adminAddr,
      groupId:  'buurt-oost',
      code:     'SECRET-123',
      peerDisplay: 'Anne',
    });

    expect(reply.ok).toBe(true);
    expect(reply.codeId).toBe('code-1');
    // Admin actually ran the substrate verification with our fields.
    expect(adminVerify).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'buurt-oost', code: 'SECRET-123', peerDisplay: 'Anne' }),
    );
  });

  it('invalid code: admin error propagates back to the joiner', async () => {
    const { sendPeerRedeem, adminAddr } = await makeAdminAndJoiner({
      verifyResult: { error: 'invalid-or-expired-code' },
    });

    const reply = await sendPeerRedeem({
      adminPeerAddr: adminAddr,
      groupId:  'buurt-oost',
      code:     'WRONG',
    });

    expect(reply.ok).toBeUndefined();
    expect(reply.error).toBe('invalid-or-expired-code');
  });
});
