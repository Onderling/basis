/**
 * A greeting (HI) is the secure channel's own handshake, not something a peer says to the app: it is answered and
 * told as a `peer` event here, and never handed to `onPeerMessage`. Handed on, its payload (`pubKey`, `label`, `ack`,
 * `capabilities` — no `subtype`, no `type`) reached every app router as a message it could not route: the household
 * box logged each companion reconnect as an "unrouted" frame.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { VaultMemory } from '@onderling/vault';

function fakeTransport() {
  const handlers = {};
  return {
    address: 'fake.addr',
    useSecurityLayer() { /* not under test */ },
    on(evt, fn) { handlers[evt] = fn; },
    async connect() { /* no-op */ },
    async disconnect() { /* no-op */ },
    async sendHello() { /* the answer is not under test */ },
    async sendOneWay() { return { ok: true }; },
    async inbound(env) { await handlers.envelope?.(env); },
  };
}

describe('a HI is not a peer message', () => {
  it('a greeting raises `peer`, never onPeerMessage; an ordinary message still reaches it', async () => {
    const seen = [];
    const peers = [];
    const tx = fakeTransport();
    const sa = await createSecureAgent({ vault: new VaultMemory(), onPeerMessage: (env) => seen.push(env.payload) });
    sa.agent?.on?.('peer', (p) => peers.push(p.address));
    await sa.addSecureTransport('relay', tx);

    await tx.inbound({ _from: 'cato', _id: 'hi-1', _p: 'HI', payload: { pubKey: 'pk-cato', label: 'companion', ack: false } });
    expect(seen, 'the greeting reached the app as a message').toEqual([]);

    await tx.inbound({ _from: 'cato', _id: 'm-1', _p: 'OW', payload: { subtype: 'chat-message', text: 'hoi' } });
    expect(seen.map((p) => p.subtype)).toEqual(['chat-message']);
  });
});
