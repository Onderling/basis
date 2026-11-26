/**
 * The wire refusal: every signed envelope carries this build's wire (`_w`) inside its signature; a peer whose wire is
 * below ours is refused at the receive gate, gets ONE refusal frame back, and both sides hold the reason — never a
 * silent drop, never a timeout with no why.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { SecurityLayer, SEC } from '../src/security/SecurityLayer.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { WIRE_VERSION, MIN_WIRE, WIRE_FIELD } from '../src/protocol/wire.js';
import { mkEnvelope, P } from '../src/Envelope.js';

const tick = (ms = 30) => new Promise((r) => { setTimeout(r, ms); });
function agentOn(bus, identity, wire = {}) {
  return new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    security: new SecurityLayer({ identity, ...wire }),
  });
}

describe('the wire stamp', () => {
  it('rides inside the signature: a lowered or stripped `_w` no longer verifies', async () => {
    const aId = await AgentIdentity.generate(new VaultMemory());
    const bId = await AgentIdentity.generate(new VaultMemory());
    const a = new SecurityLayer({ identity: aId });
    const b = new SecurityLayer({ identity: bId });
    const signed = a.encrypt(mkEnvelope(P.HI, aId.pubKey, bId.pubKey, { pubKey: aId.pubKey, ack: false }));
    expect(signed[WIRE_FIELD]).toBe(WIRE_VERSION);
    const stripped = { ...signed, _id: `${signed._id}-x` };
    delete stripped[WIRE_FIELD];
    expect(() => b.decryptAndVerify(stripped)).toThrow(expect.objectContaining({ code: SEC.BAD_SIG }));
    expect(b.decryptAndVerify(signed)[WIRE_FIELD]).toBe(WIRE_VERSION);
  });

  it('a wire below MIN_WIRE is refused at the receive gate with its own code, naming the peer and its wire', async () => {
    const aId = await AgentIdentity.generate(new VaultMemory());
    const bId = await AgentIdentity.generate(new VaultMemory());
    const a = new SecurityLayer({ identity: aId, wire: 1 });
    const b = new SecurityLayer({ identity: bId, minWire: 2 });
    const signed = a.encrypt(mkEnvelope(P.HI, aId.pubKey, bId.pubKey, { pubKey: aId.pubKey, ack: false }));
    let err = null;
    try { b.decryptAndVerify(signed); } catch (e) { err = e; }
    expect(err?.code).toBe(SEC.WIRE_REFUSED);
    expect(err?.from).toBe(aId.pubKey);
    expect(err?.peerWire).toBe(1);
    expect(b.getPeerKey(aId.pubKey), 'a refused hello registers nothing').toBeFalsy();
  });

  it('the constants agree: this build accepts its own wire', () => {
    expect(MIN_WIRE).toBeLessThanOrEqual(WIRE_VERSION);
  });
});

describe('the refusal between two agents', () => {
  it('the older side\'s hello is refused: one refusal frame back, both sides hold the reason, the hello says why', async () => {
    const bus = new InternalBus();
    const older = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 1 });
    const newer = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2, minWire: 2 });
    await older.start(); await newer.start();
    const framesToOlder = [];
    const orig = newer.transport.sendHello.bind(newer.transport);
    newer.transport.sendHello = (to, payload, opts) => { framesToOlder.push(payload); return orig(to, payload, opts); };
    const heard = { older: [], newer: [] };
    older.on('wire-refused', (e) => heard.older.push(e));
    newer.on('wire-refused', (e) => heard.newer.push(e));

    const hello = older.hello(newer.address).then(() => 'answered', (e) => e);
    const outcome = await Promise.race([hello, tick(2_000).then(() => 'timeout')]);
    expect(outcome, 'the hello fails for the wire, not by timing out').toMatchObject({ code: SEC.WIRE_REFUSED });

    expect(newer.wireRefusal(older.address)).toEqual({ side: 'we-refused', wire: 1 });
    expect(older.wireRefusal(newer.address)).toEqual({ side: 'they-refused', wire: 2 });
    expect(heard.newer).toEqual([{ address: older.address, side: 'we-refused', wire: 1 }]);
    expect(heard.older).toEqual([{ address: newer.address, side: 'they-refused', wire: 2 }]);
    expect(framesToOlder).toHaveLength(1);
    expect(framesToOlder[0]).toEqual({ ack: true, refused: 'wire', wire: 2 });

    // a second envelope from the older side: refused again, but no second frame and no second word
    await older.hello(newer.address).catch(() => {});
    await tick();
    expect(framesToOlder).toHaveLength(1);
    expect(heard.newer).toHaveLength(1);
  });

  it('the newer side does not refuse an older peer whose wire it still accepts, and a newer peer is not refused', async () => {
    const bus = new InternalBus();
    const plain = agentOn(bus, await AgentIdentity.generate(new VaultMemory()));
    const ahead = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: WIRE_VERSION + 1 });
    await plain.start(); await ahead.start();
    plain.register('echo', async ({ parts }) => parts);
    await ahead.hello(plain.address);
    await ahead.call(plain.address, 'echo', 'hoi').done();
    expect(plain.wireRefusal(ahead.address)).toBeNull();
    expect(ahead.wireRefusal(plain.address)).toBeNull();
  });

  it('an old-wire envelope naming a bound address but signed by another key: refused as a substitution, no mark, no frame', async () => {
    const bus = new InternalBus();
    const contact = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2 });
    const me = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2, minWire: 2 });
    await contact.start(); await me.start();
    await contact.hello(me.address);   // binds the contact's key at my side
    const frames = [];
    const orig = me.transport.sendHello.bind(me.transport);
    me.transport.sendHello = (to, payload, opts) => { frames.push(payload); return orig(to, payload, opts); };
    const errors = [];
    me.on('security-error', (e) => errors.push(e.code));

    // a throwaway key, an old wire, and the contact's address as the sender
    const throwaway = new SecurityLayer({ identity: await AgentIdentity.generate(new VaultMemory()), wire: 1 });
    const forged = throwaway.encrypt(mkEnvelope(P.HI, contact.address, me.address, { pubKey: contact.address, ack: false }));
    me.transport._receive(forged);
    await tick();

    expect(errors).toEqual([SEC.SENDER_NOT_BOUND]);
    expect(me.wireRefusal(contact.address), 'nobody proved this sender: no mark').toBeNull();
    expect(frames, 'and no signed answer').toEqual([]);
  });

  it('an old-wire envelope from a key no roster vouches for, to a circle address of mine: no frame, no mark', async () => {
    const meId = await AgentIdentity.generate(new VaultMemory());
    const circleAddress = 'circle-address-of-mine';
    const layer = new SecurityLayer({
      identity: meId, minWire: 2,
      authorizeSender: ({ ownAddress }) => (ownAddress ? { allow: false, reason: 'not on the roster' } : { allow: true }),
    });
    layer.ownAddressFor = (to) => (to === circleAddress ? circleAddress : null);
    const strangerId = await AgentIdentity.generate(new VaultMemory());
    const stranger = new SecurityLayer({ identity: strangerId, wire: 1 });
    const env = stranger.encrypt(mkEnvelope(P.HI, strangerId.pubKey, circleAddress, { pubKey: strangerId.pubKey, ack: false }));
    let err = null;
    try { layer.decryptAndVerify(env); } catch (e) { err = e; }
    expect(err?.code, 'refused as a stranger, not answered for its wire').toBe(SEC.SENDER_NOT_AUTHORIZED);
  });

  it('a they-refused mark stands for the start: an accepted envelope from the newer side does not clear it', async () => {
    const bus = new InternalBus();
    const older = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 1 });
    const newer = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2, minWire: 2 });
    await older.start(); await newer.start();
    await older.hello(newer.address).catch(() => {});
    expect(older.wireRefusal(newer.address)?.side).toBe('they-refused');
    // the newer side's own hello reaches the older device (its gate accepts wire 2)
    await Promise.race([newer.hello(older.address).catch(() => {}), tick(300)]);
    await tick();
    expect(older.wireRefusal(newer.address)?.side, 'the words do not vanish').toBe('they-refused');
  });

  it('the refusal bookkeeping is bounded: a flood of names does not grow it past its cap', async () => {
    const bus = new InternalBus();
    const me = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2, minWire: 2 });
    await me.start();
    const tx = { holdsAddress: () => true, sendHello: () => Promise.resolve() };
    for (let i = 0; i < 1000; i += 1) me.refuseWire(tx, { from: `addr-${i}`, to: null, envelopeId: `e${i}`, peerWire: 1, answerable: true });
    expect(me.wireRefusal('addr-0'), 'the oldest is let go').toBeNull();
    expect(me.wireRefusal('addr-999')?.side).toBe('we-refused');
    expect(me.wireBookkeepingSize()).toBeLessThanOrEqual(3 * 256);
  });

  it('the mark clears when an envelope with an accepted wire arrives from that peer', async () => {
    const bus = new InternalBus();
    const oldId = await AgentIdentity.generate(new VaultMemory());
    const newer = agentOn(bus, await AgentIdentity.generate(new VaultMemory()), { wire: 2, minWire: 2 });
    const older = agentOn(bus, oldId, { wire: 1 });
    await older.start(); await newer.start();
    await older.hello(newer.address).catch(() => {});
    expect(newer.wireRefusal(older.address)?.side).toBe('we-refused');
    const cleared = [];
    newer.on('wire-cleared', (e) => cleared.push(e));
    // the same person, updated: a new agent on the same identity speaking wire 2
    await older.stop?.();
    const updated = agentOn(bus, oldId, { wire: 2 });
    await updated.start();
    await updated.hello(newer.address);
    expect(newer.wireRefusal(updated.address)).toBeNull();
    expect(cleared).toEqual([{ address: updated.address }]);
  });
});
