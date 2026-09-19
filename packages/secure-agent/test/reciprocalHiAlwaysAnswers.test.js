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

describe('interop with the core hello protocol (its answer says `ack`, not `_re`)', () => {
  it('an inbound HI that says ack:true is a reply — NOT answered again', async () => {
    // Phone (secure agent) ↔ companion (core Agent) over mDNS, 2026-08-30: the core acked our reciprocal
    // HI with `ack:true` and no `_re`; we took it for a fresh HI and reciprocated; the core acked that…
    // 263 HIs in a minute.
    const tx = fakeTransport();
    const sa = await agentOn(tx);
    await tx.inbound({ _from: 'p', _id: 'core-ack-1', _p: 'HI', _re: null, payload: { pubKey: 'pk-p', ack: true } });
    expect(tx.hellos).toHaveLength(0);
    await sa.shutdown();
  });

  it('our reciprocal HI says ack:true too, so a core peer does not ack it', async () => {
    const tx = fakeTransport();
    const sa = await agentOn(tx);
    await tx.inbound(HI('p'));
    expect(tx.hellos).toHaveLength(1);
    expect(tx.hellos[0].payload.ack).toBe(true);
    expect(tx.hellos[0].opts.re).toBe('env-p-in');
    await sa.shutdown();
  });
});

/**
 * A HI that dialled one of our PER-CIRCLE addresses is answered AS that address (G13) — and never over a
 * transport that cannot carry the address as the sender. Measured 2026-09-19 on two web apps: B's HI to A's
 * pair-circle address arrived over the alias-blind transport (NKN); A answered on that same transport, which
 * fell back to A's canonical address; the answer reached B's per-circle address signed by the person, and B
 * refused it ("a member's canonical identity where they sign per-circle") — one refusal in every join's log,
 * and a handshake that only completed on a later retry. The send path already has the rule ("on an alias-blind
 * transport the person speaks to the person"); the answer must follow it: an alias answer goes over an
 * alias-capable transport, or is not sent from the primary in the alias's name.
 */
describe('a HI to one of our per-circle addresses is answered as that address, over a transport that can carry it', () => {
  const aliasBlind = () => ({ ...fakeTransport(), address: 'mesh.addr', supportsAliases: false });
  const aliasCapable = () => ({ ...fakeTransport(), address: 'relay.addr', supportsAliases: true, canReach: () => true });

  it('over the alias-capable transport when the dialled address is an alias — even if the HI arrived over the blind one', async () => {
    const mesh = aliasBlind(); const relay = aliasCapable();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('nkn', mesh);
    await sa.addSecureTransport('relay', relay);
    // this device's per-circle identity, as `useCircleSigningIdentity` installs it
    const { AgentIdentity } = await import('@onderling/core');
    const circleId = await AgentIdentity.generate(new VaultMemory());
    sa.registerSelfIdentity(circleId.pubKey, circleId);
    // B dials the per-circle address; the envelope arrives over the mesh transport
    await mesh.inbound({ ...HI('bea-in-pair'), _to: circleId.pubKey });
    expect(mesh.hellos, 'no answer in the alias\'s name over a transport that would send it as the primary').toEqual([]);
    expect(relay.hellos.length, 'the answer went over the transport that carries the alias').toBe(1);
    expect(relay.hellos[0].opts.from, 'answered AS the address dialled').toBe(circleId.pubKey);
    expect(relay.hellos[0].payload.pubKey, 'with the key that belongs to it').toBe(circleId.pubKey);
  });

  it('a HI to the canonical address is answered where it arrived, as before', async () => {
    const mesh = aliasBlind(); const relay = aliasCapable();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('nkn', mesh);
    await sa.addSecureTransport('relay', relay);
    await mesh.inbound({ ...HI('cato'), _to: sa.pubKey ?? 'mesh.addr' });
    expect(mesh.hellos.length).toBe(1);
    expect(relay.hellos).toEqual([]);
  });

  it('with no alias-capable transport at all, the alias answer is not sent from the primary in the alias\'s name', async () => {
    const mesh = aliasBlind();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('nkn', mesh);
    const { AgentIdentity } = await import('@onderling/core');
    const circleId = await AgentIdentity.generate(new VaultMemory());
    sa.registerSelfIdentity(circleId.pubKey, circleId);
    await mesh.inbound({ ...HI('bea-in-pair'), _to: circleId.pubKey });
    expect(mesh.hellos, 'silence beats a canonical answer the peer refuses and files wrongly').toEqual([]);
  });
});
