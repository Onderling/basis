/**
 * The raw-WebSocket test client, after proof of possession on register (2026-07-31,
 * DESIGN-boundary-authentication §7 — Decision 3).
 *
 * Registration is challenge-first, so a test can no longer register `'alice'`: an address is a
 * PUBLIC KEY, and the relay verifies a signature against it. This helper is what keeps that from
 * turning every relay test into crypto plumbing:
 *
 *   • `addr('alice')` — a deterministic per-label keypair whose pubKey IS the address. Same label →
 *     same address within a run, so `to:` fields and peer-list assertions still read as names.
 *   • `openClient(url)` — the same client every suite already had (a `ws` with `.messages`), plus an
 *     automatic answer to any `challenge` for an address it holds the key for.
 *
 * The auto-answer is a CONVENIENCE, never a bypass: it signs with the real key, and it can only do
 * so for addresses `addr()` minted. A client asked to prove an address it does not hold simply does
 * not answer — which is exactly what an honest client does, and what the adversary tests want.
 *
 * Adversary tests drive the exchange by hand instead (`register` → read the `challenge` → send a
 * proof of their choosing); `proveAs` is here for the honest half of those.
 */
import { WebSocket } from 'ws';
import nacl from 'tweetnacl';
import { AgentIdentity, addressPossessionMessage, b64encode } from '@onderling/core';

/** label → { seed, pubKey } — deterministic within a run, distinct across labels. */
const identities = new Map();
/** address → sign(message) → base64 signature. Everything this helper can prove. */
const signers = new Map();

/** The keypair behind a label. Seeded from a counter + the label so tests are reproducible. */
function identityFor(label) {
  let rec = identities.get(label);
  if (!rec) {
    const seed = new Uint8Array(32);
    const bytes = new TextEncoder().encode(String(label));
    seed.set(bytes.slice(0, 32));
    seed[31] = (seed[31] + identities.size + 1) & 0xff;   // distinct even for labels sharing a prefix
    rec = { seed, pubKey: AgentIdentity.pubKeyFromSeed(seed) };
    identities.set(label, rec);
    const kp = nacl.sign.keyPair.fromSeed(seed);
    signers.set(rec.pubKey, (message) =>
      b64encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)));
  }
  return rec;
}

/**
 * Teach the auto-answer about a REAL identity (the group-proof and key-rotation suites connect as
 * an `AgentIdentity`, not as a label). Returns its address, so a call site reads as one thing.
 */
export function useIdentity(identity) {
  signers.set(identity.pubKey, (message) => b64encode(identity.sign(message)));
  return identity.pubKey;
}

/** Sign a challenge for any address this helper holds a key for; null when it holds none. */
export function proveAddress(address, nonce) {
  const sign = signers.get(address);
  return sign ? sign(addressPossessionMessage(address, nonce)) : null;
}

/** The ADDRESS for a label — a real Ed25519 public key this helper can sign for. */
export function addr(label) { return identityFor(label).pubKey; }

/**
 * Sign a challenge for `address` with `label`'s key. When the two do not match this is a FORGED
 * proof — which is what the adversary tests need, and what the relay must refuse.
 */
export function proofFor(label, address, nonce) {
  const rec = identityFor(label);
  return signers.get(rec.pubKey)(addressPossessionMessage(address, nonce));
}

/**
 * Open a relay client that records every frame in `ws.messages` and answers registration
 * challenges automatically for addresses minted by `addr()`.
 *
 * @param {string} url
 * @param {object} [opts]                 passed to `new WebSocket(url, opts)`
 * @param {boolean} [opts.autoProve=true] set false to drive the challenge by hand
 */
export function openClient(url, opts = {}) {
  const { autoProve = true, ...wsOpts } = opts;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.messages = [];
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      ws.messages.push(msg);
      if (!autoProve || msg.type !== 'challenge') return;
      const proof = proveAddress(msg.address, msg.nonce);
      if (!proof) return;                  // not ours to prove — say nothing, as a real client would
      ws.send(JSON.stringify({
        type: 'register-proof', address: msg.address, nonce: msg.nonce, proof,
      }));
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** `send(ws, frame)` — the one-liner every relay suite already had. */
export function send(ws, obj) { ws.send(JSON.stringify(obj)); }

/** Register `address` and resolve when the relay acks it (challenge answered in between). */
export async function registerAndWait(ws, address, timeoutMs = 2_000) {
  send(ws, { type: 'register', address });
  const start = Date.now();
  while (!ws.messages.some((m) => m.type === 'registered' && m.address === address)) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout registering ${address}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
