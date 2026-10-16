/**
 * A PERSONA'S OWN SOCKET (2026-10-10). A persona is a second identity of the person on the wire, so it dials its relays
 * on a socket of its OWN — the relay then sees two devices, not one device with two names — and what it sends leaves on
 * that socket only. A persona without a socket on any relay gets a typed refusal the agent can say, never a send on
 * another persona's socket: that fallback would be exactly the link the persona exists to prevent.
 *
 * The default identity's sockets, routes and sends are untouched: `relays.list()` still lists only them.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 2500, retryDelays: [] };
const agent = (onPeerMessage) => createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
async function until(pred, { timeout = 5000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

describe('a persona dials on its own socket, and speaks only there', () => {
  it('its socket is its own identity; the default\'s relay list is unchanged; a send as the persona arrives as it', async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));
    const persona = await AgentIdentity.generate(new VaultMemory());
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay'); bram.setTransportMode('relay');

      const opened = await anna.relays.add(url, { identity: persona, awaitReady: true });
      expect(opened.connected).toBe(true);
      expect(opened.identity).toBe(persona.pubKey);
      // the default's relays, as every caller reads them today: only the default's socket
      expect(anna.relays.list().map((r) => r.url)).toEqual([url]);
      expect(anna.relays.list({ identity: persona.pubKey }).map((r) => r.url)).toEqual([url]);
      // the persona is one of ours, and owns itself
      expect(anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey })).toBe(true);

      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'as the persona' }, { ...FAST, sendAs: persona.pubKey });
      expect(r?.delivered ?? true).not.toBe(false);
      const got = await until(() => received.find((m) => m.payload?.text === 'as the persona'));
      expect(got, 'it arrived').toBeTruthy();
      expect(got.from, 'as the persona').toBe(persona.pubKey);
      expect(got.from).not.toBe(anna.identity.pubKey);

      // and a send as the default still arrives as the default
      await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'as the default' }, FAST);
      const plain = await until(() => received.find((m) => m.payload?.text === 'as the default'));
      expect(plain.from).toBe(anna.identity.pubKey);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);

  it('a persona with no socket of its own gets a typed refusal — never a send on the default\'s socket', async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));
    const persona = await AgentIdentity.generate(new VaultMemory());
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay'); bram.setTransportMode('relay');
      anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey });

      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'must not leave' }, { ...FAST, sendAs: persona.pubKey });
      expect(r).toMatchObject({ delivered: false, held: false, reason: 'persona-no-connection', persona: persona.pubKey });
      await new Promise((res) => setTimeout(res, 600));
      expect(received.find((m) => m.payload?.text === 'must not leave'), 'nothing left on the default\'s socket').toBeUndefined();
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);
});
describe('once a persona exists, every identity of ours names its owner', () => {
  it('an owner-less registration is refused — it would silently route a persona\'s key as the default\'s', async () => {
    const anna = await agent();
    const persona = await AgentIdentity.generate(new VaultMemory());
    const circleKey = await AgentIdentity.generate(new VaultMemory());
    const other = await AgentIdentity.generate(new VaultMemory());
    try {
      // while only the default exists, the old call still works (every existing registration)
      expect(anna.registerSelfIdentity(circleKey.pubKey, circleKey)).toBe(true);
      // a persona registers itself as its own owner …
      expect(anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey })).toBe(true);
      // … and from then on an identity without an owner is refused, while one that names its owner is taken
      expect(anna.registerSelfIdentity(other.pubKey, other)).toBe(false);
      expect(anna.registerSelfIdentity(other.pubKey, other, { owner: anna.identity.pubKey })).toBe(true);
    } finally { await anna.shutdown(); }
  });

  it('relays.remove(url, { identity }) closes only that persona\'s socket; a send as it is then the typed refusal', async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const anna = await agent();
    const bram = await agent();
    const persona = await AgentIdentity.generate(new VaultMemory());
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay'); bram.setTransportMode('relay');
      await anna.relays.add(url, { identity: persona, awaitReady: true });
      anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey });
      await anna.relays.remove(url, { identity: persona.pubKey });
      expect(anna.relays.list({ identity: persona.pubKey })).toEqual([]);
      expect(anna.relays.list().map((r) => r.url), 'the default keeps its socket').toEqual([url]);
      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'x' }, { ...FAST, sendAs: persona.pubKey });
      expect(r).toMatchObject({ delivered: false, held: false, reason: 'persona-no-connection' });
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);
});
