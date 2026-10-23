/**
 * The Transport port's SENDER-BINDING case, over the transports that prove a sender: mDNS (the challenged hello) and
 * NKN (its authenticated `src`). Each must drop a frame whose `_from` is not what its connection proved. The relay's
 * run lives with the relay (`packages/relay/test/senderBinding.conformance.test.js`): there the binding is the
 * server's — its registration proof and per-socket address set — not the client's.
 */
import { describe, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { assertSenderBindingConformance } from '@onderling/core/conformance';
import { MdnsTransport } from '../src/MdnsTransport.js';
import { NknTransport } from '../src/NknTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 160) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };

describe('Transport port — sender binding', () => {
  it('mDNS: a frame claiming another key over a proven connection is dropped', async () => {
    await assertSenderBindingConformance(async () => {
      const discovery = createLoopbackDiscovery();
      const mk = async (identity) => {
        const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
        const t = new MdnsTransport({ identity, native, emitter });
        await t.connect();
        return t;
      };
      const [ia, ib, other] = [await ident(), await ident(), await ident()];
      const a = await mk(ia); const b = await mk(ib);
      await settle(() => a.canReach(ib.pubKey) && b.canReach(ia.pubKey));
      return { a, b, addrA: ia.pubKey, addrB: ib.pubKey, forgedAddr: other.pubKey,
        async teardown() { await a.disconnect().catch(() => {}); await b.disconnect().catch(() => {}); } };
    }, { label: 'MdnsTransport' });
  });

  it('NKN: a frame claiming another address than its authenticated src is dropped', async () => {
    await assertSenderBindingConformance(async () => {
      // a two-ended fake nkn network: a send arrives at the addressee as nkn would hand it — `src` = the sender's
      // address, encrypted (the only frames nkn authenticates)
      const clients = new Map();
      const libFor = (addr) => {
        class FakeClient {
          constructor() { this.addr = addr; this._h = {}; clients.set(addr, this); }
          on(evt, cb) { this._h[evt] = cb; if (evt === 'connect') setTimeout(() => cb(), 0); }
          async send(to, payload) {
            const peer = clients.get(to);
            setTimeout(() => peer?._h.message?.({ src: this.addr, payload: Buffer.from(String(payload)), encrypted: true }), 0);
          }
          close() { clients.delete(this.addr); }
        }
        return { Client: FakeClient, MultiClient: FakeClient };
      };
      const hex = () => randomBytes(32).toString('hex');
      const [addrA, addrB, forgedAddr] = [hex(), hex(), hex()];
      const a = new NknTransport({ identity: await ident(), nknLib: libFor(addrA) });
      const b = new NknTransport({ identity: await ident(), nknLib: libFor(addrB) });
      await a.connect(); await b.connect();
      return { a, b, addrA, addrB, forgedAddr,
        async teardown() { await a.disconnect().catch(() => {}); await b.disconnect().catch(() => {}); } };
    }, { label: 'NknTransport' });
  });
});
