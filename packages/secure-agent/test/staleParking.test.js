/**
 * PARKED, NOT DROPPED, NOT DELIVERED. When the sender authorizer answers "stale" (it cannot vouch for this sender YET:
 * its snapshot may be behind), the verified envelope is PARKED per bucket: no app handler, no ack, no receipt. The host
 * is told (so it can refresh its snapshot) and the bucket is re-judged EXACTLY ONCE when the host says so, or at the
 * time limit: accepted → delivered in arrival order; still not → dropped and counted; never parked twice. Bounded per
 * bucket (oldest dropped first, counted); one flooded bucket starves no other.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, staleSender, allowSender, refuseSender, AgentIdentity } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(10); } return fn(); };
const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };

/**
 * A receiver with an identity at one "circle" address and a switchable authorizer for traffic to it; a sender that
 * seals to that address. HI is always allowed (the handshake), everything else follows `mode`.
 */
async function setup({ parkMax = 64, parkTtlMs = 60_000 } = {}) {
  const bus = new InternalBus();
  const got = [];
  const parkedBuckets = [];
  const receiver = await createSecureAgent({
    vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => got.push(m.payload?.n),
    parkStale: { max: parkMax, ttlMs: parkTtlMs, onParked: (bucket) => parkedBuckets.push(bucket) },
  });
  const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
  const receiverTx = new InternalTransport(bus, receiver.identity.pubKey);
  await receiver.addSecureTransport('relay', receiverTx);
  const senderTx = new InternalTransport(bus, sender.identity.pubKey);
  await sender.addSecureTransport('relay', senderTx);
  const circleId = await AgentIdentity.generate(new VaultMemory());
  receiver.registerSelfIdentity(circleId.pubKey, circleId);
  await receiverTx.addAddress(circleId.pubKey);   // the transport answers at the circle address, as the app binds it
  const ctl = { mode: 'stale', bucket: 'circle-x' };
  receiver.setSenderAuthorizer(({ ownAddress, pattern }) => {
    if (!ownAddress || pattern === 'HI') return allowSender('handshake-or-out-of-circle');
    if (ctl.mode === 'allow') return allowSender('member');
    if (ctl.mode === 'refuse') return refuseSender('stranger');
    return staleSender('roster-not-read', ctl.bucket);
  });
  const send = (n) => sender.peer.sendTo(circleId.pubKey, { subtype: 'probe', n }, FAST).catch(() => {});
  return { receiver, sender, senderTx, got, parkedBuckets, ctl, send, circle: circleId.pubKey };
}

describe('a stale verdict parks the envelope', () => {
  it('parked: not delivered, the host told; re-judged once after the refresh: delivered in arrival order', async () => {
    const { receiver, got, parkedBuckets, ctl, send } = await setup();
    await send(1); await send(2);
    expect(await until(() => receiver.parkedCount('circle-x') === 2)).toBe(true);
    expect(got, 'nothing delivered while parked').toEqual([]);
    expect(parkedBuckets).toContain('circle-x');
    ctl.mode = 'allow';
    receiver.rejudgeParked('circle-x');
    expect(await until(() => got.length === 2)).toBe(true);
    expect(got).toEqual([1, 2]);
    expect(receiver.parkedCount('circle-x')).toBe(0);
  });

  it('still not vouched for at the re-judge: dropped and counted, never parked a second time', async () => {
    const { receiver, got, ctl, send } = await setup();
    await send(1);
    expect(await until(() => receiver.parkedCount('circle-x') === 1)).toBe(true);
    receiver.rejudgeParked('circle-x');   // still stale
    await wait(50);
    expect(receiver.parkedCount('circle-x')).toBe(0);
    expect(receiver.parkStats.droppedAfterRejudge).toBe(1);
    ctl.mode = 'refuse';
    expect(got).toEqual([]);
  });

  it('bounded per bucket, oldest dropped first and counted; another bucket is untouched', async () => {
    const { receiver, ctl, send } = await setup({ parkMax: 3 });
    for (let n = 1; n <= 5; n++) await send(n);
    expect(await until(() => receiver.parkStats.droppedOverflow === 2)).toBe(true);
    expect(receiver.parkedCount('circle-x')).toBe(3);
    ctl.bucket = 'circle-y';
    await send(6);
    expect(await until(() => receiver.parkedCount('circle-y') === 1)).toBe(true);
    expect(receiver.parkedCount('circle-x')).toBe(3);
  });

  it('a parked envelope is not acknowledged: the sender is never told it arrived', async () => {
    const { receiver, senderTx, ctl, send, circle } = await setup();
    await send(0);   // the handshake, so the sender can seal to the circle address
    expect(await until(() => receiver.parkedCount('circle-x') === 1)).toBe(true);
    const ack = (n) => senderTx.sendAck(circle, { subtype: 'probe', n }, 400).then(() => 'acked', () => 'no-ack');
    expect(await ack(1), 'parked: no AK reaches the sender').toBe('no-ack');
    expect(receiver.parkedCount('circle-x')).toBe(2);
    ctl.mode = 'allow';
    expect(await ack(2), 'the same path acknowledges an accepted envelope').toBe('acked');
  });

  it('at the time limit the bucket is re-judged on its own', async () => {
    const { receiver, got, ctl, send } = await setup({ parkTtlMs: 150 });
    await send(1);
    expect(await until(() => receiver.parkedCount('circle-x') === 1)).toBe(true);
    ctl.mode = 'allow';
    expect(await until(() => got.length === 1, 2000)).toBe(true);
  });
});
