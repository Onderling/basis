/**
 * GUARD — an inbound HI may ESTABLISH a key binding, never REPLACE one.
 *
 * This file was written on 2026-07-30 as evidence of a breach and was flipped on 2026-07-31 when the
 * breach was closed. The attack narrative is kept because it is the reason the guard exists — delete the
 * guard and this is what comes back.
 *
 * ── The attack these tests now prove impossible ──────────────────────────────────────────────────────
 * `SecurityLayer.decryptAndVerify` step 3 used to do, unconditionally:
 *
 *     if (env._p === P.HI && env.payload?.pubKey) this.#peers.set(env._from, env.payload.pubKey);
 *
 * No `has()` check, no comparison with the incumbent. So a binding established from a circle roster
 * (`bindCircleAddressKeys`, where `{pubKey, circleAddress}` were captured together at join and the address
 * was PROVED via `signCircleAddress`) was replaced by whatever an inbound HI asserted — and because the
 * overwrite happened BEFORE the signature check, the very envelope performing the substitution then
 * verified against the key it had just installed.
 *
 * `_from` is authenticated by nothing: every adapter parses the wire payload and calls `_receive(envelope)`
 * with the declared `_from` (e.g. react-native/src/transport/NknTransport.js:409-417 discards nkn's own
 * authenticated `msg.src`). So any circle co-member — rosters carry everyone's `circleAddress` — could send
 * ONE hello and thereafter have their ordinary chat reach the victim's UI as somebody else.
 *
 * ── The rule now enforced ────────────────────────────────────────────────────────────────────────────
 * Establish if absent · no-op if identical · REFUSE if different — with no exception for an inline rotation
 * proof (2026-10-29: the push rotation is gone; a person's key moves through the root-gated ceremony).
 *
 * ── What Decision 1 changed here (2026-07-31) ────────────────────────────────────────────────────────
 * The rule is the same and the outcomes are the same; the DIAGNOSIS changed, and it changed to a more
 * accurate one. `_from` no longer chooses which key is verified — the envelope carries the key that
 * signed it, so Mallory's forgery now VERIFIES (it really is her signature, over her own key) and is
 * refused one step later as `SENDER_NOT_BOUND`: validly signed, but not by the key we hold for the
 * address it claims. Calling that `BAD_SIG` was always slightly false — nothing was ever wrong with the
 * signature — and the falseness was load-bearing, because it made "whose key are we even checking?" an
 * invisible question. These tests assert the outcome (refused · binding intact · payload never reached),
 * which is what the guard is for, and now name the refusal accurately.
 *
 * The rollback the fix originally needed is also gone, and its absence is the stronger property: nothing
 * mutates the peer map before the signature check any more, so there is nothing to undo. The two tests
 * that pinned the rollback still pass — they now pass by construction.
 *
 * The last two tests pin the ROTATION guards, which were already correct and are the sanctioned route for
 * a key that genuinely changes.
 */
import { describe, it, expect }  from 'vitest';
import { SecurityLayer, SEC }    from '../../src/security/SecurityLayer.js';
import { AgentIdentity }         from '../../src/identity/AgentIdentity.js';
import { encode as b64encode }   from '../../src/crypto/b64.js';
import { VaultMemory }           from '@onderling/vault';
import { mkEnvelope, P }         from '../../src/Envelope.js';

const newIdentity = () => AgentIdentity.generate(new VaultMemory());
/** The retired push rotation's proof, byte for byte as it was built: the OLD key's signature over its sorted JSON. */
const pushProof = (oldId, newPubKey) => {
  const unsigned = { type: 'key-rotation', oldPubKey: oldId.pubKey, newPubKey, issuedAt: Date.now(), gracePeriod: 604_800 };
  const sorted = Object.fromEntries(Object.entries(unsigned).sort(([a], [b]) => a.localeCompare(b)));
  return { ...unsigned, sig: b64encode(oldId.sign(new TextEncoder().encode(JSON.stringify(sorted)))) };
};

/** The per-circle address the roster says belongs to Alice. Mallory never controls the key behind it. */
const ALICE_CIRCLE_ADDR = 'circle-addr-alice-circle';

describe('an inbound HI cannot overwrite a roster-backed binding', () => {
  it('refuses the substitution, and the substituting HI fails against the incumbent key', async () => {
    const victimId  = await newIdentity();
    const aliceId   = await newIdentity();
    const malloryId = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });

    // ── The roster-backed binding: what `bindCircleAddressKeys` does after a join.
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // ── Mallory sends ONE HI claiming to be at Alice's circle address, carrying HER OWN pubKey.
    // `_from` is still a plain field on the wire; no transport binds it to the actual sender.
    const mallorySec = new SecurityLayer({ identity: malloryId });
    const hi = mallorySec.encrypt(
      mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: malloryId.pubKey, ack: false }),
    );

    // The signature verifies — against MALLORY's key, which her envelope carries. That buys her nothing:
    // the key that signed is not the key Alice's circle address is bound to, and the envelope is rejected
    // as what it is — signed by someone who is not the owner of that address.
    expect(() => victim.decryptAndVerify(hi)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );

    // THE GUARD: the proof-verified roster binding is untouched.
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);
    expect(victim.refusedKeySubstitutions).toBe(1);
  });

  it('so forged traffic from Mallory never arrives as Alice', async () => {
    const victimId  = await newIdentity();
    const aliceId   = await newIdentity();
    const malloryId = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    const mallorySec = new SecurityLayer({ identity: malloryId });
    mallorySec.registerPeer(victimId.pubKey, victimId.pubKey);

    // Step 1 of the attack — the substituting hello. Rejected, and harmless.
    expect(() => victim.decryptAndVerify(
      mallorySec.encrypt(
        mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: malloryId.pubKey, ack: false }),
      ),
    )).toThrow(expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }));

    // Step 2 — a perfectly ordinary encrypted message, signed by Mallory, stamped as coming from Alice's
    // address. The signature is hers and verifies; the key is not Alice's and is refused. It never
    // reaches a payload at all.
    const forged = mallorySec.encrypt(
      mkEnvelope(P.OW, ALICE_CIRCLE_ADDR, victimId.pubKey, { subtype: 'chat', text: 'lend me 500 euro' }),
    );
    expect(() => victim.decryptAndVerify(forged)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);
  });

  it('and an unsignable HI cannot poison the binding either — nothing was mutated to begin with', async () => {
    // The weakest attacker — one who cannot produce any valid signature at all — used to permanently
    // poison the binding anyway, because step 3 mutated and only the ROTATION path had a rollback.
    const victimId  = await newIdentity();
    const aliceId   = await newIdentity();
    const malloryId = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // A well-formed signature over DIFFERENT bytes: sign, then tamper. Verify returns false.
    const mallorySec = new SecurityLayer({ identity: malloryId });
    const hi = mallorySec.encrypt(
      mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: malloryId.pubKey }),
    );
    hi._topic = 'tampered-after-signing';

    expect(() => victim.decryptAndVerify(hi)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);
  });
});

describe('the establish half — first contact still works', () => {
  it('an HI from an address we hold no key for establishes the binding, and traffic flows', async () => {
    const aliceId = await newIdentity();
    const bobId   = await newIdentity();

    const alice = new SecurityLayer({ identity: aliceId });
    const bob   = new SecurityLayer({ identity: bobId });

    // Genuine first contact: neither side has ever heard of the other.
    expect(bob.getPeerKey(aliceId.pubKey)).toBeNull();

    const hi = alice.encrypt(
      mkEnvelope(P.HI, aliceId.pubKey, bobId.pubKey, { pubKey: aliceId.pubKey, ack: false }),
    );
    expect(() => bob.decryptAndVerify(hi)).not.toThrow();
    expect(bob.getPeerKey(aliceId.pubKey)).toBe(aliceId.pubKey);

    // The reciprocal hello, then real encrypted traffic in both directions.
    const hiBack = bob.encrypt(
      mkEnvelope(P.HI, bobId.pubKey, aliceId.pubKey, { pubKey: bobId.pubKey, ack: true }),
    );
    alice.decryptAndVerify(hiBack);

    const msg = alice.encrypt(
      mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { subtype: 'chat', text: 'hoi' }),
    );
    expect(bob.decryptAndVerify(msg).payload.text).toBe('hoi');
    expect(bob.refusedKeySubstitutions).toBe(0);
  });

  it('a repeated HI carrying the SAME key is an accepted no-op', async () => {
    const aliceId = await newIdentity();
    const bobId   = await newIdentity();

    const alice = new SecurityLayer({ identity: aliceId });
    const bob   = new SecurityLayer({ identity: bobId });
    bob.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // Alice re-hellos from her circle address — the ordinary case after a reconnect, and the case
    // `bindCircleAddressKeys` has already covered from the roster. Nothing changes, nothing is refused.
    const hi = alice.encrypt(
      mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, bobId.pubKey, { pubKey: aliceId.pubKey, ack: false }),
    );
    const seen = bob.decryptAndVerify(hi);

    expect(seen.payload.pubKey).toBe(aliceId.pubKey);
    expect(bob.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);
    expect(bob.refusedKeySubstitutions).toBe(0);
  });

  it('a first-contact HI with a bad signature leaves NO entry behind', async () => {
    // The rollback in its other shape: the mutation being undone is an establish, not a replace, so the
    // address must come back to having no key at all rather than to some previous one.
    const aliceId = await newIdentity();
    const bobId   = await newIdentity();

    const alice = new SecurityLayer({ identity: aliceId });
    const bob   = new SecurityLayer({ identity: bobId });

    const hi = alice.encrypt(
      mkEnvelope(P.HI, 'some-unknown-address', bobId.pubKey, { pubKey: aliceId.pubKey }),
    );
    hi._topic = 'tampered-after-signing';

    expect(() => bob.decryptAndVerify(hi)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
    expect(bob.getPeerKey('some-unknown-address')).toBeNull();
  });

  it('an unsigned HI establishes nothing — MISSING_SIG rolls back too', async () => {
    const aliceId = await newIdentity();
    const bobId   = await newIdentity();
    const bob     = new SecurityLayer({ identity: bobId });

    const hi = mkEnvelope(P.HI, 'some-unknown-address', bobId.pubKey, { pubKey: aliceId.pubKey });
    hi._sig  = null;

    expect(() => bob.decryptAndVerify(hi)).toThrow(
      expect.objectContaining({ code: SEC.MISSING_SIG }),
    );
    expect(bob.getPeerKey('some-unknown-address')).toBeNull();
  });
});

describe('a key that changed is never taken from an envelope', () => {
  it('a differing-key HI is heard, and moves nothing — the payload claim is not a binding', async () => {
    // An HI from the REAL key holder that merely ANNOUNCES a different key in its payload verifies and
    // is delivered, and the binding does not move. Since Decision 1 the crypto layer does not read that
    // announcement at all: the only key claim it consumes is the one that demonstrably signed. So this
    // is not even a refusal any more — it is a payload field the receive path has no opinion about, and
    // the announcement's sanctioned route is the rotation proof below. Liveness costs nothing either way.
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // Signed by the key we hold; announcing a new one, with nothing to back the announcement.
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const hi = aliceSec.encrypt(
      mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: aliceNew.pubKey, ack: false }),
    );

    const seen = victim.decryptAndVerify(hi);
    expect(seen._p).toBe(P.HI);
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);
    // Nothing was refused: the signing key matched the binding. The payload's claim simply had no effect.
    expect(victim.refusedKeySubstitutions).toBe(0);
    expect(seen.payload.pubKey).toBe(aliceNew.pubKey);
  });

  it('a differing-key HI carrying a rotation proof signed by the PREVIOUS key is refused — the old key cannot move the identity', async () => {
    // The push rotation honoured this: a proof signed by the old key, inside an envelope signed by the new one, and
    // the binding moved. A revoked device still holds the old seed, so whoever held the old key could rotate the
    // identity away from its owner in every peer's view. A person's key moves only through the root-gated ceremony
    // (the chain the contact pulls), never by an inline proof.
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    const proof = pushProof(aliceId, aliceNew.pubKey);

    const aliceNewSec = new SecurityLayer({ identity: aliceNew });
    const env = mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: aliceNew.pubKey });
    env._rotationProof = proof;
    const hi = aliceNewSec.encrypt(env);

    expect(() => victim.decryptAndVerify(hi)).toThrow();
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR), 'the binding did not move').toBe(aliceId.pubKey);
    expect(victim.refusedKeySubstitutions).toBe(1);
  });
});

describe('an old push-rotation proof stapled to an envelope changes nothing', () => {
  it('an inline rotation proof from a key we do not hold is ignored', async () => {
    const victimId  = await newIdentity();
    const aliceId   = await newIdentity();
    const malloryId = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // Mallory mints a proof "mallory-old → mallory-new" and staples it to an envelope from Alice's
    // address: refused, the binding intact.
    const malloryNew = await newIdentity();
    const proof = pushProof(malloryId, malloryNew.pubKey);

    const mallorySec = new SecurityLayer({ identity: malloryId });
    mallorySec.registerPeer(victimId.pubKey, victimId.pubKey);
    const env = mallorySec.encrypt(
      mkEnvelope(P.OW, ALICE_CIRCLE_ADDR, victimId.pubKey, { subtype: 'chat' }),
    );
    env._rotationProof = proof;

    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);   // intact
  });

  it('a genuine proof from Alice, stapled to a bystander\'s envelope, moves nothing', async () => {
    // The proof really is Alice's; the envelope is signed by nobody who holds the new key. Refused, and
    // Alice's key stays bound.
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    const proof = pushProof(aliceId, aliceNew.pubKey);

    const bystander = new SecurityLayer({ identity: await newIdentity() });
    bystander.registerPeer(victimId.pubKey, victimId.pubKey);
    const env = bystander.encrypt(
      mkEnvelope(P.OW, ALICE_CIRCLE_ADDR, victimId.pubKey, { subtype: 'chat' }),
    );
    env._rotationProof = proof;

    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);   // intact
  });
});
