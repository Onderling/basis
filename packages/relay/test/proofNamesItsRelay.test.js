/**
 * A PROOF THAT A DEVICE HOLDS AN ADDRESS NAMES THE RELAY IT WAS GIVEN TO (the independent read, 2026-11-20).
 *
 * The signed message used to be the scheme, the address and a nonce. A hostile relay could fetch a challenge for a
 * person's address from an honest relay, hand it to the person's device as its own, and register that address at the
 * honest relay with the answer: taking the person's address there. Now the device signs the name of the relay it
 * DIALLED, and a relay accepts a proof only for one of its own names (the Host the connection dialled, or a configured
 * name): the hostile relay's answer names the hostile relay and is refused.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, signAddressPossession, isPrivateRelayName, relayOwnNames } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '../src/server.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
let relay; const sockets = [];
afterEach(async () => { for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } } await relay?.stop?.(); relay = null; });

/** Register `identity`'s address on the relay, answering the challenge for the relay named `signFor`. */
async function registerNaming(identity, signFor, { send = signFor, host } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}`, host ? { headers: { Host: host } } : undefined);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  return new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'challenge') {
        ws.send(JSON.stringify({ type: 'register-proof', address: identity.pubKey, nonce: msg.nonce, proof: signAddressPossession(identity, identity.pubKey, msg.nonce, signFor), relay: send }));
      } else if (msg.type === 'registered') resolve('registered');
      else if (msg.type === 'error') resolve(msg.message);
    });
    ws.send(JSON.stringify({ type: 'register', address: identity.pubKey }));
  });
}

describe('the proof of an address names the relay it was answered for', () => {
  it('a proof naming THIS relay registers the address', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, `127.0.0.1:${relay.port}`)).toBe('registered');
  });

  it('a proof answered for ANOTHER relay is refused, even with a valid signature', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    // the device dialled the hostile relay and signed its name; the hostile relay passes the answer on
    expect(await registerNaming(id, 'hostile.example:443')).toBe('PROOF_INVALID');
  });

  it('a proof that claims this relay but was signed for another is refused (the name is inside the signature)', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'hostile.example:443', { send: `127.0.0.1:${relay.port}` })).toBe('PROOF_INVALID');
  });

  it('a configured name (a relay behind a proxy that rewrites Host) is its own too', async () => {
    relay = await startRelay({ port: 0, relayNames: ['relay.example.org'] });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'relay.example.org')).toBe('registered');
  });

  it('THE CALLER\'S Host is never a source of a public name: a hostile relay dialling under its own Host is refused', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    // the device dialled hostile.example and signed that name; the hostile relay dials the honest one AS hostile.example
    expect(await registerNaming(id, 'hostile.example', { host: 'hostile.example' })).toBe('PROOF_INVALID');
  });

  it('with configured names, a Host outside them is refused too', async () => {
    relay = await startRelay({ port: 0, relayNames: ['relay.example.org'] });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'hostile.example', { host: 'hostile.example' })).toBe('PROOF_INVALID');
    expect(await registerNaming(id, 'relay.example.org', { host: 'relay.example.org' })).toBe('registered');
  });

  it('a private name is taken from Host with no setting (a home-network box, the dev relay)', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, '192.168.1.20:8787', { host: '192.168.1.20:8787' })).toBe('registered');
    // but only the one this connection came in under
    expect(await registerNaming(id, '192.168.1.21:8787', { host: '192.168.1.20:8787' })).toBe('PROOF_INVALID');
  });

  it('a host name is case-insensitive on both sides', async () => {
    relay = await startRelay({ port: 0, relayNames: ['Relay.Example.org'] });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'relay.EXAMPLE.org')).toBe('registered');
  });
});

describe('which names cannot be a relay on the public internet', () => {
  it('localhost, loopback, private, link-local and shared-range literals, with any port', () => {
    for (const n of ['localhost', 'localhost:8787', 'relay:8787', '127.0.0.1:1', '10.0.0.5', '172.16.0.1:443', '172.31.255.255', '192.168.1.1:8787',
      '169.254.1.1', '100.73.134.19:8787', '[::1]:8787', '::1', '[fd12::1]:8787', '[fe80::1]', '[::ffff:192.168.1.2]:1']) {
      expect(isPrivateRelayName(n), n).toBe(true);
    }
    for (const n of ['relay.example.org', 'relay.example.org:443', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.1.1',
      '[2001:db8::1]:443', '127.0.0.1.example.org', 'localhost.example.org', '', '999.1.1.1']) {
      expect(isPrivateRelayName(n), n).toBe(false);
    }
  });

  it('relayOwnNames: configured names only when there are any; else a private name only as the Host it came in under', () => {
    const own = relayOwnNames({ names: ['Relay.Example.org'] });
    expect(own('relay.example.org', 'anything')).toBe(true);
    expect(own('hostile.example', 'hostile.example')).toBe(false);
    expect(own('localhost'), 'configured = those names only').toBe(false);
    const none = relayOwnNames();
    expect(none('hostile.example', 'hostile.example')).toBe(false);
    expect(none('localhost')).toBe(true);
    expect(none('10.0.0.2:1', '10.0.0.2:1')).toBe(true);
    expect(none('10.0.0.2:1', '10.0.0.3:1')).toBe(false);
    expect(none(undefined, 'localhost')).toBe(false);
  });
});

describe('the attack end to end: a hostile relay passes an honest relay\'s challenge to a real device', () => {
  let hostile;
  afterEach(async () => { if (hostile) { for (const c of hostile.clients) c.terminate(); await new Promise((r) => hostile.close(() => r())); hostile = null; } });

  for (const [label, relayOpts, ownHost] of [
    ['dialling with the honest relay\'s own Host', {}, false],
    // the review's case: the Host header is the caller's, so the hostile relay writes the name the device signed;
    // the honest relay is configured as a deploy is (RELAY_NAMES), so the Host is never a source of a name
    ['dialling under the hostile relay\'s OWN Host', { relayNames: ['relay.example.org'] }, true],
  ]) it(`the device answers for the relay it dialled, so the honest relay refuses the hostile one its address (${label})`, async () => {
    relay = await startRelay({ port: 0, host: '127.0.0.1', ...relayOpts });
    // the hostile relay: every frame both ways is passed on to the honest relay, which it dials as itself
    hostile = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => hostile.once('listening', r));
    const upstreamSaid = [];
    const upstreamHost = ownHost ? `127.0.0.1:${hostile.address().port}` : null;
    hostile.on('connection', (down) => {
      // it dials the honest relay under ITS OWN name (the Host header is the caller's to write)
      const up = new WebSocket(`ws://127.0.0.1:${relay.port}`, upstreamHost ? { headers: { Host: upstreamHost } } : undefined);
      const pending = [];
      up.on('open', () => { while (pending.length) up.send(pending.shift()); });
      down.on('message', (d) => { const t = String(d); if (up.readyState === 1) up.send(t); else pending.push(t); });
      up.on('message', (d) => { upstreamSaid.push(JSON.parse(String(d))); if (down.readyState === 1) down.send(String(d)); });
      down.on('close', () => up.close()); up.on('close', () => down.close());
    });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const tx = new RelayTransport({ relayUrl: `ws://127.0.0.1:${hostile.address().port}`, identity });
    tx.on('error', () => { /* the refusal surfaces here too */ });
    await tx.connect().catch(() => {});
    const t0 = Date.now();
    while (!upstreamSaid.some((m) => m.type === 'error' || m.type === 'registered') && Date.now() - t0 < 4_000) await new Promise((r) => setTimeout(r, 20));
    // before the proof named its relay, this was `registered`: the honest relay handed the address to the hostile one
    expect(upstreamSaid.find((m) => m.type === 'registered')).toBeUndefined();
    expect(upstreamSaid.find((m) => m.type === 'error')).toMatchObject({ message: 'PROOF_INVALID', address: identity.pubKey });
    await tx.disconnect?.().catch?.(() => {});
  }, 15_000);
});
