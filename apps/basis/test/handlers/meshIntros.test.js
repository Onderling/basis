/**
 * Unit tests for src/core/handlers/meshIntros.js.
 *
 * Verifies the mesh-intro logic in isolation — no NKN, no
 * substrate, no DOM.  Mocks callSkill + sendPeer, asserts the
 * envelope shapes + filter behaviour (self-exclusion, opt-out path).
 */
import { describe, it, expect, vi } from 'vitest';
import { makePropagateMeshIntros, makeHandleCirclePeerIntro } from '../../src/core/handlers/meshIntros.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function mockCallSkill(impl) {
  return vi.fn(async (app, op, args) => impl?.(app, op, args) ?? null);
}

describe('propagateMeshIntros (Slice 4)', () => {
  it('sends existing-member intros to the new joiner', async () => {
    const callSkill = mockCallSkill(async (_app, op) => {
      if (op === 'listConsentingPeers') {
        return {
          peers: [
            { addr: 'addr-a', display: 'Alice' },
            { addr: 'addr-b', display: 'Bob' },
            { addr: 'addr-new', display: 'New' },   // self — excluded
          ],
        };
      }
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const propagate = makePropagateMeshIntros({ callSkill, sendPeer, logger: silentLogger });

    const result = await propagate({
      groupId: 'westend',
      newPeerAddr: 'addr-new',
      newPeerDisplay: 'New',
      newPeerShared: false,
    });
    expect(result.existingCount).toBe(2);
    expect(result.broadcastedNew).toBe(false);
    // Two sends to the new joiner (one per existing peer), none to anyone else.
    expect(sendPeer).toHaveBeenCalledTimes(2);
    for (const call of sendPeer.mock.calls) {
      expect(call[0]).toBe('addr-new');
      expect(call[1].subtype).toBe('circle-peer-intro');
      expect(call[1].groupId).toBe('westend');
      expect(['addr-a', 'addr-b']).toContain(call[1].peerAddr);
    }
  });

  it('broadcasts the new joiner to existing peers when they opted in', async () => {
    const callSkill = mockCallSkill(async (_app, op) => {
      if (op === 'listConsentingPeers') {
        return { peers: [{ addr: 'addr-a', display: 'Alice' }] };
      }
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const propagate = makePropagateMeshIntros({ callSkill, sendPeer, logger: silentLogger });

    const result = await propagate({
      groupId: 'westend',
      newPeerAddr: 'addr-new',
      newPeerDisplay: 'New',
      newPeerShared: true,    // opted in
    });
    expect(result.existingCount).toBe(1);
    expect(result.broadcastedNew).toBe(true);
    // Both directions: addr-a → new, and new → addr-a
    expect(sendPeer).toHaveBeenCalledTimes(2);
    const recipients = sendPeer.mock.calls.map((c) => c[0]);
    expect(recipients).toContain('addr-new');
    expect(recipients).toContain('addr-a');
  });

  it('no-ops cleanly when there are no consenting existing peers', async () => {
    const callSkill = mockCallSkill(async () => ({ peers: [] }));
    const sendPeer = vi.fn();
    const propagate = makePropagateMeshIntros({ callSkill, sendPeer, logger: silentLogger });

    const result = await propagate({
      groupId: 'westend',
      newPeerAddr: 'addr-new',
      newPeerShared: true,
    });
    expect(result.existingCount).toBe(0);
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('continues past a sendPeer failure for one recipient', async () => {
    const callSkill = mockCallSkill(async () => ({
      peers: [
        { addr: 'addr-a', display: 'A' },
        { addr: 'addr-b', display: 'B' },
      ],
    }));
    const sendPeer = vi.fn(async (addr, payload) => {
      if (payload.peerAddr === 'addr-a') throw new Error('boom');
      return {};
    });
    const propagate = makePropagateMeshIntros({ callSkill, sendPeer, logger: silentLogger });

    // Should not throw — the loop catches per-recipient.
    await propagate({
      groupId: 'westend',
      newPeerAddr: 'addr-new',
      newPeerShared: false,
    });
    expect(sendPeer).toHaveBeenCalledTimes(2);
  });
});

describe('handleCirclePeerIntro (Slice 4)', () => {
  it('forwards groupId + peerAddr + peerDisplay to recordPeerIntro', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, introId: 'intro-1' }));
    const handle = makeHandleCirclePeerIntro({ callSkill, logger: silentLogger });

    const result = await handle('admin-addr', {
      groupId:     'westend',
      peerAddr:    'addr-bob',
      peerDisplay: 'Bob',
    });
    expect(result).toEqual({ ok: true, introId: 'intro-1' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'recordPeerIntro', {
      groupId: 'westend',
      peerAddr: 'addr-bob',
      peerDisplay: 'Bob',
    });
  });

  it('rejects malformed payloads (missing fields)', async () => {
    const callSkill = vi.fn();
    const handle = makeHandleCirclePeerIntro({ callSkill, logger: silentLogger });

    const result = await handle('admin-addr', { peerAddr: 'addr-bob' });   // no groupId
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-fields');
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('surfaces substrate errors without throwing', async () => {
    const callSkill = vi.fn(async () => ({ error: 'duplicate' }));
    const handle = makeHandleCirclePeerIntro({ callSkill, logger: silentLogger });
    const result = await handle('admin-addr', {
      groupId: 'westend', peerAddr: 'addr-bob',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });
});
