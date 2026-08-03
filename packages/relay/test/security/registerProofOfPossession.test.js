/**
 * J-B10 / you may register an address only if you hold its key.
 *
 * THE BREACH THIS CLOSES, measured on hardware 2026-07-30 and reproduced below: a fresh socket sent
 * `{type:'register', address}` naming another member's per-circle address, the relay believed it,
 * `clients.set` overwrote the rightful owner's routing entry, and the victim's next message went to
 * the claimant while the owner got nothing. Content stayed sealed; delivery did not. That is finding
 * 2/4 of `plans/DRAFT-2026-07-30-threemember-and-relay-walks.md` and go-live checklist item 7, and it
 * could not be closed by configuration — open mode was not the cause, an unauthenticated `register`
 * was.
 *
 * The fix is one signature (`plans/DESIGN-boundary-authentication.md` §7): an address IS a public key
 * (`deriveCircleAddress` → `AgentIdentity.pubKeyFromSeed`), so possession is a nonce, a signature and
 * a verification against the address itself. What that buys is only as good as four things, and each
 * has a test here because each is a way the whole thing could quietly become vacuous:
 *
 *   1. a genuine holder still gets in                   — or we have shipped an outage, not a fix;
 *   2. a claimant who does not hold the key does NOT    — the breach itself;
 *   3. a REPLAYED proof does not                        — the reason the nonce exists at all, and the
 *                                                         assertion most likely to be dropped as
 *                                                         "extra" by someone tidying up;
 *   4. a device still registers its N per-circle addresses — a check that refuses everything would
 *                                                         pass 2 and 3 and take G13 down with it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  AgentIdentity, deriveCircleAddress, circleAddressSigner, addressPossessionMessage, b64encode,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { randomBytes } from 'node:crypto';
import { startRelay } from '../../src/server.js';

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 2_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * A raw client that does NOTHING automatically. Every frame is driven by the test, because the whole
 * subject here is what happens when a client answers wrongly, late, twice, or not at all — and a
 * helpful client would hide exactly that.
 */
function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (raw) => { try { ws.messages.push(JSON.parse(raw)); } catch { /* not ours */ } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));

/** The challenge the relay issued for `address` on this socket. */
async function challengeFor(ws, address) {
  await waitFor(() => ws.messages.some((m) => m.type === 'challenge' && m.address === address));
  return ws.messages.find((m) => m.type === 'challenge' && m.address === address).nonce;
}

/** Anna: a profile seed and the real per-circle addresses derived from it. */
const ANNA_SEED = new Uint8Array(randomBytes(32));
const annaAddress = (circleId) => deriveCircleAddress(ANNA_SEED, circleId);
const annaSign = (circleId, address, nonce) =>
  circleAddressSigner(ANNA_SEED, circleId)(addressPossessionMessage(address, nonce));

describe('proof of possession on register', () => {
  let relay; let url;

  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  afterEach(async () => { await relay.stop(); });

  // ── 1. The holder gets in ───────────────────────────────────────────────────────────────────────

  it('a genuine holder registers, and receives at the address it proved', async () => {
    const anna = await openClient(url);
    const address = annaAddress('circle-x');
    send(anna, { type: 'register', address });

    // The relay ASKS first — it never registers on the strength of the claim.
    const nonce = await challengeFor(anna, address);
    expect(anna.messages.some((m) => m.type === 'registered')).toBe(false);

    send(anna, { type: 'register-proof', address, nonce, proof: annaSign('circle-x', address, nonce) });
    await waitFor(() => anna.messages.some((m) => m.type === 'registered' && m.address === address));

    // And the registration is real: traffic routes to it.
    const bram = await openClient(url);
    const bramId = await AgentIdentity.generate(new VaultMemory());
    send(bram, { type: 'register', address: bramId.pubKey });
    const bramNonce = await challengeFor(bram, bramId.pubKey);
    send(bram, {
      type: 'register-proof', address: bramId.pubKey, nonce: bramNonce,
      proof: b64encode(bramId.sign(addressPossessionMessage(bramId.pubKey, bramNonce))),
    });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));

    send(bram, { type: 'send', to: address, envelope: { _p: 'OW', _from: bramId.pubKey, payload: { text: 'hoi' } } });
    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    anna.close(); bram.close();
  });

  // ── 2. The claimant does not ────────────────────────────────────────────────────────────────────

  it('THE BREACH: a claimant who does not hold the key is refused, and never takes over the route', async () => {
    // Anna is registered and reachable.
    const address = annaAddress('circle-x');
    const anna = await openClient(url);
    send(anna, { type: 'register', address });
    const annaNonce = await challengeFor(anna, address);
    send(anna, { type: 'register-proof', address, nonce: annaNonce, proof: annaSign('circle-x', address, annaNonce) });
    await waitFor(() => anna.messages.some((m) => m.type === 'registered'));

    // An impostor claims her address on a fresh socket — the 2026-07-30 walk, exactly.
    const impostor = await openClient(url);
    const impostorId = await AgentIdentity.generate(new VaultMemory());
    send(impostor, { type: 'register', address });
    const stolenNonce = await challengeFor(impostor, address);

    // It can sign — with its own key, which is the only one it has. Signed by the wrong key, over
    // the right message: the closest an attacker can get without the private key behind the address.
    send(impostor, {
      type: 'register-proof', address, nonce: stolenNonce,
      proof: b64encode(impostorId.sign(addressPossessionMessage(address, stolenNonce))),
    });
    await waitFor(() => impostor.messages.some((m) => m.type === 'error' && m.message === 'PROOF_INVALID'));
    expect(impostor.messages.some((m) => m.type === 'registered')).toBe(false);

    // …and the route is untouched: the next message to Anna reaches ANNA. Before this change it
    // reached the impostor and Anna got nothing, silently.
    const bramId = await AgentIdentity.generate(new VaultMemory());
    const bram = await openClient(url);
    send(bram, { type: 'register', address: bramId.pubKey });
    const bramNonce = await challengeFor(bram, bramId.pubKey);
    send(bram, {
      type: 'register-proof', address: bramId.pubKey, nonce: bramNonce,
      proof: b64encode(bramId.sign(addressPossessionMessage(bramId.pubKey, bramNonce))),
    });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    send(bram, { type: 'send', to: address, envelope: { _p: 'OW', _from: bramId.pubKey, payload: { text: 'voor anna' } } });

    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    await settle();
    expect(impostor.messages.filter((m) => m.type === 'message'), 'the impostor received Anna\'s traffic')
      .toHaveLength(0);
    anna.close(); impostor.close(); bram.close();
  });

  it('an empty, malformed or missing proof is refused too — deny by default', async () => {
    const address = annaAddress('circle-x');
    for (const bad of [undefined, '', 'not-base64!!', b64encode(new Uint8Array(64))]) {
      const ws = await openClient(url);
      send(ws, { type: 'register', address });
      const nonce = await challengeFor(ws, address);
      send(ws, { type: 'register-proof', address, nonce, proof: bad });
      await waitFor(() => ws.messages.some((m) => m.type === 'error'));
      expect(ws.messages.find((m) => m.type === 'error').message).toBe('PROOF_INVALID');
      expect(ws.messages.some((m) => m.type === 'registered')).toBe(false);
      ws.close();
    }
  });

  it('answering a nonce the relay never issued is refused (a proof from somewhere else)', async () => {
    const address = annaAddress('circle-x');
    const ws = await openClient(url);
    send(ws, { type: 'register', address });
    await challengeFor(ws, address);

    // A perfectly valid signature — over a nonce this relay did not choose. That is the shape of a
    // proof minted elsewhere, or by the client itself, and it must buy nothing.
    const ownNonce = b64encode(new Uint8Array(randomBytes(32)));
    send(ws, {
      type: 'register-proof', address, nonce: ownNonce, proof: annaSign('circle-x', address, ownNonce),
    });
    await waitFor(() => ws.messages.some((m) => m.type === 'error' && m.message === 'NO_CHALLENGE'));
    expect(ws.messages.some((m) => m.type === 'registered')).toBe(false);
    ws.close();
  });

  // ── 3. The replay ───────────────────────────────────────────────────────────────────────────────

  it('THE NONCE DOING ITS JOB: a captured proof cannot be replayed on another socket', async () => {
    // The reason this is not `circleLink.js` (which signs a static message on purpose). Anna
    // registers honestly; somebody who saw the exchange — the relay operator, anyone with the log —
    // replays her exact `register-proof` frame on their own connection.
    const address = annaAddress('circle-x');
    const anna = await openClient(url);
    send(anna, { type: 'register', address });
    const nonce = await challengeFor(anna, address);
    const capturedProof = annaSign('circle-x', address, nonce);
    send(anna, { type: 'register-proof', address, nonce, proof: capturedProof });
    await waitFor(() => anna.messages.some((m) => m.type === 'registered'));

    const replayer = await openClient(url);
    // Replayed verbatim, with no register first — the nonce is not this socket's to answer.
    send(replayer, { type: 'register-proof', address, nonce, proof: capturedProof });
    await waitFor(() => replayer.messages.some((m) => m.type === 'error' && m.message === 'NO_CHALLENGE'));

    // …and it does not help to ask for a challenge first: the proof is bound to the OLD nonce, and
    // the new challenge is a different one.
    send(replayer, { type: 'register', address });
    await challengeFor(replayer, address);
    send(replayer, { type: 'register-proof', address, nonce, proof: capturedProof });
    await waitFor(() => replayer.messages.filter((m) => m.type === 'error').length >= 2);
    expect(replayer.messages.some((m) => m.type === 'registered')).toBe(false);
    anna.close(); replayer.close();
  });

  it('…nor replayed on the SAME socket: a nonce is spent the moment it is answered', async () => {
    const address = annaAddress('circle-x');
    const ws = await openClient(url);
    send(ws, { type: 'register', address });
    const nonce = await challengeFor(ws, address);
    const proof = annaSign('circle-x', address, nonce);

    send(ws, { type: 'register-proof', address, nonce, proof });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    send(ws, { type: 'register-proof', address, nonce, proof });        // the same frame again

    await waitFor(() => ws.messages.some((m) => m.type === 'error' && m.message === 'NO_CHALLENGE'));
    expect(ws.messages.filter((m) => m.type === 'registered')).toHaveLength(1);
    ws.close();
  });

  it('a proof lifted onto a DIFFERENT address is refused — the message binds both', async () => {
    const mine = annaAddress('circle-x');
    const theirs = annaAddress('circle-y');
    const ws = await openClient(url);
    send(ws, { type: 'register', address: mine });
    const nonce = await challengeFor(ws, mine);

    // The signature is real and the nonce is live — but it was issued for `mine`, so presenting it
    // for `theirs` must not register `theirs`.
    send(ws, { type: 'register-proof', address: theirs, nonce, proof: annaSign('circle-x', mine, nonce) });
    await waitFor(() => ws.messages.some((m) => m.type === 'error' && m.message === 'NO_CHALLENGE'));
    expect(ws.messages.some((m) => m.type === 'registered')).toBe(false);
    ws.close();
  });

  // ── 4. Several circles still work ───────────────────────────────────────────────────────────────

  it('a device still registers ALL its per-circle addresses on one socket, each proved separately', async () => {
    // The half that a refuse-everything check would pass. Each address is a DIFFERENT key, so each
    // needs its own challenge and its own signature — proving one says nothing about the others.
    const circles = ['circle-x', 'circle-y', 'circle-z'];
    const anna = await openClient(url);
    for (const c of circles) send(anna, { type: 'register', address: annaAddress(c) });

    const nonces = {};
    for (const c of circles) nonces[c] = await challengeFor(anna, annaAddress(c));
    // Three DISTINCT challenges — one nonce reused across addresses would be a replay window.
    expect(new Set(Object.values(nonces)).size).toBe(3);

    for (const c of circles) {
      send(anna, {
        type: 'register-proof', address: annaAddress(c), nonce: nonces[c],
        proof: annaSign(c, annaAddress(c), nonces[c]),
      });
    }
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 3);
    expect(anna.messages.some((m) => m.type === 'error')).toBe(false);

    // Every one of them routes.
    const bramId = await AgentIdentity.generate(new VaultMemory());
    const bram = await openClient(url);
    send(bram, { type: 'register', address: bramId.pubKey });
    const bn = await challengeFor(bram, bramId.pubKey);
    send(bram, {
      type: 'register-proof', address: bramId.pubKey, nonce: bn,
      proof: b64encode(bramId.sign(addressPossessionMessage(bramId.pubKey, bn))),
    });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    for (const c of circles) {
      send(bram, { type: 'send', to: annaAddress(c), envelope: { _p: 'OW', _from: bramId.pubKey, payload: { c } } });
    }
    await waitFor(() => anna.messages.filter((m) => m.type === 'message').length === 3);
    anna.close(); bram.close();
  });

  it('one socket proving address A does not register address B — possession is per address', async () => {
    const a = annaAddress('circle-x');
    const b = annaAddress('circle-y');
    const ws = await openClient(url);
    send(ws, { type: 'register', address: a });
    const nonce = await challengeFor(ws, a);
    send(ws, { type: 'register-proof', address: a, nonce, proof: annaSign('circle-x', a, nonce) });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered' && m.address === a));
    await settle();

    // B was never asked for and never proved, so nothing may route to it. Checked from outside, via
    // the peer list the relay broadcasts — the same view any connected client has.
    send(ws, { type: 'peer-list' });
    await waitFor(() => ws.messages.some((m) => m.type === 'peer-list'));
    const peers = ws.messages.filter((m) => m.type === 'peer-list').at(-1).peers;
    expect(peers).toContain(a);
    expect(peers).not.toContain(b);
    ws.close();
  });
});
