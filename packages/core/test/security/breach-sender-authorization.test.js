/**
 * GUARD — `_from` is a routing hint, and nothing authorizes on it (Decision 1, 2026-07-31).
 *
 * ── The class of attack this closes ──────────────────────────────────────────────────────────────
 * The receive path used to read, in order: take `_from`, look up the key we hold for `_from`, verify
 * the signature against THAT key. `_from` is a plain wire field no transport authenticates, so the
 * one input deciding *whose* key was being checked was attacker-chosen. Every impersonation finding
 * of 2026-07-30 was a different way of exercising that one line.
 *
 * It now runs the other way round:
 *   1. the envelope CARRIES the key that signed it (`_signedBy`);
 *   2. the signature is verified against THAT key — self-consistent, no lookup, nothing to steer;
 *   3. the proven key is AUTHORIZED, against the binding we hold and against the roster.
 *
 * Step 2 is not trust. A self-signed envelope proves only "the holder of key K sent this", and this
 * file is mostly about what happens next: a valid signature from a key nobody vouched for is a
 * valid signature from a stranger, and a stranger does not get membership.
 *
 * ── Where the tests point ────────────────────────────────────────────────────────────────────────
 * `packages/core` holds the PORT, never an implementation of it (invariant 5 — concrete membership
 * knowledge does not live in the kernel). So the "roster" here is a two-line stand-in, which is
 * exactly the shape the real implementation has (`apps/basis/src/v2/circleSenderAuthorization.js`).
 * The end-to-end proof that the port is actually WIRED to a real roster, over a real relay, is
 * `apps/basis/test/v2/circleSenderAuthorization.relay.test.js` — a guard here would pass happily
 * while nothing in the product called it.
 */
import { describe, it, expect, vi }                   from 'vitest';
import { SecurityLayer, SEC }                         from '../../src/security/SecurityLayer.js';
import { allowSender, refuseSender }                  from '../../src/security/senderAuthorization.js';
import { SENDER_KEY_FIELD }                           from '../../src/security/senderKey.js';
import { AgentIdentity }                              from '../../src/identity/AgentIdentity.js';
import { VaultMemory }                                from '@onderling/vault';
import { mkEnvelope, P }                              from '../../src/Envelope.js';

const newIdentity = () => AgentIdentity.generate(new VaultMemory());

/**
 * A roster stand-in with the same shape as the real one: keyed by which of OUR addresses an
 * envelope was sent to, holding the set of keys allowed to speak there. Anything not addressed to
 * one of our circle addresses is out-of-circle and passes — that is where first contact lives.
 */
function rosterAuthorizer(byOwnAddress) {
  return ({ senderKey, ownAddress }) => {
    if (!ownAddress) return allowSender('not-circle-scoped');
    const allowed = byOwnAddress.get(ownAddress);
    if (!allowed) return allowSender('no-roster-recorded');
    return allowed.has(senderKey) ? allowSender('member') : refuseSender('stranger');
  };
}

/** One person's presence in one circle: an identity of their own, answering at one address. */
async function memberOf(layer, address) {
  const identity = await newIdentity();
  if (layer) layer.addSelfIdentity(address, identity);
  return identity;
}

describe('a valid signature from a non-member is refused', () => {
  it('the envelope verifies, and is refused anyway because no roster vouches for the key', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });

    // The victim's own per-circle identity, and the circle's roster: one other member.
    const OUR_ADDRESS = 'victim-in-buurt';
    const ours   = await memberOf(victim, OUR_ADDRESS);
    const member = await newIdentity();
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([[OUR_ADDRESS, new Set([member.pubKey])]])));

    // A stranger with a perfectly good key, sealing to our per-circle identity — which anyone who
    // has seen the address can do, since the address IS the key (L2, one derivation).
    const strangerId  = await newIdentity();
    const strangerSec = new SecurityLayer({ identity: strangerId });
    strangerSec.registerPeer(ours.pubKey, ours.pubKey);
    const env = strangerSec.encrypt(
      mkEnvelope(P.OW, strangerId.pubKey, ours.pubKey, { subtype: 'chat', text: 'ik hoor erbij' }),
    );

    // Nothing is wrong with this envelope. It carries the key that signed it, and that signature is
    // genuine — which is precisely why "verify" cannot be the last word.
    expect(env[SENDER_KEY_FIELD]).toBe(strangerId.pubKey);
    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_AUTHORIZED }),
    );
    expect(victim.refusedUnauthorizedSenders).toBe(1);
  });

  it('and claiming a member\'s ADDRESS buys nothing either — `_from` authorizes nothing', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const OUR_ADDRESS = 'victim-in-buurt';
    const ours = await memberOf(victim, OUR_ADDRESS);

    const memberId = await newIdentity();
    const MEMBER_ADDRESS = 'anna-in-buurt';
    victim.registerPeer(MEMBER_ADDRESS, memberId.pubKey);     // the roster binding, from the join
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([[OUR_ADDRESS, new Set([memberId.pubKey])]])));

    // The old attack in its purest form: stamp the member's address on the envelope so the receiver
    // looks up — and verifies against — the member's key. There is no lookup any more, so the claim
    // steers nothing; the envelope is refused for carrying a key that is not the one bound there.
    const strangerId  = await newIdentity();
    const strangerSec = new SecurityLayer({ identity: strangerId });
    strangerSec.registerPeer(ours.pubKey, ours.pubKey);
    const forged = strangerSec.encrypt(
      mkEnvelope(P.OW, MEMBER_ADDRESS, ours.pubKey, { subtype: 'chat', text: 'leen me 500 euro' }),
    );

    expect(() => victim.decryptAndVerify(forged)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );
    expect(victim.getPeerKey(MEMBER_ADDRESS)).toBe(memberId.pubKey);   // binding intact
  });

  it('a member speaks normally — the check is a check, not an outage', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const OUR_ADDRESS = 'victim-in-buurt';
    const ours = await memberOf(victim, OUR_ADDRESS);

    const memberId = await newIdentity();
    const MEMBER_ADDRESS = 'anna-in-buurt';
    victim.registerPeer(MEMBER_ADDRESS, memberId.pubKey);
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([[OUR_ADDRESS, new Set([memberId.pubKey])]])));

    const memberSec = new SecurityLayer({ identity: memberId });
    memberSec.registerPeer(ours.pubKey, ours.pubKey);
    const env = memberSec.encrypt(
      mkEnvelope(P.OW, MEMBER_ADDRESS, ours.pubKey, { subtype: 'chat', text: 'hoi buren' }),
    );

    expect(victim.decryptAndVerify(env).payload.text).toBe('hoi buren');
    expect(victim.refusedUnauthorizedSenders).toBe(0);
  });
});

describe('a key that belongs in ONE circle does not belong in another', () => {
  it("a member's circle-A key cannot speak at our circle-B address", async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });

    const IN_A = 'victim-in-buurt';
    const IN_B = 'victim-in-koor';
    const oursA = await memberOf(victim, IN_A);
    const oursB = await memberOf(victim, IN_B);

    // Anna is in circle A only. Her per-circle key there is a real, roster-recorded key — just not
    // one circle B has ever heard of.
    const annaInA = await newIdentity();
    const ANNA_IN_A = 'anna-in-buurt';
    victim.registerPeer(ANNA_IN_A, annaInA.pubKey);
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([
      [IN_A, new Set([annaInA.pubKey])],
      [IN_B, new Set([(await newIdentity()).pubKey])],   // circle B has other members entirely
    ])));

    const annaSec = new SecurityLayer({ identity: annaInA });
    annaSec.registerPeer(oursA.pubKey, oursA.pubKey);
    annaSec.registerPeer(oursB.pubKey, oursB.pubKey);

    // In circle A: fine.
    expect(victim.decryptAndVerify(annaSec.encrypt(
      mkEnvelope(P.OW, ANNA_IN_A, oursA.pubKey, { text: 'in de buurt' }),
    )).payload.text).toBe('in de buurt');

    // The same key, the same sender, one address to our left: refused.
    expect(() => victim.decryptAndVerify(annaSec.encrypt(
      mkEnvelope(P.OW, ANNA_IN_A, oursB.pubKey, { text: 'en in het koor' }),
    ))).toThrow(expect.objectContaining({ code: SEC.SENDER_NOT_AUTHORIZED }));
  });

  it('a key learned by TRUST-ON-FIRST-USE cannot satisfy an in-circle authorize', async () => {
    // TOFU survives only where it is genuinely the right answer: out-of-circle first contact. The
    // roster is the authority inside a circle, and "we have met" is not membership.
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const OUR_ADDRESS = 'victim-in-buurt';
    const ours = await memberOf(victim, OUR_ADDRESS);
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([
      [OUR_ADDRESS, new Set([(await newIdentity()).pubKey])],
    ])));

    // First contact, out of circle: a hello to our canonical identity establishes their key.
    const contactId  = await newIdentity();
    const contactSec = new SecurityLayer({ identity: contactId });
    const hi = contactSec.encrypt(
      mkEnvelope(P.HI, contactId.pubKey, victimId.pubKey, { pubKey: contactId.pubKey }),
    );
    expect(() => victim.decryptAndVerify(hi)).not.toThrow();
    expect(victim.getPeerKey(contactId.pubKey)).toBe(contactId.pubKey);

    // Now the same known-and-trusted contact addresses our circle identity. Knowing them is not
    // being in a circle with them.
    contactSec.registerPeer(ours.pubKey, ours.pubKey);
    expect(() => victim.decryptAndVerify(contactSec.encrypt(
      mkEnvelope(P.OW, contactId.pubKey, ours.pubKey, { text: 'mag ik erbij' }),
    ))).toThrow(expect.objectContaining({ code: SEC.SENDER_NOT_AUTHORIZED }));
  });
});

describe('the carried key cannot be swapped', () => {
  it('replacing `_signedBy` with a member\'s key invalidates the signature', async () => {
    // The obvious question about carrying the key: what stops an attacker from writing someone
    // else\'s key into the field? Nothing — and it gains them nothing, because the field is inside
    // the signed bytes. Swap it and the pair stops being self-consistent.
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const memberId = await newIdentity();
    victim.registerPeer('anna-in-buurt', memberId.pubKey);

    const strangerId  = await newIdentity();
    const strangerSec = new SecurityLayer({ identity: strangerId });
    strangerSec.registerPeer(victimId.pubKey, victimId.pubKey);
    const forged = strangerSec.encrypt(
      mkEnvelope(P.OW, 'anna-in-buurt', victimId.pubKey, { text: 'ik ben Anna' }),
    );
    forged[SENDER_KEY_FIELD] = memberId.pubKey;   // claim the member's key without holding it

    expect(() => victim.decryptAndVerify(forged)).toThrow(
      expect.objectContaining({ code: SEC.BAD_SIG }),
    );
  });

  it('an envelope that carries no signing key at all is refused, not guessed at', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const senderId  = await newIdentity();
    const senderSec = new SecurityLayer({ identity: senderId });
    senderSec.registerPeer(victimId.pubKey, victimId.pubKey);
    victim.registerPeer(senderId.pubKey, senderId.pubKey);

    const env = senderSec.encrypt(mkEnvelope(P.OW, senderId.pubKey, victimId.pubKey, { text: 'x' }));
    delete env[SENDER_KEY_FIELD];

    // The old path would have fallen back to "the key we hold for `_from`" — which is the whole
    // defect. There is no fallback: no carried key, no verification.
    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.MISSING_SENDER_KEY }),
    );
  });

  it('a malformed signing key is refused rather than handed to the verifier', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const senderId  = await newIdentity();
    const senderSec = new SecurityLayer({ identity: senderId });
    senderSec.registerPeer(victimId.pubKey, victimId.pubKey);

    const env = senderSec.encrypt(mkEnvelope(P.OW, senderId.pubKey, victimId.pubKey, { text: 'x' }));
    env[SENDER_KEY_FIELD] = 'not-a-key';

    // `AgentIdentity.verify` throws on a wrong-sized key, which would turn a refusable envelope into
    // an exception escaping the receive path.
    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.MISSING_SENDER_KEY }),
    );
  });
});

describe('a replayed envelope is refused, authorized or not', () => {
  it('the second copy of an accepted circle envelope is a DUPLICATE', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const OUR_ADDRESS = 'victim-in-buurt';
    const ours = await memberOf(victim, OUR_ADDRESS);

    const memberId = await newIdentity();
    victim.registerPeer('anna-in-buurt', memberId.pubKey);
    victim.setSenderAuthorizer(rosterAuthorizer(new Map([[OUR_ADDRESS, new Set([memberId.pubKey])]])));

    const memberSec = new SecurityLayer({ identity: memberId });
    memberSec.registerPeer(ours.pubKey, ours.pubKey);
    const env = memberSec.encrypt(
      mkEnvelope(P.OW, 'anna-in-buurt', ours.pubKey, { text: 'eenmaal' }),
    );

    expect(victim.decryptAndVerify(env).payload.text).toBe('eenmaal');
    expect(() => victim.decryptAndVerify({ ...env })).toThrow(
      expect.objectContaining({ code: SEC.DUPLICATE }),
    );
  });

  it('an envelope older than the replay window never reaches the authorize step', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    victim.setSenderAuthorizer(() => { throw new Error('must not be consulted'); });

    const senderId  = await newIdentity();
    const senderSec = new SecurityLayer({ identity: senderId });
    senderSec.registerPeer(victimId.pubKey, victimId.pubKey);
    const env = senderSec.encrypt(mkEnvelope(P.OW, senderId.pubKey, victimId.pubKey, { text: 'oud' }));
    env._ts = Date.now() - 11 * 60 * 1000;

    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.REPLAY_WINDOW }),
    );
    expect(victim.refusedUnauthorizedSenders).toBe(0);
  });
});

describe('the port itself — fail-closed, and honest about absence', () => {
  const goodEnvelope = async (victim, victimId) => {
    const senderId  = await newIdentity();
    const senderSec = new SecurityLayer({ identity: senderId });
    senderSec.registerPeer(victimId.pubKey, victimId.pubKey);
    victim.registerPeer(senderId.pubKey, senderId.pubKey);
    return senderSec.encrypt(mkEnvelope(P.OW, senderId.pubKey, victimId.pubKey, { text: 'hoi' }));
  };

  it('an authorizer that THROWS refuses the envelope', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const env = await goodEnvelope(victim, victimId);
    victim.setSenderAuthorizer(() => { throw new Error('roster store is broken'); });
    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_AUTHORIZED }),
    );
  });

  it('an authorizer that answers with a PROMISE refuses, rather than being coerced to truthy', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const env = await goodEnvelope(victim, victimId);
    victim.setSenderAuthorizer(async () => allowSender('async by mistake'));
    expect(() => victim.decryptAndVerify(env)).toThrow(
      expect.objectContaining({ code: SEC.SENDER_NOT_AUTHORIZED }),
    );
  });

  it('NO authorizer passes the step — and says so in a number rather than in silence', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    const env = await goodEnvelope(victim, victimId);

    expect(victim.hasSenderAuthorizer).toBe(false);
    expect(victim.decryptAndVerify(env).payload.text).toBe('hoi');
    // The kernel cannot invent membership, so this is the honest outcome — but "nobody wired the
    // roster" must be readable, not merely inferable from nothing having gone wrong.
    expect(victim.senderAuthorizationsByAbsence).toBe(1);
  });

  it('WARNS, once, when it accepts because nobody is checking (Frits, 2026-08-02)', async () => {
    // A counter survives a lost console; a warning survives an unread counter. The absence of a roster
    // authorizer is the difference between "verified and authorized" and "verified, and accepted from
    // anyone" — invisible unless something says it out loud.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const victimId = await newIdentity();
      const victim   = new SecurityLayer({ identity: victimId });

      victim.decryptAndVerify(await goodEnvelope(victim, victimId));
      const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).toMatch(/NO ROSTER AUTHORIZER INSTALLED/);
      expect(said).toMatch(/setSenderAuthorizer/);   // says what to DO, not only what is wrong

      // once per layer — a per-envelope warning is noise, and noise is how a real warning gets ignored
      const after = warn.mock.calls.length;
      victim.decryptAndVerify(await goodEnvelope(victim, victimId));
      expect(warn.mock.calls.length).toBe(after);
      expect(victim.senderAuthorizationsByAbsence).toBe(2);   // the COUNT still moves
    } finally { warn.mockRestore(); }
  });

  it('says nothing when an authorizer IS installed — the warning must stay meaningful', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const victimId = await newIdentity();
      const victim   = new SecurityLayer({ identity: victimId, authorizeSender: () => allowSender('member') });
      victim.decryptAndVerify(await goodEnvelope(victim, victimId));
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/NO ROSTER AUTHORIZER/);
      expect(victim.senderAuthorizationsByAbsence).toBe(0);
    } finally { warn.mockRestore(); }
  });

  it('installing an authorizer is reversible, and reported', async () => {
    const victimId = await newIdentity();
    const victim   = new SecurityLayer({ identity: victimId });
    expect(victim.setSenderAuthorizer(() => allowSender('yes'))).toBe(true);
    expect(victim.hasSenderAuthorizer).toBe(true);
    expect(victim.setSenderAuthorizer(null)).toBe(false);
    expect(victim.hasSenderAuthorizer).toBe(false);
  });
});
