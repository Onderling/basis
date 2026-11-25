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
