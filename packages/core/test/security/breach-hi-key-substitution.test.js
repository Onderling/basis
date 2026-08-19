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
 * Establish if absent · no-op if identical · REFUSE if different, unless a valid rotation proof
 * accompanies it.
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
import { KeyRotation }           from '../../src/identity/KeyRotation.js';
import { VaultMemory }           from '@onderling/vault';
import { mkEnvelope, P }         from '../../src/Envelope.js';

const newIdentity = () => AgentIdentity.generate(new VaultMemory());

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

describe('a key that genuinely changed — routed through the rotation proof', () => {
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

  it('a differing-key HI WITH a valid rotation proof is honoured', async () => {
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    const proof = await KeyRotation.buildProof(aliceId, aliceNew.pubKey);

    // The proof must be inside the signed bytes, so it is attached BEFORE signing, and the envelope is
    // signed with the NEW key — exactly the shape `encrypt()` produces during a rotation grace window.
    const aliceNewSec = new SecurityLayer({ identity: aliceNew });
    const env = mkEnvelope(P.HI, ALICE_CIRCLE_ADDR, victimId.pubKey, { pubKey: aliceNew.pubKey });
    env._rotationProof = proof;
    const hi = aliceNewSec.encrypt(env);

    const seen = victim.decryptAndVerify(hi);

    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceNew.pubKey);
    // The Agent._dispatch → PeerGraph mirror still gets its tag.
    expect(seen._rotationMigrated).toEqual({
      oldPubKey: aliceId.pubKey,
      newPubKey: aliceNew.pubKey,
      proof,
    });
    // Nothing was refused on the way: the rotation branch is now the FIRST thing consulted when the
    // signing key differs from the binding, rather than a repair after a refusal was already counted.
    expect(victim.refusedKeySubstitutions).toBe(0);
  });

  it('a retired key cannot be put back in service by an HI', async () => {
    // `createSecureAgent`'s receive boundary registers the HI's canonical pubKey under itself
    // (`learnPeerKey(payload.pubKey, payload.pubKey)`). After a rotation the map holds
    // `oldPubKey → newPubKey`, so an HI asserting the RETIRED key would have reset that to `old → old`
    // and re-enabled a key its owner deliberately withdrew. Same rule, same refusal.
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(aliceId.pubKey, aliceId.pubKey);
    victim.migratePeerKey(aliceId.pubKey, aliceNew.pubKey);
    expect(victim.getPeerKey(aliceId.pubKey)).toBe(aliceNew.pubKey);

    expect(victim.learnPeerKey(aliceId.pubKey, aliceId.pubKey)).toBe('refused');
    expect(victim.getPeerKey(aliceId.pubKey)).toBe(aliceNew.pubKey);
  });
});

describe('what IS guarded — the rotation path, for contrast', () => {
  it('an inline rotation proof from a key we do not hold is ignored', async () => {
    const victimId  = await newIdentity();
    const aliceId   = await newIdentity();
    const malloryId = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    // Mallory mints a proof "mallory-old → mallory-new" and staples it to an envelope from Alice's
    // address. The guard is `mapped === proof.oldPubKey` (SecurityLayer.js:308): we hold Alice's key
    // there, not Mallory's old one, so the migration never runs.
    const malloryNew = await newIdentity();
    const proof = await KeyRotation.buildProof(malloryId, malloryNew.pubKey);

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

  it('a rotation mutation is rolled back when the signature fails', async () => {
    // Alice's own key rotates, but the envelope carrying the proof is signed by nobody who holds the new
    // key — the peers map must come back to Alice's old key.
    const victimId = await newIdentity();
    const aliceId  = await newIdentity();
    const aliceNew = await newIdentity();

    const victim = new SecurityLayer({ identity: victimId });
    victim.registerPeer(ALICE_CIRCLE_ADDR, aliceId.pubKey);

    const proof = await KeyRotation.buildProof(aliceId, aliceNew.pubKey);

    // Signed by a bystander, with the proof stapled on AFTER signing — so the proof passes every rotation
    // guard (it really is Alice's, really in grace), the migration runs, and only then does verify fail.
    const bystander = new SecurityLayer({ identity: await newIdentity() });
    bystander.registerPeer(victimId.pubKey, victimId.pubKey);
    const env = bystander.encrypt(
      mkEnvelope(P.OW, ALICE_CIRCLE_ADDR, victimId.pubKey, { subtype: 'chat' }),
    );
    env._rotationProof = proof;

    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
    expect(victim.getPeerKey(ALICE_CIRCLE_ADDR)).toBe(aliceId.pubKey);   // rolled back
  });
});
