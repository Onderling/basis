/**
 * DECISION 4 — the per-circle SIGNING identity, at the kernel boundary.
 *
 * Per-circle ADDRESSING already made a person's routing address different in every circle. It did not
 * make the KEYS different: an envelope was signed by, and sealed to, the profile's one global identity
 * key — and `SecurityLayer.encrypt` writes the recipient's key into `_to` in cleartext. So two envelopes
 * from two circles could be lined up as one person by key alone, by the relay carrying them or by anyone
 * else on the path, no matter what the addresses said. `circleIdentity()` had existed since the addresses
 * were built and had never been called.
 *
 * These are the claims that make it true, each phrased so that it FAILS if the wiring is undone:
 *   1. an envelope sent AS a per-circle address is signed by that circle's key, not the person's;
 *   2. an envelope sealed TO that key is opened with it;
 *   3. the canonical key appears NOWHERE in a circle exchange — the §12 guard for Decision 4;
 *   4. ADVERSARIAL: holding the person's canonical key does not let you speak as them in a circle,
 *      and holding their key in ONE circle does not let you speak as them in another.
 *
 * The adversarial pair is the point of the whole decision: if either passed, per-circle signing would be
 * decoration over a single key that still binds everything together.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityLayer, SEC } from '../../src/security/SecurityLayer.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { circleIdentity, deriveCircleAddress } from '../../src/identity/circleAddress.js';
import { mkEnvelope, P, canonicalize } from '../../src/Envelope.js';
import { VaultMemory } from '@onderling/vault';
import nacl from 'tweetnacl';
import { decode as b64decode } from '../../src/crypto/b64.js';

const CIRCLE_A = 'circle-oosterpoort';
const CIRCLE_B = 'huishouden-de-vries';

const seed = () => new Uint8Array(nacl.randomBytes(32));

/** One person: a canonical identity plus a signing identity in each circle. */
async function person(circleIds = [CIRCLE_A]) {
  const profileSeed = seed();
  const canonical = await AgentIdentity.fromSeed(seed(), new VaultMemory());
  const layer = new SecurityLayer({ identity: canonical });
  const inCircle = {};
  for (const c of circleIds) {
    const id = await circleIdentity(profileSeed, c, new VaultMemory());
    inCircle[c] = id;
    layer.addSelfIdentity(deriveCircleAddress(profileSeed, c), id);
  }
  return { profileSeed, canonical, layer, inCircle, addressIn: (c) => deriveCircleAddress(profileSeed, c) };
}

/** Verify an envelope's signature against a specific key — what a receiver's step 4 does. */
function verifiesAs(env, pubKey) {
  const { _sig, ...rest } = env;
  return AgentIdentity.verify(canonicalize({ ...rest, _sig: null }), b64decode(_sig), pubKey);
}

describe('Decision 4 — a circle is signed by the circle identity, not the person', () => {
  let anna; let bram;

  beforeEach(async () => {
    anna = await person([CIRCLE_A, CIRCLE_B]);
    bram = await person([CIRCLE_A]);
    // Each holds the other's per-circle key under that circle's address — what a roster row gives them.
    anna.layer.registerPeer(bram.addressIn(CIRCLE_A), bram.inCircle[CIRCLE_A].pubKey);
    bram.layer.registerPeer(anna.addressIn(CIRCLE_A), anna.inCircle[CIRCLE_A].pubKey);
  });

  it('signs with the circle identity when the envelope speaks from a circle address', () => {
    const env = anna.layer.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'hoi' },
    ));
    expect(verifiesAs(env, anna.inCircle[CIRCLE_A].pubKey)).toBe(true);
    expect(verifiesAs(env, anna.canonical.pubKey)).toBe(false);
  });

  it('still signs with the canonical identity for traffic that is not a circle (contacts, pairing)', () => {
    anna.layer.registerPeer(bram.canonical.pubKey, bram.canonical.pubKey);
    const env = anna.layer.encrypt(mkEnvelope(
      P.OW, anna.canonical.pubKey, bram.canonical.pubKey, { text: 'hoi' },
    ));
    expect(verifiesAs(env, anna.canonical.pubKey)).toBe(true);
  });

  it('opens an envelope sealed to a per-circle key — the receive half', () => {
    const env = anna.layer.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'de vergadering is verzet' },
    ));
    const opened = bram.layer.decryptAndVerify(env);
    expect(opened.payload.text).toBe('de vergadering is verzet');
  });

  it('cannot open it once the circle identity is removed — proving THAT key did the work', async () => {
    const env = anna.layer.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'x' },
    ));
    bram.layer.removeSelfIdentity(bram.addressIn(CIRCLE_A));
    expect(() => bram.layer.decryptAndVerify(env)).toThrowError(/nacl\.box\.open failed/);
  });

  it('the canonical key appears NOWHERE in a circle exchange (the §12 guard for Decision 4)', () => {
    const hi = anna.layer.encrypt(mkEnvelope(
      P.HI, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A),
      { pubKey: anna.inCircle[CIRCLE_A].pubKey },
    ));
    const ow = anna.layer.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'hoi' },
    ));
    const onTheWire = JSON.stringify([hi, ow]);
    expect(onTheWire).not.toContain(anna.canonical.pubKey);
    expect(onTheWire).not.toContain(bram.canonical.pubKey);
    // …and the addresses that DO appear are the per-circle ones.
    expect(ow._from).toBe(anna.addressIn(CIRCLE_A));
    expect(ow._to).toBe(bram.inCircle[CIRCLE_A].pubKey);
  });

  it('two circles of the same person share no key on the wire', () => {
    anna.layer.registerPeer(bram.addressIn(CIRCLE_A), bram.inCircle[CIRCLE_A].pubKey);
    const inA = anna.layer.encrypt(mkEnvelope(
      P.HI, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { pubKey: anna.inCircle[CIRCLE_A].pubKey },
    ));
    const inB = anna.layer.encrypt(mkEnvelope(
      P.HI, anna.addressIn(CIRCLE_B), bram.addressIn(CIRCLE_A), { pubKey: anna.inCircle[CIRCLE_B].pubKey },
    ));
    expect(inA._from).not.toBe(inB._from);
    expect(JSON.stringify(inA)).not.toContain(anna.inCircle[CIRCLE_B].pubKey);
    expect(JSON.stringify(inB)).not.toContain(anna.inCircle[CIRCLE_A].pubKey);
  });
});

describe('ADVERSARIAL — what holding the wrong key buys you', () => {
  let anna; let bram; let mallory;

  beforeEach(async () => {
    anna = await person([CIRCLE_A, CIRCLE_B]);
    bram = await person([CIRCLE_A]);
    mallory = await person([CIRCLE_A]);
    bram.layer.registerPeer(anna.addressIn(CIRCLE_A), anna.inCircle[CIRCLE_A].pubKey);
  });

  it("Anna's CANONICAL key cannot speak as Anna in a circle", () => {
    // The attacker holds Anna's canonical identity (a compromised contact channel, a leaked device
    // key) and stamps her circle address on an envelope. Before Decision 4 that key WAS the circle
    // key, so this succeeded by construction.
    const forger = new SecurityLayer({ identity: anna.canonical });
    forger.registerPeer(bram.addressIn(CIRCLE_A), bram.inCircle[CIRCLE_A].pubKey);
    const forged = forger.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'ik ben Anna' },
    ));
    // Decision 1 — the envelope is validly signed (by the canonical key it carries), and refused
    // because that key is not the one bound to Anna's circle address.
    expect(() => bram.layer.decryptAndVerify(forged)).toThrowError(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );
  });

  it("Anna's key in circle B cannot speak as Anna in circle A", () => {
    const forger = new SecurityLayer({ identity: anna.inCircle[CIRCLE_B] });
    forger.registerPeer(bram.addressIn(CIRCLE_A), bram.inCircle[CIRCLE_A].pubKey);
    const forged = forger.encrypt(mkEnvelope(
      P.OW, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A), { text: 'ik ben Anna, elders' },
    ));
    expect(() => bram.layer.decryptAndVerify(forged)).toThrowError(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );
  });

  it('a co-member cannot make an HI install a different key for a proved circle address', () => {
    // The 07-30 substitution attack, now at the per-circle layer: Mallory HIs as Anna's circle
    // address carrying her own key. The binding survives and her envelope fails on its own merits.
    const hi = mallory.layer.encrypt(mkEnvelope(
      P.HI, anna.addressIn(CIRCLE_A), bram.addressIn(CIRCLE_A),
      { pubKey: mallory.inCircle[CIRCLE_A].pubKey },
    ));
    expect(() => bram.layer.decryptAndVerify(hi)).toThrowError(
      expect.objectContaining({ code: SEC.SENDER_NOT_BOUND }),
    );
    expect(bram.layer.getPeerKey(anna.addressIn(CIRCLE_A))).toBe(anna.inCircle[CIRCLE_A].pubKey);
  });

  it('an envelope claiming an address whose identity we do not hold is signed canonically, not silently', () => {
    // The wiring mistake, not an attack: `_from` names an address this layer has no identity for.
    // It must fall back to the canonical identity — an unsigned or wrongly-signed envelope would be
    // worse — and the caller-visible consequence (a peer expecting the circle key rejects it) is what
    // the substrate's warning is for.
    const stranger = deriveCircleAddress(new Uint8Array(nacl.randomBytes(32)), CIRCLE_A);
    anna.layer.registerPeer(bram.addressIn(CIRCLE_A), bram.inCircle[CIRCLE_A].pubKey);
    const env = anna.layer.encrypt(mkEnvelope(P.OW, stranger, bram.addressIn(CIRCLE_A), { text: 'x' }));
    expect(verifiesAs(env, anna.canonical.pubKey)).toBe(true);
  });
});

describe('the registry itself', () => {
  it('resolves an identity by its address OR by its key, and forgets it on request', async () => {
    const p = await person([CIRCLE_A]);
    const address = p.addressIn(CIRCLE_A);
    expect(p.layer.selfIdentityFor(address)?.pubKey).toBe(p.inCircle[CIRCLE_A].pubKey);
    expect(p.layer.selfIdentityFor(p.inCircle[CIRCLE_A].pubKey)?.pubKey).toBe(p.inCircle[CIRCLE_A].pubKey);
    expect(p.layer.ownAddressFor(p.inCircle[CIRCLE_A].pubKey)).toBe(address);
    expect(p.layer.selfAddresses).toEqual([address]);
    expect(p.layer.removeSelfIdentity(address)).toBe(true);
    expect(p.layer.selfIdentityFor(address)).toBeNull();
    expect(p.layer.removeSelfIdentity(address)).toBe(false);
  });

  it('refuses malformed registrations rather than half-registering them', async () => {
    const p = await person([]);
    expect(p.layer.addSelfIdentity('', p.canonical)).toBe(false);
    expect(p.layer.addSelfIdentity('addr', null)).toBe(false);
    expect(p.layer.addSelfIdentity('addr', { pubKey: 'k' })).toBe(false);   // no sign/box
    expect(p.layer.selfAddresses).toEqual([]);
  });

  it('replacing the identity at an address drops the old key from the reverse view', async () => {
    const p = await person([]);
    const first  = await AgentIdentity.fromSeed(seed(), new VaultMemory());
    const second = await AgentIdentity.fromSeed(seed(), new VaultMemory());
    p.layer.addSelfIdentity('addr-1', first);
    p.layer.addSelfIdentity('addr-1', second);
    expect(p.layer.selfIdentityFor('addr-1').pubKey).toBe(second.pubKey);
    expect(p.layer.ownAddressFor(first.pubKey)).toBeNull();
    expect(p.layer.ownAddressFor(second.pubKey)).toBe('addr-1');
  });
});

describe('the one-derivation seam (open question L2)', () => {
  it('today the per-circle signing key IS the per-circle address', async () => {
    // `circleIdentity` is the ONLY place this is decided. If Frits answers "two derivations", this
    // test is the one that changes — and nothing that depends on it has to, because every layer
    // carries the address and the identity as two values.
    const profileSeed = seed();
    const id = await circleIdentity(profileSeed, CIRCLE_A, new VaultMemory());
    expect(id.pubKey).toBe(deriveCircleAddress(profileSeed, CIRCLE_A));
  });

  it('the registry does not depend on that: an identity whose key differs from its address works', async () => {
    // Proof that the seam is a seam. Registered under an address unrelated to the key, both the
    // outbound selection (by address) and the inbound selection (by key) still resolve.
    const canonical = await AgentIdentity.fromSeed(seed(), new VaultMemory());
    const layer = new SecurityLayer({ identity: canonical });
    const detached = await AgentIdentity.fromSeed(seed(), new VaultMemory());
    layer.addSelfIdentity('an-address-that-is-not-the-key', detached);
    expect(layer.selfIdentityFor('an-address-that-is-not-the-key').pubKey).toBe(detached.pubKey);
    expect(layer.selfIdentityFor(detached.pubKey).pubKey).toBe(detached.pubKey);

    const peer = await AgentIdentity.fromSeed(seed(), new VaultMemory());
    layer.registerPeer(peer.pubKey, peer.pubKey);
    const env = layer.encrypt(mkEnvelope(
      P.OW, 'an-address-that-is-not-the-key', peer.pubKey, { text: 'x' },
    ));
    expect(verifiesAs(env, detached.pubKey)).toBe(true);
  });
});
