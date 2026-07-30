/**
 * A peer who HIs us must ALWAYS get an answer — even one we have HI'd before.
 *
 * Found finishing the first message round-trip on hardware (2026-07-30), and it had been masking a fix for
 * the whole morning. `helloedPeers` was a single Set answering two different questions:
 *
 *   - the SEND path asked "have I announced myself to this peer, so may I encrypt to them?"
 *   - the RECEIVE path asked "have I already replied to this peer?"
 *
 * Once we had ever sent someone an HI ourselves, the receive path considered them answered and went silent.
 * So a peer who no longer held our key — after a restart, a reinstall, or arriving on a new per-circle
 * address — could HI us indefinitely while we said nothing, and they would time out reporting *us* as
 * offline. On the device this looked exactly like a network fault: a walk-peer up for eight hours had 79
 * inbound envelopes and had sent 2 replies.
 *
 * The old guard existed to stop an infinite HI ping-pong (A answers B, B answers A, …). That is now handled
 * by MARKING the answer rather than by refusing to answer twice: a reply carries `reply: true` and a reply
 * never provokes a reply, so an exchange terminates in one round. These tests pin both halves — always
 * answer, and never loop — because fixing either one alone reintroduces the other bug.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { VaultMemory } from '@onderling/vault';

/**
 * A transport stub that records `sendHello` calls and lets a test inject inbound envelopes.
 *
 * Deliberately minimal: the property under test is which HIs we EMIT in response to what we RECEIVE, so a
 * real transport would only add timing noise.
 */
function fakeTransport() {
  const handlers = {};
  return {
    address: 'fake.addr',
    hellos: [],
    sends:  [],
    useSecurityLayer() { /* the property under test is which HIs we emit, not sealing */ },
    on(evt, fn) { handlers[evt] = fn; },
    async connect() { /* no-op */ },
    async disconnect() { /* no-op */ },
    async sendHello(to, payload, opts) { this.hellos.push({ to, payload, opts }); },
    async sendOneWay(to, payload) { this.sends.push({ to, payload }); return { ok: true }; },
    /** Deliver an envelope as if it arrived on the wire. */
    async inbound(env) { await handlers.envelope?.(env); },
  };
}

/** An agent with one injected transport, wired the way `addSecureTransport` wires a real one. */
async function agentOn(tx) {
  const sa = await createSecureAgent({ vault: new VaultMemory() });
  await sa.addSecureTransport('relay', tx);
  return sa;
}

/**
 * An inbound HI. `re` marks it as a REPLY — the envelope's own reply-to atom (`_re`), not a payload flag:
 * an answer names the envelope it answers, which is both zero new wire fields and more informative than a
 * boolean (a late or duplicate reply can be matched to its question).
 */
const HI = (from, { re = null } = {}) => ({
  _from: from, _id: `env-${from}-in`, _p: 'HI', _re: re, payload: { pubKey: `pk-${from}` },
});

describe('an inbound HI is always answered', () => {
  it('answers a repeated HI from the same peer — the bug', async () => {
    const tx = fakeTransport();
    await agentOn(tx);

    await tx.inbound(HI('cato'));
    const first = tx.hellos.length;
    expect(first, 'no answer to the first HI at all').toBeGreaterThan(0);

    // Same peer HIs again, e.g. because they restarted and lost our key. Under the old single-Set guard
    // this produced silence, and the peer timed out calling us offline.
    await tx.inbound(HI('cato'));
    expect(tx.hellos.length, 'a second HI from a known peer went unanswered').toBeGreaterThan(first);
  });

  it('the answer NAMES the HI it answers, which is what makes it unanswerable', async () => {
    const tx = fakeTransport();
    await agentOn(tx);
    await tx.inbound(HI('cato'));
    // Third arg: `{from, re}`. `re` is the inbound envelope's `_id`, threaded to `_re` by `sendHello`.
    expect(tx.hellos.at(-1)?.opts ?? {}).toMatchObject({ re: 'env-cato-in' });
    // …and no invented payload flag.
    expect(tx.hellos.at(-1)?.payload?.reply).toBeUndefined();
  });

  it('a reply HI is NOT answered — this is what stops the ping-pong', async () => {
    const tx = fakeTransport();
    await agentOn(tx);
    await tx.inbound(HI('cato', { re: 'some-earlier-id' }));
    expect(tx.hellos, 'answering a reply is how an infinite handshake loop starts').toEqual([]);
  });

  it('…and the exchange therefore terminates in one round, however many replies arrive', async () => {
    const tx = fakeTransport();
    await agentOn(tx);
    for (let i = 0; i < 5; i += 1) await tx.inbound(HI('cato', { re: 'some-earlier-id' }));
    expect(tx.hellos).toEqual([]);
  });
});

describe('a non-HI envelope still gets one reciprocal HI, not one per message', () => {
  it('first contact triggers an HI', async () => {
    const tx = fakeTransport();
    await agentOn(tx);
    await tx.inbound({ _from: 'cato', type: 'message', payload: { subtype: 'chat' } });
    expect(tx.hellos.length).toBe(1);
  });

  it('but a chatty peer does not make us spam them', async () => {
    const tx = fakeTransport();
    await agentOn(tx);
    for (let i = 0; i < 10; i += 1) {
      await tx.inbound({ _from: 'cato', type: 'message', payload: { subtype: 'chat', i } });
    }
    expect(tx.hellos.length, 'one reciprocal HI per peer, not per message').toBe(1);
  });

  it('and a later explicit HI from that same peer is still answered', async () => {
    // The combination that matters: the peer messaged us (so they are "reciprocated"), then lost our key and
    // re-handshaked. The re-handshake must not be swallowed by the first-contact bookkeeping.
    const tx = fakeTransport();
    await agentOn(tx);
    await tx.inbound({ _from: 'cato', type: 'message', payload: { subtype: 'chat' } });
    const afterMessage = tx.hellos.length;
    await tx.inbound(HI('cato'));
    expect(tx.hellos.length).toBeGreaterThan(afterMessage);
  });
});
