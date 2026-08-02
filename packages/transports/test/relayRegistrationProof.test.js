/**
 * The client half of proof of possession — including the part that audits the RELAY.
 *
 * `plans/DESIGN-boundary-authentication.md` §7 has two halves, and the second is the unusual one:
 *
 *   1. you may register an address only if you can prove you hold its key, AND
 *   2. **the client refuses a relay that does not demand that proof.**
 *
 * Half 2 exists because a relay that never asks is, by construction, a relay where anyone may claim
 * anyone's address — that is a property of the relay, not of how well we behave, so volunteering a
 * signature to it buys us nothing. A compliant relay can never exercise this path, which is why the
 * test needs a deliberately lax stub: the stub IS the point. And the no-fallback half is the one
 * that rots first, so it is asserted directly — a partial mode would be exactly the invisible
 * downgrade the rule removes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  AgentIdentity, deriveCircleAddress, circleAddressSigner,
  addressPossessionMessage, verifyAddressPossession, newAddressChallenge,
} from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

/** A vault that keeps nothing — this suite needs a signing key, not persistence. */
const throwawayVault = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
};

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 2_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * A stand-in relay. `demandProof: false` is yesterday's relay — it acks a registration on the claim
 * alone. `demandProof: true` is the real protocol, verified for real.
 */
function stubRelay({ demandProof }) {
  const wss = new WebSocketServer({ port: 0 });
  const state = { registered: [], challenged: [] };
  wss.on('connection', (ws) => {
    const open = new Map();                    // nonce → address
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        if (!demandProof) {                    // ← the relay this rule exists to refuse
          state.registered.push(msg.address);
          ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
          return;
        }
        const nonce = newAddressChallenge();
        open.set(nonce, msg.address);
        state.challenged.push(msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce);
        open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession(msg)) {
          ws.send(JSON.stringify({ type: 'error', message: 'PROOF_INVALID' }));
          return;
        }
        state.registered.push(msg.address);
        ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
      }
    });
  });
  state.url = `ws://127.0.0.1:${wss.address().port}`;
  state.stop = () => new Promise((r) => wss.close(r));
  return state;
}

let relay; let transport;
afterEach(async () => {
  try { await transport?.disconnect(); } catch { /* */ }
  await relay?.stop();
  relay = null; transport = null;
});

describe('the client proves the address it registers', () => {
  it('answers the challenge with a signature the relay verifies, and only then is registered', async () => {
    relay = stubRelay({ demandProof: true });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });

    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect();
    await connected;

    expect(relay.challenged).toEqual([identity.pubKey]);
    expect(relay.registered).toEqual([identity.pubKey]);
  });

  it('proves each per-circle alias with ITS OWN key — one signature per address', async () => {
    // A device holds a different key per circle, so holding the primary proves nothing about an
    // alias. `addAddress(address, { sign })` is the seam that carries the alias's own signer; the
    // caller supplies it because only the caller knows which circle an address belongs to.
    relay = stubRelay({ demandProof: true });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const profileSeed = new Uint8Array(randomBytes(32));
    transport = new RelayTransport({ relayUrl: relay.url, identity });

    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect();
    await connected;

    const circles = ['circle-x', 'circle-y'];
    for (const c of circles) {
      const res = await transport.addAddress(
        deriveCircleAddress(profileSeed, c), { sign: circleAddressSigner(profileSeed, c) },
      );
      expect(res.ok).toBe(true);
    }
    await waitFor(() => relay.registered.length === 3);
    expect(relay.registered).toEqual([
      identity.pubKey, ...circles.map((c) => deriveCircleAddress(profileSeed, c)),
    ]);
    // Every address was challenged separately — one proof standing in for another would be the
    // whole point missed.
    expect(relay.challenged).toEqual(relay.registered);
  });

  it('an alias with no signer is refused HERE, with a reason — not left half-registered', async () => {
    relay = stubRelay({ demandProof: true });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const profileSeed = new Uint8Array(randomBytes(32));
    transport = new RelayTransport({ relayUrl: relay.url, identity });

    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect();
    await connected;
    transport.on('error', () => { /* reported; the assertion is the result below */ });

    const res = await transport.addAddress(deriveCircleAddress(profileSeed, 'circle-x'));  // no sign
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signer/i);
    await settle();
    expect(relay.registered).toEqual([identity.pubKey]);
  });

  it('a signature over the wrong thing is refused by the relay, and nothing is registered', async () => {
    relay = stubRelay({ demandProof: true });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const profileSeed = new Uint8Array(randomBytes(32));
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect();
    await connected;

    const errors = [];
    transport.on('error', (e) => errors.push(e));
    // A signer for the WRONG circle: the caller wired the alias up incorrectly, which is a plausible
    // bug and must fail loudly rather than register something unproved.
    await transport.addAddress(
      deriveCircleAddress(profileSeed, 'circle-x'), { sign: circleAddressSigner(profileSeed, 'circle-y') },
    );
    await waitFor(() => errors.some((e) => /PROOF_INVALID/.test(e.message)));
    expect(relay.registered).toEqual([identity.pubKey]);
  });
});

describe('the client audits the relay', () => {
  it('REFUSES a relay that acks a registration without ever challenging — and says why', async () => {
    relay = stubRelay({ demandProof: false });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });

    const errors = [];
    transport.on('error', (e) => errors.push(e));
    let connectedFired = false;
    transport.on('connect', () => { connectedFired = true; });

    await transport.connect();
    await waitFor(() => errors.length > 0);

    // Reported by name, not swallowed: an operator has to be able to read what went wrong.
    expect(errors[0].message).toMatch(/without demanding proof/i);
    expect(errors[0].message).toContain(relay.url);
    // …and it is a connection FAILURE: we never report ourselves connected.
    expect(connectedFired, 'the transport reported itself connected to an unproven relay').toBe(false);
    expect(transport.connected).toBe(false);
  });

  it('THERE IS NO FALLBACK: it does not retry, and it does not send anything afterwards', async () => {
    // The half that rots first. A "just this once" reconnect would restore exactly the property the
    // rule removes — silently, because the client would look connected.
    relay = stubRelay({ demandProof: false });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    transport.on('error', () => { /* expected, repeatedly */ });

    await transport.connect();
    await settle(400);                       // longer than the transport's first reconnect backoff

    // The relay did register the address once (it is a lax relay — that is what it does); what
    // matters is that the client never came back to do it again.
    expect(relay.registered.length).toBe(1);
    expect(transport.connected).toBe(false);

    // An explicit reconnect is refused too — this is a verdict about the relay, not a transient.
    await transport.connect();
    await settle(200);
    expect(relay.registered.length).toBe(1);
    expect(transport.connected).toBe(false);

    // …and no traffic goes there: `_put` fails rather than sending to an unproven relay.
    await expect(transport._put('somebody', { _p: 'OW', payload: {} })).rejects.toThrow();
  });

  it('the audit is per-socket: a proof on the last connection does not excuse this one', async () => {
    // A relay that challenges once and then stops — a downgrade after the fact, which a client that
    // remembered "this relay is fine" would sail straight past.
    let seenRegisters = 0;
    const wss = new WebSocketServer({ port: 0 });
    const registered = [];
    wss.on('connection', (ws) => {
      const open = new Map();
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'register') {
          seenRegisters += 1;
          if (seenRegisters > 1) {                       // …and from now on, no challenge at all
            registered.push(msg.address);
            ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
            return;
          }
          const nonce = newAddressChallenge();
          open.set(nonce, msg.address);
          ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
          return;
        }
        if (msg.type === 'register-proof' && verifyAddressPossession(msg) && open.delete(msg.nonce)) {
          registered.push(msg.address);
          ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
        }
      });
    });
    relay = { stop: () => new Promise((r) => wss.close(r)) };
    const url = `ws://127.0.0.1:${wss.address().port}`;

    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const profileSeed = new Uint8Array(randomBytes(32));
    transport = new RelayTransport({ relayUrl: url, identity });
    const errors = [];
    transport.on('error', (e) => errors.push(e));
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect();
    await connected;                                     // the first registration was honest

    // The second address gets no challenge — and must be refused rather than accepted on trust.
    await transport.addAddress(
      deriveCircleAddress(profileSeed, 'circle-x'), { sign: circleAddressSigner(profileSeed, 'circle-x') },
    );
    await waitFor(() => errors.some((e) => /without demanding proof/i.test(e.message)));
    expect(transport.connected).toBe(false);
  });
});

describe('what the client signs', () => {
  it('is built by the transport out of the relay\'s nonce — never handed over by the relay', async () => {
    // Registration must not be a signing oracle. The relay contributes randomness and nothing else:
    // whatever it sends, the message signed is `addressPossessionMessage(address, nonce)`.
    const wss = new WebSocketServer({ port: 0 });
    const signedOver = [];
    const evilMessage = 'ik draag mijn huis over aan de relay-beheerder';
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'register') {
          // A hostile relay tries to choose the text, not just the nonce.
          ws.send(JSON.stringify({
            type: 'challenge', address: msg.address, nonce: 'n-1', message: evilMessage,
          }));
        }
        if (msg.type === 'register-proof') signedOver.push(msg);
      });
    });
    relay = { stop: () => new Promise((r) => wss.close(r)) };
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: `ws://127.0.0.1:${wss.address().port}`, identity });
    transport.on('error', () => { /* the relay never acks; irrelevant here */ });
    await transport.connect();
    await waitFor(() => signedOver.length > 0);

    const proof = signedOver[0];
    expect(proof.nonce).toBe('n-1');
    // The signature verifies against the canonical message and nothing else.
    expect(verifyAddressPossession({ address: identity.pubKey, nonce: 'n-1', proof: proof.proof })).toBe(true);
    expect(AgentIdentity.verify(evilMessage, proof.proof, identity.pubKey)).toBe(false);
    expect(addressPossessionMessage(identity.pubKey, 'n-1')).toContain(identity.pubKey);
  });
});
