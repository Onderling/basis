/**
 * A message held because the circle had no route it MAY use is re-driven when the terms change.
 *
 * The hold snapshots the send's scope (`requireAliasCapable` — the address-fallback setting, inverted).
 * When the user accepts the fallback, that snapshot is stale: nothing about the peer changed, so no
 * presence signal will ever flush it, and the accepted setting would only apply to messages typed AFTER
 * the offer — the one that produced the offer stays parked. `flushHeld({ rescope })` re-stamps every held
 * entry with the caller's current terms and re-sends it.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, circleIdentity, deriveCircleAddress } from '@onderling/core';
import nacl from 'tweetnacl';
import { createSecureAgent } from '../src/createSecureAgent.js';

const HOLD = { firstSendTimeoutMs: 800, retryDelays: [], guarantee: 'hold-forward' };

/** NKN-like: reachable, but it cannot carry per-circle addresses. */
class MeshTransport extends InternalTransport {
  get supportsAliases() { return false; }
}

async function until(pred, { timeout = 1500, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return pred();
}

describe('a hold caused by the circle\'s own terms is released when the terms change', () => {
  it('held as no-eligible-route with the fallback off; flushHeld under the fallback delivers it', async () => {
    const bus = new InternalBus();
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => received.push(m) });
    await anna.addSecureTransport('nkn', new MeshTransport(bus, anna.identity.pubKey));
    await bram.addSecureTransport('nkn', new MeshTransport(bus, bram.identity.pubKey));

    const forbidding = { points: [], requireAliasCapable: true };
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'vast' }, { ...HOLD, scope: forbidding });
    expect(r.held, 'the only transport cannot carry per-circle addressing and the setting forbids the fallback').toBe(true);
    expect(r.reason).toBe('no-eligible-route');
    expect(anna.heldFor(bram.identity.pubKey)).toBe(1);

    // The user accepted the fallback. The peer did not change — only OUR terms did.
    const out = await anna.flushHeld({
      rescope: (opts) => (opts?.scope ? { ...opts, scope: { ...opts.scope, requireAliasCapable: false } } : opts),
    });
    expect(out.flushed).toBe(1);
    expect(await until(() => received.find((m) => m.payload?.text === 'vast')), 'the held message must arrive').toBeTruthy();
    expect(anna.heldFor(bram.identity.pubKey)).toBe(0);
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('the fallback is an ADDRESS fallback, not only a route one', () => {
  it('over a transport that cannot carry aliases, a message to a member\'s circle address goes to the PERSON', async () => {
    // What "allow my main address as a fallback" means: the bytes travel to the person's own address on
    // that transport; the envelope stays sealed to the per-circle alias. Routing over NKN while still
    // aiming at the alias sends the message into the void — and NKN reports that as delivered.
    const bus = new InternalBus();
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => received.push(m) });
    await anna.addSecureTransport('nkn', new MeshTransport(bus, anna.identity.pubKey));
    await bram.addSecureTransport('nkn', new MeshTransport(bus, bram.identity.pubKey));
    const alias = 'bram-in-this-circle';
    expect(anna.registerPeerAddress(alias, bram.identity.pubKey)).toBe(true);   // what the roster binds

    const accepted = { points: [], requireAliasCapable: false };
    const r = await anna.peer.sendTo(alias, { subtype: 'circle', text: 'via-de-persoon' }, { ...HOLD, scope: accepted });
    expect(r.delivered, 'NKN is eligible under the accepted fallback').toBe(true);
    expect(await until(() => received.find((m) => m.payload?.text === 'via-de-persoon')),
      'the message must reach the person the alias belongs to').toBeTruthy();
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('…and the SENDER side of the same fallback', () => {
  it('a per-circle `sendAs` over an alias-blind transport goes out as the person, to the person', async () => {
    // NKN authenticates the wire sender and binds the envelope's `_from` to it; a per-circle `_from` on
    // our canonical NKN client is dropped on arrival as a spoof. So on that transport the person speaks
    // to the person — the accepted fallback in both directions — and the payload is what it was.
    const bus = new InternalBus();
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => received.push(m) });
    const mesh = new MeshTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('nkn', mesh);
    await bram.addSecureTransport('nkn', new MeshTransport(bus, bram.identity.pubKey));
    const seed = new Uint8Array(nacl.randomBytes(32));
    const annaInCircle = await circleIdentity(seed, 'kring-1', new VaultMemory());
    const annaAlias = deriveCircleAddress(seed, 'kring-1');
    expect(anna.registerSelfIdentity(annaAlias, annaInCircle)).toBe(true);
    const bramAlias = 'bram-in-kring-1';
    anna.registerPeerAddress(bramAlias, bram.identity.pubKey);

    const wire = [];
    const put = mesh._put.bind(mesh);
    mesh._put = async (to, env) => { wire.push({ to, env }); return put(to, env); };

    const r = await anna.peer.sendTo(bramAlias, { subtype: 'circle', text: 'als-persoon' },
      { ...HOLD, scope: { points: [], requireAliasCapable: false }, sendAs: annaAlias });
    expect(r.delivered).toBe(true);
    expect(await until(() => received.find((m) => m.payload?.text === 'als-persoon')), 'it must land').toBeTruthy();
    const frame = wire.find((w) => w.env?.payload?.text === 'als-persoon' || w.env?._to === bram.identity.pubKey);
    expect(frame, 'the frame went over the mesh').toBeTruthy();
    expect(frame.to, 'to the PERSON').toBe(bram.identity.pubKey);
    expect(frame.env._from, 'from the PERSON — never the per-circle address this transport cannot vouch for').toBe(anna.identity.pubKey);
    await anna.shutdown(); await bram.shutdown();
  });
});
