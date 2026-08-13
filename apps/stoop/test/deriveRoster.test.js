/**
 * deriveRoster — unit tests (Connectivity Phase 1, Part A / B1 regression net).
 *
 * The load-bearing assertion is the B1 regression: a COLD/empty MemberMap must
 * NOT empty the roster when the durable redemption trail has members. Also
 * covers: founder-without-a-redemption, the joiner learning the admin via
 * `confirmedBy`, display-field left-join, and key backfill from the trail.
 */
import { describe, it, expect } from 'vitest';
import { signSpine, AgentIdentity, deriveCircleAddress, signCircleLinkFromSeed } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { deriveRoster } from '../src/lib/deriveRoster.js';

const redemption = (over = {}) => ({
  type: 'membership-redemption',
  source: { groupId: 'g1', ...over },
});

describe('deriveRoster', () => {
  it('derives N members from N redemptions, with keys from the trail', () => {
    const roster = deriveRoster({
      redemptions: [
        redemption({ redeemedBy: 'B', signingPublicKey: 'pkB', sealingPublicKey: 'skB', circleAddress: 'addrB' }),
        redemption({ redeemedBy: 'C', signingPublicKey: 'pkC' }),
      ],
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['B', 'C']);
    const b = roster.find((m) => m.webid === 'B');
    expect(b.pubKey).toBe('pkB');
    expect(b.sealingPublicKey).toBe('skB');
    expect(b.circleAddress).toBe('addrB');
    expect(b.role).toBe('member');
  });

  it('B1 regression: a COLD/empty MemberMap still yields a full roster', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
      memberMapForDisplay: [],   // the runtime-empty cache that used to blank the roster
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['A', 'B']);
  });

  it('includes the founder (role admin) even with no redemption of their own', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
    });
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
    expect(roster.find((m) => m.webid === 'B')?.role).toBe('member');
  });

  it('joiner side: learns the admin via confirmedBy (peer channel)', () => {
    // The joiner's OWN trail: only their redemption, carrying confirmedBy=admin.
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', confirmedBy: 'A', channel: 'peer', signingPublicKey: 'pkB' })],
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['A', 'B']);
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
    expect(roster.find((m) => m.webid === 'B')?.role).toBe('member');
  });

  it('joiner side: the admin row carries their per-circle address + signing key', () => {
    // Recorded (proof-verified) by `recordRemoteRedemption` when the redeem RESPONSE carried it. Without
    // both halves a send to the admin falls through to their global key — refused when the per-user
    // address fallback is off — and the address cannot be bound to an identity key for sealing.
    const roster = deriveRoster({
      redemptions: [redemption({
        redeemedBy: 'B', confirmedBy: 'A', channel: 'peer', confirmedByCircleAddress: 'addrA-in-g1',
      })],
    });
    const a = roster.find((m) => m.webid === 'A');
    expect(a.circleAddress).toBe('addrA-in-g1');
    expect(a.pubKey).toBe('A');
  });

  it('ignores confirmedBy when the channel is not peer', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', confirmedBy: 'A', channel: 'intro' })],
    });
    expect(roster.map((m) => m.webid)).toEqual(['B']);
  });

  it('left-joins the MemberMap for display fields but trail owns existence + keys', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      memberMapForDisplay: [
        { webid: 'B', displayName: 'Bea', handle: 'bea', tags: ['koor'] },
        { webid: 'Z', displayName: 'Ghost' },   // in the cache but NOT the trail → excluded
      ],
    });
    expect(roster.map((m) => m.webid)).toEqual(['B']);   // Z is not a member (not in trail)
    const b = roster[0];
    expect(b.displayName).toBe('Bea');
    expect(b.handle).toBe('bea');
    expect(b.tags).toEqual(['koor']);
    expect(b.pubKey).toBe('pkB');   // trail key preserved through the join
  });

  it('backfills a missing trail key from the MemberMap (founder own keys)', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
      memberMapForDisplay: [{ webid: 'A', role: 'admin', circleAddress: 'addrA', sealingPublicKey: 'skA' }],
    });
    const a = roster.find((m) => m.webid === 'A');
    expect(a.role).toBe('admin');
    expect(a.circleAddress).toBe('addrA');   // filled from the display cache
    expect(a.sealingPublicKey).toBe('skA');
  });

  it('leaves an unknown key absent (undefined), never a null placeholder', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', sealingPublicKey: 'skB' })],
      founderWebids: ['A'],
    });
    // A has no sealingPublicKey anywhere → the key must be ABSENT, not null.
    const a = roster.find((m) => m.webid === 'A');
    expect(a.sealingPublicKey).toBeUndefined();
    expect('sealingPublicKey' in a).toBe(false);
  });

  it('never downgrades an admin to a member across rows', () => {
    const roster = deriveRoster({
      redemptions: [
        redemption({ redeemedBy: 'A', role: 'member' }),   // a stray member-role row
      ],
      founderWebids: ['A'],                                 // but A is the founder → admin
    });
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
  });

  it('returns [] for a fully empty input (caller falls back to the cache)', () => {
    expect(deriveRoster({})).toEqual([]);
  });

  // ── The per-circle address SET — a second PROVEN address must not evict the first ─────────────────────
  describe('the per-circle address set (circleAddresses)', () => {
    // REAL proofs: an address only enters the set when `verifyCircleLink` accepts its proof, so the
    // test addresses are genuinely derived and genuinely signed, exactly as a device would.
    const seedOf  = (n) => new Uint8Array(32).fill(n);
    const addrOf  = (n) => deriveCircleAddress(seedOf(n), 'g1');
    const proofOf = (n) => signCircleLinkFromSeed(seedOf(n), 'g1', 'g1', addrOf(n));

    it('a second PROVEN address (a later trail row) joins the set — and the FIRST survives', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
          redemption({ redeemedBy: 'B', circleAddress: addrOf(2), circleAddressProof: proofOf(2) }),
        ],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddress, 'the primary slot keeps the FIRST address').toBe(addrOf(1));
      expect(b.circleAddresses, 'both proven addresses, primary first').toEqual([addrOf(1), addrOf(2)]);
    });

    it('the patched row shape — primary + plural extras — folds to the full set', () => {
      // The shape `recordCircleAddress` writes after a re-announce: the new primary in the scalar
      // slot, the previously proven pair demoted into `circleAddresses`.
      const roster = deriveRoster({
        redemptions: [redemption({
          redeemedBy: 'B',
          circleAddress: addrOf(2), circleAddressProof: proofOf(2),
          circleAddresses: [{ address: addrOf(1), proof: proofOf(1) }],
        })],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddress).toBe(addrOf(2));
      expect(b.circleAddresses).toEqual([addrOf(2), addrOf(1)]);
    });

    it('an UNPROVEN second address is refused — deny-by-default, never a silent admit', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
          // A proof signed by SOMEONE ELSE's key: seeing an address is not holding it.
          redemption({ redeemedBy: 'B', circleAddress: addrOf(2), circleAddressProof: proofOf(3) }),
          // No proof at all, in both carrier shapes.
          redemption({ redeemedBy: 'B', circleAddress: addrOf(4) }),
          redemption({ redeemedBy: 'B', circleAddresses: [{ address: addrOf(5) }] }),
        ],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddresses, 'only the proven address is in the set').toEqual([addrOf(1)]);
    });

    it('a LEGACY single-address row still folds — primary kept, the set is that address alone', () => {
      // Pre-set trail: an address recorded before proofs rode along (trusted at write). The primary
      // keeps working, and it leads the set — but a proofless row cannot GROW the set.
      const roster = deriveRoster({
        redemptions: [redemption({ redeemedBy: 'B', circleAddress: 'addrB-legacy' })],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddress).toBe('addrB-legacy');
      expect(b.circleAddresses).toEqual(['addrB-legacy']);
    });

    it('a row with no address at all projects NO circleAddresses key', () => {
      const roster = deriveRoster({ redemptions: [redemption({ redeemedBy: 'B' })] });
      const b = roster.find((m) => m.webid === 'B');
      expect('circleAddresses' in b).toBe(false);
    });

    it('the admin (confirmedBy) row folds a set through the same gate', () => {
      const roster = deriveRoster({
        redemptions: [redemption({
          redeemedBy: 'B', confirmedBy: 'A', channel: 'peer',
          confirmedByCircleAddress: addrOf(5), confirmedByCircleAddressProof: proofOf(5),
          confirmedByCircleAddresses: [
            { address: addrOf(6), proof: proofOf(6) },
            { address: addrOf(7), proof: proofOf(3) },   // forged ⇒ refused
          ],
        })],
      });
      const a = roster.find((m) => m.webid === 'A');
      expect(a.circleAddress).toBe(addrOf(5));
      expect(a.circleAddresses).toEqual([addrOf(5), addrOf(6)]);
    });

    it('address-revoke retires an extra from the set — deny-wins over its announce', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
          redemption({ redeemedBy: 'B', circleAddress: addrOf(2), circleAddressProof: proofOf(2) }),
        ],
        spineStatements: [{ kind: 'address-revoke', author: 'B', subject: addrOf(2) }],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddress).toBe(addrOf(1));
      expect(b.circleAddresses).toEqual([addrOf(1)]);
    });

    it('the LOSS TAKEOVER: a revoked PRIMARY hands the slot to the first surviving address', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
          redemption({ redeemedBy: 'B', circleAddress: addrOf(2), circleAddressProof: proofOf(2) }),
        ],
        spineStatements: [{ kind: 'address-revoke', author: 'B', subject: addrOf(1) }],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b.circleAddress, 'the surviving device takes the primary slot').toBe(addrOf(2));
      expect(b.circleAddresses).toEqual([addrOf(2)]);
    });

    it('SELF-SUBJECT: a revocation only ever acts on the AUTHOR\'s own row', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
          redemption({ redeemedBy: 'C', circleAddress: addrOf(3), circleAddressProof: proofOf(3) }),
        ],
        // C tries to revoke B's address: the statement lands in C's OWN bucket and touches nothing
        spineStatements: [{ kind: 'address-revoke', author: 'C', subject: addrOf(1) }],
      });
      expect(roster.find((m) => m.webid === 'B').circleAddresses).toEqual([addrOf(1)]);
      expect(roster.find((m) => m.webid === 'C').circleAddresses).toEqual([addrOf(3)]);
    });

    it('a member whose EVERY address is revoked keeps the row, loses the address keys', () => {
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
        ],
        spineStatements: [{ kind: 'address-revoke', author: 'B', subject: addrOf(1) }],
      });
      const b = roster.find((m) => m.webid === 'B');
      expect(b, 'the MEMBER remains — only their addresses retire').toBeTruthy();
      expect('circleAddress' in b).toBe(false);
      expect('circleAddresses' in b).toBe(false);
    });

    it('maxDevicesPerMember caps the projected set — earliest devices keep their place', () => {
      const redemptions = [
        redemption({ redeemedBy: 'B', circleAddress: addrOf(1), circleAddressProof: proofOf(1) }),
        redemption({ redeemedBy: 'B', circleAddress: addrOf(2), circleAddressProof: proofOf(2) }),
        redemption({ redeemedBy: 'B', circleAddress: addrOf(3), circleAddressProof: proofOf(3) }),
      ];
      const capped = deriveRoster({ redemptions, rules: { maxDevicesPerMember: 2 } });
      expect(capped.find((m) => m.webid === 'B').circleAddresses).toEqual([addrOf(1), addrOf(2)]);
      // cap 1 = the "no multiple devices" circle: only the primary projects
      const single = deriveRoster({ redemptions, rules: { maxDevicesPerMember: 1 } });
      expect(single.find((m) => m.webid === 'B').circleAddresses).toEqual([addrOf(1)]);
      // no cap declared (or nonsense) → unlimited, exactly as before
      const open = deriveRoster({ redemptions, rules: { maxDevicesPerMember: 0 } });
      expect(open.find((m) => m.webid === 'B').circleAddresses).toEqual([addrOf(1), addrOf(2), addrOf(3)]);
    });
  });

  // ── The membership SPINE folds DENY-WINS on top of the trail head (the safe cutover) ──────────────────
  describe('spine fold (deny-wins over the trail head)', () => {
    const stmt = (id, kind, subject) => signSpine(id, { kind, circleId: 'g1', subject }).body;

    it('a valid evict on the spine DROPS a trail member; the rest of the trail stands', async () => {
      // The webid==key namespace the fold needs: everyone is keyed by their signing pubKey.
      const founder = await AgentIdentity.generate(new VaultMemory());
      const bea = await AgentIdentity.generate(new VaultMemory());
      const cor = await AgentIdentity.generate(new VaultMemory());
      const roster = deriveRoster({
        redemptions: [
          redemption({ redeemedBy: bea.pubKey, signingPublicKey: bea.pubKey }),
          redemption({ redeemedBy: cor.pubKey, signingPublicKey: cor.pubKey }),
        ],
        founderWebids: [founder.pubKey],
        spineStatements: [stmt(founder, 'evict', bea.pubKey)],   // founder (admin) evicts bea
      });
      const ids = roster.map((m) => m.webid).sort();
      expect(ids).toContain(founder.pubKey);
      expect(ids).toContain(cor.pubKey);
      expect(ids).not.toContain(bea.pubKey);
    });

    it('the AUTHORITATIVE fold admits a folded-in member ahead of their trail row (the rider cutover)', async () => {
      // The membership-rider cutover: the statements handed to deriveRoster are VERIFIED with their key-ref
      // bindings resolved (the rail's read / the store path's resolver) — unverifiable/foreign statements
      // are dropped BEFORE the fold (see circleScopedSpineSigner: a forged binding never reaches here), so
      // the fold itself is authoritative: a verified join adds the member, with a minimal row until the
      // trail backfills display fields. The old strengthen-only interim (foreign joins ignored at the fold)
      // is retired with the signer settlement.
      const joiner = await AgentIdentity.generate(new VaultMemory());
      const roster = deriveRoster({
        redemptions: [redemption({ redeemedBy: 'B' })],
        spineStatements: [stmt(joiner, 'join', 'NEW-MEMBER')],
        foldAuthoritative: true,
      });
      expect(roster.map((m) => m.webid).sort()).toEqual(['B', 'NEW-MEMBER']);   // admitted, B kept
    });
  });
});
