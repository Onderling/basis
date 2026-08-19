// appSealResolver.test.js — app-level proof for the seal resolver + the bound membership record.
//
//   • the seal resolver seals circle content ONCE by the policy-named scheme, a member opens it, a
//     non-member cannot (group-key), and a per-resource-CEK share round-trips (node crypto, seconds);
//   • the ONE bound membership record binds a member's three key spaces (signing / circle-address /
//     sealing) so a membership op moves all three together — and `circleMemberActors` now sources the
//     SIGNING key from THAT record, closing the "present for sealing/address, unresolved for signing" gap.
//
// The two-agent cases run over the real `pairRealAgents` node harness (real app agents, real circle join,
// in-process transport — no browser / relay / network).
import { describe, it, expect } from 'vitest';
import {
  SEAL_SCHEMES, sealForAudience, openSealedEnvelope, buildGroupKeyResource, generateKeypair, generateGroupKey,
} from '@onderling/pod-client';
import { membershipRecord, membershipRecords, keyspacesBound } from '@onderling-app/stoop/lib/membershipRecord';
import { circleMemberActors } from '../src/v2/circleMemberActors.js';
import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, readRoster, teardown,
} from './support/pairRealAgents.js';

describe('seal resolver — circle content sealed once, opened by scheme', () => {
  it('a member opens the group-key content; a non-member is denied', () => {
    const anne = generateKeypair();
    const bob = generateKeypair();
    const stranger = generateKeypair();
    const resource = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: [anne.publicKey, bob.publicKey],
    });
    const env = sealForAudience('welkom in de circle', { resource, privateKey: anne.privateKey }, { audience: 'circle' });
    expect(env.scheme).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(openSealedEnvelope(env, { resource, privateKey: bob.privateKey })).toBe('welkom in de circle');
    expect(() => openSealedEnvelope(env, { resource, privateKey: stranger.privateKey })).toThrow();
  });

  it('a scoped share resolves to a per-resource CEK and round-trips under it', () => {
    const env = sealForAudience('scoped note', { resourceId: 'note-1' }, { share: 'scoped' });
    expect(env.scheme).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
    expect(openSealedEnvelope(env, { cek: env.cek })).toBe('scoped note');
  });
});

describe('bound membership record — three key spaces move as one', () => {
  it('binds signing / circle-address / sealing from ONE row, and a membership op drops all three together', () => {
    // A roster row for a sealed circle carries all three key spaces on the SAME record.
    const roster = [
      { webid: 'a', role: 'admin', pubKey: 'sign-a', circleAddress: 'addr-a', sealingPublicKey: 'seal-a' },
      { webid: 'b', role: 'member', pubKey: 'sign-b', circleAddress: 'addr-b', sealingPublicKey: 'seal-b' },
    ];
    const recs = membershipRecords(roster);
    expect(recs.map((r) => r.webid)).toEqual(['a', 'b']);
    expect(recs.every(keyspacesBound)).toBe(true);
    expect(membershipRecord(roster[1])).toEqual({
      webid: 'b', role: 'member', signingPubKey: 'sign-b', circleAddress: 'addr-b', sealingPubKey: 'seal-b',
    });

    // A membership op (b removed) acts on the ONE record → b's signing, address AND sealing all vanish
    // together. No lingering signing actor while the sealing key rotates: there is no separate store.
    const afterRemove = membershipRecords(roster.filter((m) => m.webid !== 'b'));
    const bStill = afterRemove.find((r) => r.webid === 'b');
    expect(bStill).toBeUndefined();
    const bound = afterRemove.flatMap((r) => [r.signingPubKey, r.circleAddress, r.sealingPubKey]);
    expect(bound).not.toContain('sign-b');
    expect(bound).not.toContain('addr-b');
    expect(bound).not.toContain('seal-b');
  });

  it('circleMemberActors sources the signing key from the bound record even when the MemberMap is EMPTY', async () => {
    // The exact drift this closes: signing used to come only from the lossy MemberMap, so a member present
    // in the trail (bound for sealing/address) read as "unresolved" for signing when the cache was cold.
    const roster = [
      { webid: 'a', pubKey: 'sign-a', circleAddress: 'addr-a', sealingPublicKey: 'seal-a' },
      { webid: 'b', pubKey: 'sign-b', circleAddress: 'addr-b', sealingPublicKey: 'seal-b' },
    ];
    const emptyMemberMap = { resolveByWebid: async () => null }; // cold cache
    const { actors, unresolved } = await circleMemberActors(emptyMemberMap, roster);
    expect(actors.sort()).toEqual(['sign-a', 'sign-b']);
    expect(unresolved).toBe(0); // previously would have been 2 (all unresolved)
  });
});

describe('bound membership record — over a REAL circle join (pairRealAgents)', () => {
  it('a real roster row binds signing + circle-address on ONE record, and the signing actor resolves from it', async () => {
    const admin = await bootRealAgentNode('admin');
    const joiner = await bootRealAgentNode('joiner');
    try {
      await connectAgentsOverBus(admin, joiner);
      const { groupId } = await pairCircle(admin, joiner);
      const roster = await readRoster(admin, groupId);
      expect(roster.length).toBe(2);

      // Every member's signing key + circle address come from the SAME bound record (the trail row).
      for (const row of roster) {
        const rec = membershipRecord(row);
        expect(rec.signingPubKey).toBe(row.pubKey);
        expect(rec.circleAddress).toBe(row.circleAddress);
        expect(rec.signingPubKey).toBeTruthy();
        expect(rec.circleAddress).toBeTruthy();
      }

      // circleMemberActors resolves the signing actors straight from that bound record — no dependence on a
      // second (MemberMap) lookup landing. With an empty cache the actors still come out of the ONE record.
      const { actors, unresolved } = await circleMemberActors({ resolveByWebid: async () => null }, roster);
      expect(actors.sort()).toEqual(roster.map((r) => r.pubKey).sort());
      expect(unresolved).toBe(0);
    } finally {
      await teardown(admin, joiner);
    }
  }, 30000);
});
