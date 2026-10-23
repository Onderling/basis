/**
 * ON THE LAN, `_from` IS THE KEY THE CONNECTION PROVED. The challenged hello keys a connection to the key that proved
 * itself on it — but a data frame's `_from` was never compared with that key. So a device that joined the Wi-Fi
 * honestly, with its own key, could push a frame claiming ANOTHER listed peer's address over its own proven socket;
 * a receiver that had not yet bound that address learned the forger's key for it on the first hello (trust on first
 * use), and from then on the forger spoke as that person — in the Nearby room, whose gate is "listed right now", and
 * anywhere else that address is trusted. The relay (registration proof) and NKN (`src` binding) already bind the
 * sender to the connection through the kernel's one rule (`createSenderBinding`); this is mDNS adopting it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { MdnsTransport } from '../src/MdnsTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 120) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());

describe('mDNS sender binding', () => {
  const open = [];
  afterEach(async () => { for (const t of open.splice(0)) await t.disconnect?.().catch?.(() => {}); });
  const device = async (discovery, identity) => {
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const t = new MdnsTransport({ identity, native, emitter });
    open.push(t);
    await t.connect();
    return t;
  };

  it('a proven peer cannot speak as another peer: a frame whose _from is not its own key never arrives', async () => {
    const discovery = createLoopbackDiscovery();
    const [a, m, t] = [await ident(), await ident(), await ident()];
    const T = await device(discovery, t);
    const A = await device(discovery, a);   // the person
    const M = await device(discovery, m);   // someone else on the Wi-Fi, honest about its own key
    expect(await settle(() => T.canReach(a.pubKey) && T.canReach(m.pubKey) && M.canReach(t.pubKey)), 'all on the LAN').toBe(true);
    const got = [];
    T.on('envelope', (e) => got.push(e));

    // M, over ITS OWN proven connection, pushes a hello that names A as the sender
    await M._put(t.pubKey, { _p: 'HI', _id: 'forged-1', _from: a.pubKey, _to: t.pubKey, _ts: Date.now(), payload: { hello: true } });
    // and an honest frame of its own, so we know the socket delivers at all
    await M.sendOneWay(t.pubKey, { honest: true });
    await settle(() => got.some((e) => e._from === m.pubKey));
    expect(got.some((e) => e._from === m.pubKey), 'M speaking as M arrives').toBe(true);
    expect(got.some((e) => e._from === a.pubKey), 'M speaking as A does not').toBe(false);
  });
});
