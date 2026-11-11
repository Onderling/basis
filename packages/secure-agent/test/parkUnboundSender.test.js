/**
 * AN ENVELOPE TO ONE OF MY CIRCLE ADDRESSES FROM AN ADDRESS WHOSE KEY IS NOT BOUND HERE YET IS PARKED, NOT DROPPED.
 *
 * Found in a three-node walk: the founder's post reached a joiner a moment before the joiner bound her circle address to
 * her key, and the SecurityLayer refused it as UNKNOWN_SENDER and dropped it, although the roster had already vouched for
 * the key in the step before. Now it parks in the SAME park as a stale-roster envelope, with reason 'unbound-sender':
 * unread, capped (count and bytes), re-judged ONCE through the full check, admitted only if the key is bound by then.
 * Anything not addressed to one of my circle addresses keeps the drop.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, staleSender, allowSender, AgentIdentity } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(10); } return fn(); };
const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };

/**
 * A receiver with an identity at one circle address and an authorizer that VOUCHES for the member key there (naming the
 * circle as the bucket); a member that has sent once (its address bound by the handshake), after which the receiver
 * forgets that binding: what follows arrives from an address whose key is not bound here, the state the walk found.
 */
async function setup({ parkMax = 64, parkMaxBytes, vouch = 'member' } = {}) {
  const bus = new InternalBus();
  const got = [];
  const events = [];
  const parked = [];
  const receiver = await createSecureAgent({
    vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => got.push(m.payload?.n),
    parkStale: { max: parkMax, ...(parkMaxBytes ? { maxBytes: parkMaxBytes } : {}), ttlMs: 60_000, onParked: (b, info) => parked.push([b, info?.reason]), onEvent: (e) => events.push(e) },
  });
  const member = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
  const rTx = new InternalTransport(bus, receiver.identity.pubKey);
  await receiver.addSecureTransport('relay', rTx);
  await member.addSecureTransport('relay', new InternalTransport(bus, member.identity.pubKey));
  const circle = await AgentIdentity.generate(new VaultMemory());
  receiver.registerSelfIdentity(circle.pubKey, circle);
  await rTx.addAddress(circle.pubKey);
  receiver.setSenderAuthorizer(({ ownAddress, pattern, senderKey }) => {
    if (!ownAddress || pattern === 'HI') return allowSender('handshake-or-out-of-circle');
    if (vouch === 'member' && senderKey === member.identity.pubKey) return allowSender('member', 'circle-x');
    return staleSender('stranger', 'circle-x');
  });
  const send = (n, pad = '') => member.peer.sendTo(circle.pubKey, { subtype: 'probe', n, pad }, FAST).catch(() => {});
  await send(0);
  await until(() => got.includes(0));
  receiver.forgetPeerAddress(member.identity.pubKey);   // the binding is gone; the member still believes it said hello
  return { receiver, member, got, events, parked, send };
}

describe('unbound sender to my circle address: parked under the circle, re-judged once', () => {
  it('parked unread with reason unbound-sender; admitted after the key is bound and the host re-judges', async () => {
    const { receiver, member, got, events, parked, send } = await setup();
    await send(1);
    expect(await until(() => receiver.parkedCount('circle-x') === 1), 'not parked').toBe(true);
    expect(got, 'nothing read while parked').toEqual([0]);
    expect(parked).toContainEqual(['circle-x', 'unbound-sender']);
    expect(receiver.parkStats.unboundSender).toBe(1);
    receiver.registerPeerAddress(member.identity.pubKey, member.identity.pubKey);   // a roster read binds it
    receiver.rejudgeParked('circle-x');
    expect(await until(() => got.includes(1))).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['park', 'admit']);
    expect(events[1]).toMatchObject({ reason: 'unbound-sender', cause: 'host' });
  });

  it('still unbound at the re-judge: dropped, never admitted by having been parked', async () => {
    const { receiver, got, events, send } = await setup();
    await send(1);
    expect(await until(() => receiver.parkedCount('circle-x') === 1)).toBe(true);
    receiver.rejudgeParked('circle-x');
    await wait(50);
    expect(got).toEqual([0]);
    expect(receiver.parkedCount('circle-x')).toBe(0);
    expect(events.at(-1)).toMatchObject({ kind: 'drop', reason: 'unbound-sender' });
  });
});

describe('adversarial: a flood toward my circle address', () => {
  it('from an unbound address the roster vouches for: within the cap, oldest first, none admitted without a binding', async () => {
    const { receiver, got, events, send } = await setup({ parkMax: 4 });
    for (let n = 1; n <= 12; n++) await send(n);
    expect(await until(() => receiver.parkStats.droppedOverflow === 8)).toBe(true);
    expect(receiver.parkedCount('circle-x')).toBe(4);
    expect(events.filter((e) => e.kind === 'overflow').every((e) => e.cause === 'count')).toBe(true);
    receiver.rejudgeParked('circle-x');
    await wait(50);
    expect(got, 'nothing of the flood admitted').toEqual([0]);
  });

  it('from a key nobody vouches for: parked as a stranger within the cap, none admitted', async () => {
    // (nobody vouches for this key, so even the setup's first message was never admitted)
    const { receiver, got, send } = await setup({ parkMax: 4, vouch: 'nobody' });
    for (let n = 1; n <= 12; n++) await send(n);
    expect(await until(() => receiver.parkedCount('circle-x') === 4)).toBe(true);
    receiver.rejudgeParked('circle-x');
    await wait(50);
    expect(got, 'nothing of the flood admitted').toEqual([]);
  });

  it('the byte cap holds too: big envelopes push the oldest out by size, under the count cap', async () => {
    const { receiver, got, events, send } = await setup({ parkMax: 64, parkMaxBytes: 12_000 });
    const pad = 'x'.repeat(3_000);
    for (let n = 1; n <= 8; n++) await send(n, pad);
    expect(await until(() => events.some((e) => e.kind === 'overflow' && e.cause === 'bytes')), 'no byte-cap overflow').toBe(true);
    expect(receiver.parkedCount('circle-x')).toBeLessThan(8);
    expect(receiver.parkedCount('circle-x')).toBeGreaterThan(0);
    receiver.rejudgeParked('circle-x');
    await wait(50);
    expect(got).toEqual([0]);
  });
});
