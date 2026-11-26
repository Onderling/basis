// The relay socket is TLS outside local development: a RelayTransport refuses a plain ws address to a public host when
// it is made, so no client (web, phone, box, companion) can dial one, whatever screen or invite handed it the address.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { RelayTransport } from '../src/index.js';

const throwawayVault = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }; };
const newIdentity = () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());

describe('RelayTransport: wss required outside local development', () => {
  it('refuses a plain ws address to a public host, and says why in words', async () => {
    const identity = await newIdentity();
    let err = null;
    try { new RelayTransport({ relayUrl: 'ws://relay.test:8787', identity }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.code).toBe('RELAY_PLAIN_WS');
    expect(err.message).toMatch(/wss:\/\//);
    expect(err.message).toMatch(/relay\.test/);
  });

  it('takes wss anywhere and plain ws on the own machine or network', async () => {
    const identity = await newIdentity();
    for (const relayUrl of ['wss://relay.test', 'ws://127.0.0.1:8787', 'ws://192.168.2.20:8787', 'ws://relay:8787']) {
      expect(new RelayTransport({ relayUrl, identity }).url, relayUrl).toBe(relayUrl);
    }
  });
});
