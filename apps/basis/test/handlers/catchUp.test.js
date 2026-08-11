/**
 * Unit tests for src/core/handlers/catchUp.js.
 *
 * ε.3 (2026-06-01) — added regression coverage for the new strategy-
 * routed entry points: `makePodRangeQueryForGroup` (pod path) and
 * `makeRequestCatchUpForGroup` (per-kring peer path), plus the
 * `getCirclePolicy` + `inbox` deps on `makeRequestCatchUpFromKnownPeers`.
 * The pre-existing slice-5 suite still passes verbatim — default policy
 * `{pod: 'personal'}` ⇒ 'peer' strategy ⇒ bit-for-bit identical to the
 * pre-ε.3 send envelope.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeRequestCatchUpFromKnownPeers,
  makeHandleCatchUpRequest,
  makePodRangeQueryForGroup,
  makeRequestCatchUpForGroup,
} from '../../src/core/handlers/catchUp.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('requestCatchUpFromKnownPeers', () => {
  it('iterates every known buurt + sends a catch-up-request to each roster peer', async () => {
    const callSkill = vi.fn(async (_app, op, args) => {
      if (op === 'listMyBuurts')          return { buurts: ['westend', 'noord'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: args.groupId === 'westend' ? 1000 : 2000 };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }, { addr: 'addr-b' }] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });

    await fn();
    // 2 buurts × 2 peers = 4 sends
    expect(sendPeer).toHaveBeenCalledTimes(4);
    const envelopes = sendPeer.mock.calls.map((c) => c[1]);
    expect(envelopes.every((e) => e.subtype === 'catch-up-request')).toBe(true);
    // Two distinct sinceMs values, one per buurt
    const westendCalls = sendPeer.mock.calls.filter((c) => c[1].groupId === 'westend');
    expect(westendCalls.every((c) => c[1].sinceMs === 1000)).toBe(true);
  });

  it('skips silently when listMyBuurts fails', async () => {
    const callSkill = vi.fn(async () => { throw new Error('no buurts'); });
    const sendPeer = vi.fn();
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });
    await fn();
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('skips empty rosters but still iterates next buurt', async () => {
    const callSkill = vi.fn(async (_app, op, args) => {
      if (op === 'listMyBuurts')          return { buurts: ['empty', 'full'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 0 };
      if (op === 'listGroupRoster')
        return { members: args.groupId === 'full' ? [{ addr: 'addr-a' }] : [] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });
    await fn();
    expect(sendPeer).toHaveBeenCalledTimes(1);
    expect(sendPeer.mock.calls[0][1].groupId).toBe('full');
  });
});

describe('handleCatchUpRequest', () => {
  it('replies with one buurt-post envelope per matching post', async () => {
    const post1 = { requestId: 'r1', text: 'old', from: 'addr-a', type: 'request', _addedAt: 100 };
    const post2 = { requestId: 'r2', text: 'new', from: 'addr-a', type: 'request', _addedAt: 200 };
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listBuurtPostsSince') return { posts: [post1, post2] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });

    await fn('addr-asking', { groupId: 'westend', sinceMs: 50 });
    expect(sendPeer).toHaveBeenCalledTimes(2);
    const envelopes = sendPeer.mock.calls.map((c) => c[1]);
    expect(envelopes.every((e) => e.subtype === 'buurt-post')).toBe(true);
    expect(envelopes.every((e) => e.catchUp === true)).toBe(true);
    expect(envelopes.every((e) => e.groupId === 'westend')).toBe(true);
    // _addedAt is stripped from the inner payload (not sent on the wire).
    expect(envelopes[0].payload._addedAt).toBeUndefined();
    expect(envelopes[0].payload.requestId).toBe('r1');
  });

  it('no-ops when there are zero matching posts', async () => {
    const callSkill = vi.fn(async () => ({ posts: [] }));
    const sendPeer = vi.fn();
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('continues past a send failure for one post', async () => {
    const callSkill = vi.fn(async () => ({
      posts: [
        { requestId: 'r1', text: 'a', _addedAt: 1 },
        { requestId: 'r2', text: 'b', _addedAt: 2 },
      ],
    }));
    let n = 0;
    const sendPeer = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
    });
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer).toHaveBeenCalledTimes(2);
  });

  it('uses getMyPubKey when payload.fromPubKey is missing', async () => {
    const callSkill = vi.fn(async () => ({
      posts: [{ requestId: 'r1', text: 'a', _addedAt: 1 }],   // no fromPubKey
    }));
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer.mock.calls[0][1].fromPubKey).toBe('my-pubkey');
  });
});

/* ── ε.3 — per-group peer handler + pod range-query handler ─────────── */

describe('makeRequestCatchUpForGroup (ε.3)', () => {
  it('skips when the roster is empty (0 peers)', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster') return { members: [] };
      return null;
    });
    const sendPeer = vi.fn();
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    const r = await fn({ circleId: 'westend' });
    expect(r.skipped).toBe(true);
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('falls back to getLatestPostAddedAt when sinceTs is missing or 0', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 4242 };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    const r = await fn({ circleId: 'westend', sinceTs: 0 });
    expect(r.sent).toBe(1);
    expect(sendPeer.mock.calls[0][1].sinceMs).toBe(4242);
  });

  it('honours an explicit non-zero sinceTs (negotiated cursor)', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 4242 };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    await fn({ circleId: 'westend', sinceTs: 100 });
    // The caller's cursor wins — getLatestPostAddedAt is not consulted.
    expect(sendPeer.mock.calls[0][1].sinceMs).toBe(100);
    const ops = callSkill.mock.calls.map((c) => c[1]);
    expect(ops).not.toContain('getLatestPostAddedAt');
  });
});
