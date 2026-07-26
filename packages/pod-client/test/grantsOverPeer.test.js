// grants-over-Peer — the ONE grant surface (connectivity Phase 4 §4, Wave B tail).
//
// Exercises the façade against the REAL primitives it composes — real Ed25519 identities, a real
// vault-backed TokenRegistry, a real resourceKeyGrant broker, real PodCapabilityToken / TaskGrant
// issuance — so this proves the composition, not a set of stubs. Decisions D1–D7 in
// plans/NOTE-grants-over-peer.md.
import { describe, it, expect } from 'vitest';
import { AgentIdentity, TaskGrantManager, TokenRegistry, PodCapabilityToken, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createResourceKeyGrant, resourceScope, generateKeypair, SEAL_SCHEMES } from '../src/sealing/index.js';
import { createGrantsOverPeer, GRANT_MODE, assertScopedScheme, SCOPED_SEAL_SCHEMES } from '../src/grants/index.js';

const POD = 'https://pod.example/alice/';

async function setup({ isMember } = {}) {
  const granter       = await AgentIdentity.generate(new VaultMemory());
  const tokenRegistry = new TokenRegistry(new VaultMemory());
  const resourceBroker = createResourceKeyGrant({ identity: granter, tokenRegistry });
  const taskGrants    = new TaskGrantManager({ identity: granter, agentId: granter.pubKey });
  const facade = createGrantsOverPeer({
    identity: granter, podRoot: POD, resourceBroker, taskGrants, tokenRegistry,
    isMember: isMember ?? (() => false),
  });
  return { granter, tokenRegistry, resourceBroker, taskGrants, facade };
}

async function makePeer() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const seal = generateKeypair();
  return { pubKey: id.pubKey, sealingPublicKey: seal.publicKey, _seal: seal };
}

describe('grantsOverPeer — resource grant, DEFAULT = broker (D1)', () => {
  it('issues a scoped res.read PodCapabilityToken bound to the grantee; key never leaves', async () => {
    const { facade } = await setup();
    const peer = await makePeer();
    const { grantId, token, mode } = await facade.grant(peer, 'note-42');

    expect(mode).toBe(GRANT_MODE.BROKER);
    expect(token).toBeInstanceOf(PodCapabilityToken);
    expect(token.subject).toBe(peer.pubKey);               // bound to this grantee (no theft/forwarding)
    expect(token.scopes).toContain(resourceScope('note-42'));  // exactly res.read:note-42, one grain
    expect(PodCapabilityToken.verify(token, POD)).toBe(true);
    expect(grantId).toBe(token.id);
  });

  it('mayDecrypt is true for the grantee, false for a stranger, false after revoke', async () => {
    const { facade } = await setup();
    const peer = await makePeer();
    const stranger = await makePeer();
    const { grantId } = await facade.grant(peer, 'note-42');

    expect(facade.mayDecrypt(peer.pubKey, 'note-42')).toBe(true);
    expect(facade.mayDecrypt(stranger.pubKey, 'note-42')).toBe(false);
    expect(facade.mayDecrypt(peer.pubKey, 'note-99')).toBe(false);   // grant is per-resource, not blanket

    await facade.revoke(grantId);
    expect(facade.mayDecrypt(peer.pubKey, 'note-42')).toBe(false);
  });

  it('a circle member always mayDecrypt (reads via the group key), no grant needed', async () => {
    const member = await makePeer();
    const { facade } = await setup({ isMember: (pk) => pk === member.pubKey });
    expect(facade.mayDecrypt(member.pubKey, 'any-resource')).toBe(true);
  });
});

describe('grantsOverPeer — resource grant, OFFLINE opt-in = per-resource CEK (D1)', () => {
  it('issues a CEK grant the broker accepts, and DENIES it after revoke (D4)', async () => {
    const { facade, resourceBroker } = await setup();
    const peer = await makePeer();
    resourceBroker.sealResource('doc-7', 'geheim');        // seal the resource under a fresh CEK first

    const { grantId, token, mode } = await facade.grant(peer, 'doc-7', { policy: { offline: true } });
    expect(mode).toBe(GRANT_MODE.CEK);
    expect(token).toBeInstanceOf(CapabilityToken);
    expect(token.skill).toBe(resourceScope('doc-7'));

    // The grant is REAL + usable: the broker releases the wrapped CEK to the bound grantee.
    const ok = await resourceBroker.releaseKey({
      token, requesterPubKey: peer.pubKey, resourceId: 'doc-7', requesterSealPubKey: peer.sealingPublicKey,
    });
    expect(ok.wrappedKey).toBeTruthy();

    // After the façade revokes, the SAME release is denied (registry-revoked).
    await facade.revoke(grantId);
    const denied = await resourceBroker.releaseKey({
      token, requesterPubKey: peer.pubKey, resourceId: 'doc-7', requesterSealPubKey: peer.sealingPublicKey,
    });
    expect(denied.denied).toBe(true);
    expect(denied.reason).toBe('revoked');
  });

  it('an offline grant with no broker wired throws (no silent downgrade)', async () => {
    const granter = await AgentIdentity.generate(new VaultMemory());
    const facade = createGrantsOverPeer({ identity: granter, podRoot: POD });   // no resourceBroker
    const peer = await makePeer();
    await expect(facade.grant(peer, 'doc-7', { policy: { offline: true } })).rejects.toThrow(/broker is required/);
  });
});

describe('grantsOverPeer — mandate (skill scope, task-bound) → TaskGrant', () => {
  it('delegates to TaskGrant and auto-revokes on task revoke', async () => {
    const { facade } = await setup();
    const peer = await makePeer();
    const { token, mode, grantId } = await facade.grant(peer, 'calendar.write', { kind: 'skill', task: 'task-1' });

    expect(mode).toBe(GRANT_MODE.MANDATE);
    expect(token.subject).toBe(peer.pubKey);
    expect(token.skill).toBe('calendar.write');
    expect(token.constraints?.task).toBe('task-1');        // TaskGrant stamps provenance

    const res = await facade.revoke({ task: 'task-1' });
    expect(res.revoked).toContain(grantId);
  });

  it('a skill grant with no task throws (a mandate must be task-bound)', async () => {
    const { facade } = await setup();
    const peer = await makePeer();
    await expect(facade.grant(peer, 'calendar.write', { kind: 'skill' })).rejects.toThrow(/task id is required/);
  });
});

describe('grantsOverPeer — effectiveAudience (D2: extend the SCOPED base only)', () => {
  const PAIRWISE = { scheme: SEAL_SCHEMES.PAIRWISE };

  it('unions the scoped base with the resource grantees, deduped by pubKey', async () => {
    const { facade } = await setup();
    const base = await makePeer();      // an existing scoped recipient (e.g. a pairwise share)
    const grantee = await makePeer();
    await facade.grant(grantee, 'note-42');

    const audience = facade.effectiveAudience([{ pubKey: base.pubKey, sealingPublicKey: base.sealingPublicKey }], 'note-42', PAIRWISE);
    const keys = audience.map((a) => a.pubKey);
    expect(keys).toContain(base.pubKey);        // base preserved
    expect(keys).toContain(grantee.pubKey);     // grantee added
    expect(keys.length).toBe(2);

    // A grantee already in the base is not duplicated.
    const audience2 = facade.effectiveAudience([{ pubKey: grantee.pubKey }], 'note-42', PAIRWISE);
    expect(audience2.map((a) => a.pubKey)).toEqual([grantee.pubKey]);

    // A different resource's audience does NOT pick up note-42's grantee (per-resource isolation).
    expect(facade.effectiveAudience([], 'note-99', PAIRWISE)).toEqual([]);
  });

  it('accepts the per-resource-CEK scheme too (the other scoped one)', async () => {
    const { facade, resourceBroker } = await setup();
    const grantee = await makePeer();
    resourceBroker.sealResource('doc-7', 'geheim');
    await facade.grant(grantee, 'doc-7', { policy: { offline: true } });

    const audience = facade.effectiveAudience([], 'doc-7', { scheme: SEAL_SCHEMES.PER_RESOURCE_CEK });
    expect(audience.map((a) => a.pubKey)).toEqual([grantee.pubKey]);
    expect(SCOPED_SEAL_SCHEMES).toEqual([SEAL_SCHEMES.PAIRWISE, SEAL_SCHEMES.PER_RESOURCE_CEK]);
  });
});

describe('grantsOverPeer — D2 is ENFORCED (a grant can never widen a group-key audience)', () => {
  it('REFUSES to extend a group-key audience, naming the reason', async () => {
    const { facade } = await setup();
    const grantee = await makePeer();
    await facade.grant(grantee, 'note-42');
    expect(() => facade.effectiveAudience([], 'note-42', { scheme: SEAL_SCHEMES.GROUP_KEY }))
      .toThrow(/GROUP-KEY audience \(D2\)/);
  });

  it('refuses a group-key audience resolved from POLICY too (not just an explicit scheme)', async () => {
    const { facade } = await setup();
    // `audience:'circle'` and posture p2 both resolve to group-key via the one resolver.
    expect(() => facade.effectiveAudience([], 'note-42', { policy: { audience: 'circle' } })).toThrow(/GROUP-KEY/);
    expect(() => facade.effectiveAudience([], 'note-42', { policy: { posture: 'p2' } })).toThrow(/GROUP-KEY/);
    // …while a scoped policy resolves fine (p3 → pairwise, revocable → per-resource-CEK).
    expect(facade.effectiveAudience([], 'note-42', { policy: { posture: 'p3' } })).toEqual([]);
    expect(facade.effectiveAudience([], 'note-42', { policy: { revocable: true } })).toEqual([]);
  });

  it('fails CLOSED when no scheme is supplied (a forgetful caller cannot silently widen)', async () => {
    const { facade } = await setup();
    expect(() => facade.effectiveAudience([], 'note-42')).toThrow(/no seal scheme resolved/);
    expect(() => facade.effectiveAudience([], 'note-42', {})).toThrow(/no seal scheme resolved/);
  });

  it('refuses unsealed (p0/p1) content and the sealed-forward delivery scheme', async () => {
    const { facade } = await setup();
    expect(() => facade.effectiveAudience([], 'note-42', { policy: { posture: 'p0' } })).toThrow(/no seal scheme resolved/);
    expect(() => facade.effectiveAudience([], 'note-42', { scheme: SEAL_SCHEMES.SEALED_FORWARD }))
      .toThrow(/delivery scheme, not an at-rest audience/);
  });

  it('assertScopedScheme is exported standalone and admits exactly the two scoped schemes', () => {
    expect(assertScopedScheme(SEAL_SCHEMES.PAIRWISE)).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(assertScopedScheme(SEAL_SCHEMES.PER_RESOURCE_CEK)).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
    expect(() => assertScopedScheme('nonsense')).toThrow(/unknown seal scheme/);
  });
});
