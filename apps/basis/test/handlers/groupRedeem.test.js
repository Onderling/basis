/**
 * group-redeem request + response coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeHandleGroupRedeemRequest,
  makeHandleGroupRedeemResponse,
  makeSendGroupRedeemRequest,
} from '../../src/core/handlers/groupRedeem.js';

function reqDeps(overrides = {}) {
  return {
    callSkill: vi.fn(async () => ({ codeId: 'c-1', validUntil: 9999999999 })),
    sendPeer:  vi.fn(async () => {}),
    propagateMeshIntros: vi.fn(async () => ({})),
    publishEvent: vi.fn(),
    logger:    { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

const validRequest = (overrides = {}) => ({
  requestId: 'r-1', groupId: 'g-1', code: 'JOIN-XYZ',
  ...overrides,
});

describe('makeHandleGroupRedeemRequest', () => {
  it('throws when deps missing', () => {
    expect(() => makeHandleGroupRedeemRequest({})).toThrow(/callSkill required/);
    expect(() => makeHandleGroupRedeemRequest({ callSkill: vi.fn() })).toThrow(/sendPeer required/);
  });

  it('drops requests missing required fields', async () => {
    const d = reqDeps();
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', { requestId: 'r' });
    expect(d.callSkill).not.toHaveBeenCalled();
  });

  it('verifies code + sends OK response + fires propagateMeshIntros on success', async () => {
    const d = reqDeps();
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest({ shareCard: true, peerDisplay: 'Anne' }));
    expect(d.callSkill).toHaveBeenCalledWith('stoop', 'verifyMembershipCodeForPeer',
      expect.objectContaining({
        groupId: 'g-1', code: 'JOIN-XYZ',
        requesterWebid: 'peer-A',
        shareCard: true, peerDisplay: 'Anne',
      }));
    expect(d.sendPeer).toHaveBeenCalledWith('peer-A', expect.objectContaining({
      subtype: 'group-redeem-response', ok: true,
    }));
    // Microtask flush so the propagateMeshIntros fire-and-forget settles.
    await new Promise((r) => setTimeout(r, 0));
    expect(d.propagateMeshIntros).toHaveBeenCalledWith({
      groupId: 'g-1', newPeerAddr: 'peer-A', newPeerDisplay: 'Anne', newPeerShared: true,
    });
  });

  it('forwards substrate error in the reply', async () => {
    const d = reqDeps({ callSkill: vi.fn(async () => ({ error: 'invalid code' })) });
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest());
    expect(d.sendPeer).toHaveBeenCalledWith('peer-A', expect.objectContaining({
      subtype: 'group-redeem-response', error: 'invalid code',
    }));
    expect(d.propagateMeshIntros).not.toHaveBeenCalled();
  });

  it('captures thrown callSkill error in the reply', async () => {
    const d = reqDeps({ callSkill: vi.fn(async () => { throw new Error('db down'); }) });
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest());
    expect(d.sendPeer).toHaveBeenCalledWith('peer-A', expect.objectContaining({
      subtype: 'group-redeem-response', error: 'db down',
    }));
  });
});

describe('makeHandleGroupRedeemResponse', () => {
  it('throws when pendingMap missing', () => {
    expect(() => makeHandleGroupRedeemResponse({})).toThrow(/pendingMap required/);
  });

  it('resolves the pending entry by requestId + deletes it', () => {
    const resolve = vi.fn();
    const pendingMap = new Map([['r-1', { resolve }]]);
    const handle = makeHandleGroupRedeemResponse({ pendingMap });
    handle('peer-A', { requestId: 'r-1', ok: true, codeId: 'c' });
    expect(resolve).toHaveBeenCalledWith({ requestId: 'r-1', ok: true, codeId: 'c' });
    expect(pendingMap.has('r-1')).toBe(false);
  });

  it('clears the entry timer when present', () => {
    const resolve = vi.fn();
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const timer = setTimeout(() => {}, 99999);
    const pendingMap = new Map([['r-1', { resolve, timer }]]);
    const handle = makeHandleGroupRedeemResponse({ pendingMap });
    handle('peer-A', { requestId: 'r-1', ok: true });
    expect(clearTimer).toHaveBeenCalledWith(timer);
    clearTimer.mockRestore();
    clearTimeout(timer);
  });

  it('warns + drops responses with no pending entry', () => {
    const warn = vi.fn();
    const pendingMap = new Map();
    const handle = makeHandleGroupRedeemResponse({ pendingMap, logger: { warn } });
    handle('peer-A', { requestId: 'mystery' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('makeSendGroupRedeemRequest — Phase 4 (#271)', () => {
  it('throws when deps missing', () => {
    expect(() => makeSendGroupRedeemRequest({})).toThrow(/sendPeer required/);
    expect(() => makeSendGroupRedeemRequest({ sendPeer: vi.fn() })).toThrow(/pendingMap required/);
  });

  it('rejects when peer transport is not connected', async () => {
    const pendingMap = new Map();
    const send = makeSendGroupRedeemRequest({
      sendPeer:        vi.fn(),
      isPeerConnected: () => false,
      pendingMap,
    });
    await expect(send({ adminPeerAddr: 'app.x', groupId: 'g', code: 'C' }))
      .rejects.toThrow(/Peer transport not connected/);
  });

  it('sends the envelope + resolves when the handler completes the entry', async () => {
    const sendPeer = vi.fn(async () => {});
    const pendingMap = new Map();
    const handleResponse = makeHandleGroupRedeemResponse({ pendingMap });
    const send = makeSendGroupRedeemRequest({
      sendPeer,
      isPeerConnected: () => true,
      pendingMap,
    });

    const pending = send({
      adminPeerAddr: 'app.alice', groupId: 'g-1', code: 'JOIN-XYZ',
      shareCard: true, peerDisplay: 'Bob',
    });

    // Verify envelope structure.
    await new Promise((r) => setTimeout(r, 0)); // let sendPeer settle
    expect(sendPeer).toHaveBeenCalledWith('app.alice', expect.objectContaining({
      subtype:    'group-redeem-request',
      groupId:    'g-1',
      code:       'JOIN-XYZ',
      shareCard:  true,
      peerDisplay: 'Bob',
    }));

    // Simulate inbound response.
    const [[entry]] = [[...pendingMap.entries()]];
    const requestId = entry[0];
    handleResponse('app.alice', { requestId, ok: true, codeId: 'c-1', validUntil: 9999 });

    const r = await pending;
    expect(r).toEqual({ requestId, ok: true, codeId: 'c-1', validUntil: 9999 });
    expect(pendingMap.size).toBe(0);
  });

  it('rejects with timeout when no response arrives', async () => {
    vi.useFakeTimers();
    const sendPeer = vi.fn(async () => {});
    const pendingMap = new Map();
    const send = makeSendGroupRedeemRequest({
      sendPeer, isPeerConnected: () => true, pendingMap,
      timeoutMs: 1000,
    });
    const pending = send({ adminPeerAddr: 'app.x', groupId: 'g', code: 'C' });
    // Need to wait for await sendPeer + the next microtask.
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(1100);
    await expect(pending).rejects.toThrow(/did not respond within/);
    expect(pendingMap.size).toBe(0);
    vi.useRealTimers();
  });

  it('rejects + cleans up when sendPeer throws', async () => {
    const pendingMap = new Map();
    const send = makeSendGroupRedeemRequest({
      sendPeer:        vi.fn(async () => { throw new Error('NKN down'); }),
      isPeerConnected: () => true,
      pendingMap,
    });
    await expect(send({ adminPeerAddr: 'app.x', groupId: 'g', code: 'C' }))
      .rejects.toThrow(/Failed to reach admin over NKN/);
    expect(pendingMap.size).toBe(0);
  });
});

describe('W10 — the admin\'s display rides back on the redeem reply (2026-08-29)', () => {
  it('carries confirmedByDisplay when the admin has a handle in this circle', async () => {
    const d = reqDeps({ ownDisplayFor: vi.fn(async () => 'nieuwe-buur') });
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest({ peerDisplay: 'handletest' }));
    expect(d.sendPeer).toHaveBeenCalledWith('peer-A', expect.objectContaining({
      subtype: 'group-redeem-response', ok: true, confirmedByDisplay: 'nieuwe-buur',
    }));
  });

  it('omits the field when there is none — a missing name is a missing field, never a failed join', async () => {
    const d = reqDeps({ ownDisplayFor: vi.fn(async () => null) });
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest());
    const [, reply] = d.sendPeer.mock.calls[0];
    expect(reply.ok).toBe(true);
    expect('confirmedByDisplay' in reply).toBe(false);
  });

  it('by default reads its OWN roster row by per-circle address (the same row the members list shows)', async () => {
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'verifyMembershipCodeForPeer') return { codeId: 'c-1', validUntil: 9999999999 };
      if (op === 'listGroupMembers') return { members: [
        { webid: 'me', handle: 'nieuwe-buur', circleAddress: 'addr-me' },
        { webid: 'peer-A', handle: null, circleAddress: 'addr-A' },
      ] };
      return {};
    });
    const d = reqDeps({ callSkill, circleAddressFor: () => 'addr-me' });
    const handle = makeHandleGroupRedeemRequest(d);
    await handle('peer-A', validRequest());
    const [, reply] = d.sendPeer.mock.calls[0];
    expect(reply.confirmedByDisplay).toBe('nieuwe-buur');
  });
});
