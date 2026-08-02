/**
 * A mute must not destroy key material it did not create. (Ledger L4, Frits 2026-08-02.)
 *
 * `hello.js` refuses a peer the gate rejects and undoes the registration that happened while decrypting
 * their HI. That was correct while a handshake was the ONLY way to hold someone's key. It stopped being
 * correct on 2026-07-30, when keys began arriving from the roster, proved at join — and Decision 1
 * narrowed first-contact registration further, so the odds of the key having come from somewhere else
 * went up again.
 *
 * The distinction this pins: a mute is a **social** act ("I do not want to hear from you"). Deleting
 * cryptographic material someone legitimately established at join is a **larger** act with consequences
 * nobody asked for — their past messages stop verifying, and an unmute needs a fresh handshake before it
 * means anything.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityLayer } from '../../src/security/SecurityLayer.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { mkEnvelope, P } from '../../src/Envelope.js';

const vault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const newIdentity = () => AgentIdentity.generate(vault());

let us, usId, themId;
beforeEach(async () => {
  usId = await newIdentity();
  themId = await newIdentity();
  us = new SecurityLayer({ identity: usId });
});

/** A signed HI from `fromId`, as the wire would carry it. */
async function hi(fromId) {
  const layer = new SecurityLayer({ identity: fromId });
  return layer.encrypt(mkEnvelope(P.HI, fromId.pubKey, usId.pubKey, { pubKey: fromId.pubKey }));
}

describe('the refusal undoes its own side effect', () => {
  it('DOES unregister a key that this very envelope established', async () => {
    const env = await hi(themId);
    us.decryptAndVerify(env);
    expect(us.getPeerKey(themId.pubKey)).toBeTruthy();

    expect(us.unregisterPeerIfEstablishedBy(themId.pubKey, env._id)).toBe(true);
    expect(us.getPeerKey(themId.pubKey)).toBeFalsy();
  });

  it('is idempotent — a second refusal of the same envelope removes nothing more', async () => {
    const env = await hi(themId);
    us.decryptAndVerify(env);
    expect(us.unregisterPeerIfEstablishedBy(themId.pubKey, env._id)).toBe(true);
    expect(us.unregisterPeerIfEstablishedBy(themId.pubKey, env._id)).toBe(false);
  });
});

describe('the refusal does NOT touch anything else — this is the fix', () => {
  it('LEAVES a roster-backed binding intact when the handshake did not create it', async () => {
    // the shape that broke: we already know them (proved at join), they say hello, we mute them
    expect(us.learnPeerKey(themId.pubKey, themId.pubKey)).toBe('established');
    const env = await hi(themId);
    us.decryptAndVerify(env);          // registers nothing new — we already held the key

    expect(us.unregisterPeerIfEstablishedBy(themId.pubKey, env._id)).toBe(false);
    expect(us.getPeerKey(themId.pubKey)).toBe(themId.pubKey);
  });

  it('cannot be used to delete a THIRD party\'s key by naming their address', async () => {
    const other = await newIdentity();
    us.learnPeerKey(other.pubKey, other.pubKey);
    const env = await hi(themId);
    us.decryptAndVerify(env);

    // an envelope from them must not be able to evict someone else
    expect(us.unregisterPeerIfEstablishedBy(other.pubKey, env._id)).toBe(false);
    expect(us.getPeerKey(other.pubKey)).toBe(other.pubKey);
  });

  it('cannot be used with a made-up envelope id', async () => {
    us.learnPeerKey(themId.pubKey, themId.pubKey);
    expect(us.unregisterPeerIfEstablishedBy(themId.pubKey, 'no-such-envelope')).toBe(false);
    expect(us.getPeerKey(themId.pubKey)).toBe(themId.pubKey);
  });
});

describe('the bookkeeping stays bounded', () => {
  it('does not grow without limit as handshakes arrive', async () => {
    // 300 first contacts, cap is 256 — the oldest entries fall out and simply stop being undoable,
    // which is the right failure: by then the gate decision was made long ago.
    for (let i = 0; i < 300; i++) {
      const who = await newIdentity();
      us.decryptAndVerify(await hi(who));
    }
    // the most recent is still undoable
    const last = await newIdentity();
    const env = await hi(last);
    us.decryptAndVerify(env);
    expect(us.unregisterPeerIfEstablishedBy(last.pubKey, env._id)).toBe(true);
  }, 30_000);
});
