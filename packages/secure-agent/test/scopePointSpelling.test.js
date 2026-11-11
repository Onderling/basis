/**
 * A circle's scope names its relay as a POINT; the relay socket knows the url it dialled. One relay reaches the app
 * under several spellings (a trailing slash, the case of the host, a written-out default port, the http(s) form), and
 * a raw string comparison then reads "not one of my points": the circle's traffic skips its own relay. On the emulator
 * this lost a reply (the circle's point and the socket named the host two ways). `pointKey` is the one comparison.
 *
 * And `explainRoute`: the same decision `route` takes, described without sending, by transport KIND and never by url
 * or address, so the app's send gate can write one record per send that names the branch.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const HOLD = { firstSendTimeoutMs: 800, retryDelays: [], guarantee: 'hold-forward' };

class UrlTransport extends InternalTransport {
  constructor(bus, addr, url) { super(bus, addr); this._url = url; }
  get url() { return this._url; }
  get supportsAliases() { return true; }
}
class MeshTransport extends InternalTransport {
  get supportsAliases() { return false; }
}
const agent = (onPeerMessage) => createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });
function watch(t) {
  const log = [];
  const put = t._put.bind(t);
  t._put = async (to, env) => { log.push(to); return put(to, env); };
  return log;
}

async function pair({ socketUrl }) {
  const busR = new InternalBus();
  const busN = new InternalBus();
  const received = [];
  const anna = await agent();
  const bram = await agent((m) => received.push(m));
  const relay = new UrlTransport(busR, anna.identity.pubKey, socketUrl);
  const nkn = new MeshTransport(busN, anna.identity.pubKey);
  await anna.addSecureTransport('relay', relay);
  await anna.addSecureTransport('nkn', nkn);
  await bram.addSecureTransport('relay', new UrlTransport(busR, bram.identity.pubKey, socketUrl));
  await bram.addSecureTransport('nkn', new MeshTransport(busN, bram.identity.pubKey));
  return { anna, bram, relay, nkn, received };
}

describe('the scope compares points by pointKey, not by raw string', () => {
  it('a circle whose point is spelled differently from the socket url still rides its relay', async () => {
    const { anna, bram, relay, nkn } = await pair({ socketUrl: 'wss://relay.example.org' });
    const onRelay = watch(relay);
    const onNkn = watch(nkn);
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hoi' },
      { ...HOLD, scope: { points: ['WSS://Relay.Example.org:443/'], requireAliasCapable: true } });
    expect(r.held, 'the circle held its message because the same relay was spelled two ways').toBe(false);
    expect(r.delivered).toBe(true);
    expect(onRelay.length).toBeGreaterThan(0);
    expect(onNkn).toEqual([]);
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('explainRoute — the decision, by kind, without sending', () => {
  it('names each candidate with why it is (not) eligible and whether it reaches, and the one chosen', async () => {
    const { anna, bram } = await pair({ socketUrl: 'wss://relay.example.org' });
    const e = await anna.peer.explainRoute(bram.identity.pubKey, { points: ['wss://relay.example.org/'], requireAliasCapable: true });
    expect(e.scoped).toBe(true);
    expect(e.chosen).toBe('relay');
    expect(e.candidates).toEqual([
      { kind: 'relay', eligible: true, why: 'ok', reach: true },
      { kind: 'nkn', eligible: false, why: 'no-aliases', reach: true },
    ]);
    await anna.shutdown(); await bram.shutdown();
  });

  it('a relay that is NOT one of the circle\'s points is named as a point mismatch', async () => {
    const { anna, bram } = await pair({ socketUrl: 'wss://relay.example.org' });
    const e = await anna.peer.explainRoute(bram.identity.pubKey, { points: ['wss://elsewhere.example.org'], requireAliasCapable: true });
    expect(e.chosen).toBe(null);
    expect(e.candidates[0]).toEqual({ kind: 'relay', eligible: false, why: 'point-mismatch', reach: true });
    await anna.shutdown(); await bram.shutdown();
  });

  it('unscoped: the candidates as routing sees them, and nothing in the answer is an address or a url', async () => {
    const { anna, bram } = await pair({ socketUrl: 'wss://relay.example.org' });
    const e = await anna.peer.explainRoute(bram.identity.pubKey, null);
    expect(e.scoped).toBe(false);
    expect(typeof e.chosen).toBe('string');
    const flat = JSON.stringify(e);
    expect(flat).not.toContain(bram.identity.pubKey);
    expect(flat).not.toContain('example.org');
    await anna.shutdown(); await bram.shutdown();
  });
});
