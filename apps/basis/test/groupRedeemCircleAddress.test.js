/**
 * Identity 5B/C — per-circle address on the cross-instance (peer) redeem path.
 *
 * The joiner's SENDER embeds the address it presents for `groupId`
 * (from the injected `circleAddressFor`); the admin's HANDLER forwards that
 * address from the request envelope into `verifyMembershipCodeForPeer` so the
 * substrate records it into the roster — parity with the direct redeem path,
 * where the callSkill seam injects it.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeSendGroupRedeemRequest, makeHandleGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';

describe('peer redeem — joiner presents circleAddress', () => {
  it('a FRESH join embeds circleAddressFor(groupId) WITH a proof of possession', async () => {
    const sent = [];
    const send = makeSendGroupRedeemRequest({
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      pendingMap: new Map(),
      circleAddressFor: (gid) => `addr-for-${gid}`,
      signCircleAddress: (gid, addr) => `sig(${gid},${addr})`,
    });
    // don't await the (never-resolving) promise — we only assert the outbound envelope
    send({ adminPeerAddr: 'admin@nkn', groupId: 'buurt-42', code: 'ABC' });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.circleAddress).toBe('addr-for-buurt-42');
    // The address is PROVEN, never merely asserted — the admin drops anything unproven, so omitting the
    // proof is what used to leave peer-redeemed members with no per-circle address at all.
    expect(sent[0].payload.circleAddressProof).toBe('sig(buurt-42,addr-for-buurt-42)');
  });

  it('sends NOTHING it cannot prove: an address without a signer is omitted', async () => {
    const sent = [];
    const send = makeSendGroupRedeemRequest({
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      pendingMap: new Map(),
      circleAddressFor: (gid) => `addr-for-${gid}`,   // derivable…
      // …but no signCircleAddress → unprovable → deny-by-default.
    });
    send({ adminPeerAddr: 'admin@nkn', groupId: 'buurt-42', code: 'ABC' });
    await Promise.resolve();
    expect('circleAddress' in sent[0].payload).toBe(false);
  });

  it('an explicit "continue as an existing self" address+proof still wins over the fresh one', async () => {
    const sent = [];
    const send = makeSendGroupRedeemRequest({
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      pendingMap: new Map(),
      circleAddressFor: (gid) => `addr-for-${gid}`,
      signCircleAddress: (gid, addr) => `sig(${gid},${addr})`,
    });
    send({ adminPeerAddr: 'admin@nkn', groupId: 'buurt-42', code: 'ABC',
           circleAddress: 'my-addr-in-circle-x', circleAddressProof: 'proof-from-x' });
    await Promise.resolve();
    expect(sent[0].payload.circleAddress).toBe('my-addr-in-circle-x');
    expect(sent[0].payload.circleAddressProof).toBe('proof-from-x');
  });

  it('omits circleAddress when no presenter is wired at all (back-compat)', async () => {
    const sent = [];
    const send = makeSendGroupRedeemRequest({
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      pendingMap: new Map(),
    });
    send({ adminPeerAddr: 'admin@nkn', groupId: 'buurt-42', code: 'ABC' });
    await Promise.resolve();
    expect('circleAddress' in sent[0].payload).toBe(false);
  });
});

describe('peer redeem — admin forwards the joiner circleAddress', () => {
  it('passes payload.circleAddress into verifyMembershipCodeForPeer', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, codeId: 'c1', validUntil: 1 }));
    const handle = makeHandleGroupRedeemRequest({
      callSkill, sendPeer: async () => {}, logger: { warn() {}, error() {} },
    });
    await handle('joiner@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'ABC', circleAddress: 'joiner-addr' });
    const [, opId, args] = callSkill.mock.calls[0];
    expect(opId).toBe('verifyMembershipCodeForPeer');
    expect(args.circleAddress).toBe('joiner-addr');
    expect(args.requesterWebid).toBe('joiner@nkn');   // still the AUTHENTICATED sender
  });

  it('forwards no circleAddress when the envelope carries none', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    const handle = makeHandleGroupRedeemRequest({ callSkill, sendPeer: async () => {}, logger: { warn() {}, error() {} } });
    await handle('joiner@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'ABC' });
    expect('circleAddress' in callSkill.mock.calls[0][2]).toBe(false);
  });
});

/**
 * …and the other direction (2026-07-30). Per-circle addressing used to be one-directional: the admin
 * learned the joiner's address and the joiner learned nothing, so joiner→admin sends fell through to the
 * admin's global signing key — refused outright when the per-user address fallback is off. The reply is
 * where that closes.
 */
describe('peer redeem — the admin returns ITS OWN circleAddress on the response', () => {
  const okSkill = () => vi.fn(async () => ({ ok: true, codeId: 'c1', validUntil: 9 }));

  it('carries the admin address + proof for the circle being joined', async () => {
    const sent = [];
    const handle = makeHandleGroupRedeemRequest({
      callSkill: okSkill(),
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      circleAddressFor: (gid) => `admin-addr-for-${gid}`,
      signCircleAddress: (gid, addr) => `sig(${gid},${addr})`,
      logger: { warn() {}, error() {} },
    });
    await handle('joiner@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'ABC' });

    expect(sent).toHaveLength(1);
    expect(sent[0].payload.subtype).toBe('group-redeem-response');
    expect(sent[0].payload.circleAddress).toBe('admin-addr-for-buurt-42');
    expect(sent[0].payload.circleAddressProof).toBe('sig(buurt-42,admin-addr-for-buurt-42)');
  });

  it('sends NOTHING it cannot prove (same deny-by-default as the request direction)', async () => {
    const sent = [];
    const handle = makeHandleGroupRedeemRequest({
      callSkill: okSkill(),
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      circleAddressFor: (gid) => `admin-addr-for-${gid}`,   // derivable…
      // …but no signer → unprovable → omitted.
      logger: { warn() {}, error() {} },
    });
    await handle('joiner@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'ABC' });
    expect('circleAddress' in sent[0].payload).toBe(false);
  });

  it('never rides a REJECTION — a refused join learns nothing about the admin', async () => {
    const sent = [];
    const handle = makeHandleGroupRedeemRequest({
      callSkill: vi.fn(async () => ({ error: 'invalid-or-expired-code' })),
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      circleAddressFor: (gid) => `admin-addr-for-${gid}`,
      signCircleAddress: (gid, addr) => `sig(${gid},${addr})`,
      logger: { warn() {}, error() {} },
    });
    await handle('stranger@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'WRONG' });
    expect(sent[0].payload.error).toBe('invalid-or-expired-code');
    expect('circleAddress' in sent[0].payload).toBe(false);
  });

  it('omits it entirely when no presenter is wired (back-compat)', async () => {
    const sent = [];
    const handle = makeHandleGroupRedeemRequest({
      callSkill: okSkill(),
      sendPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      logger: { warn() {}, error() {} },
    });
    await handle('joiner@nkn', { requestId: 'r1', groupId: 'buurt-42', code: 'ABC' });
    expect('circleAddress' in sent[0].payload).toBe(false);
    expect(sent[0].payload.ok).toBe(true);
  });
});
