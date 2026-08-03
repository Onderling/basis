/**
 * grants-over-Peer — DURABILITY of the grant registry (P0.3).
 *
 * The façade kept its grants in an in-process `Map`. Everything worked until the process ended, and then:
 *   • `mayDecrypt(peer, resourceId)` denies a peer who still HOLDS a valid, unexpired token — the token is
 *     real, the registry just forgot about it;
 *   • `effectiveAudience` / `effectiveSealingKeys` silently under-report, so the next re-seal of a scoped
 *     resource drops the grantee out of the audience. That is the quiet half: nobody sees an error, a
 *     person just stops being able to open something they were granted.
 * Both are the "second operation invalidates the first" shape this corpus keeps finding, with a restart
 * playing the part of the second operation.
 *
 * The seam is deliberately small: `persist(records)` after every mutation, `hydrateGrants` to load. The
 * factory stays SYNCHRONOUS and storage-free (invariant 5/7) — loading is the caller's async concern, and
 * the module never learns what a disk is.
 *
 * Real identities, a real TokenRegistry and a real CEK broker, as in `grantsOverPeer.test.js`.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, TaskGrantManager, TokenRegistry } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createResourceKeyGrant, generateKeypair } from '../src/sealing/index.js';
import { createGrantsOverPeer, GRANT_MODE, serializeGrants, hydrateGrants } from '../src/grants/index.js';

const POD = 'https://pod.example/alice/';
const RESOURCE = 'urn:res:plan';

/** A stand-in for whatever a consumer actually persists to — captures the last written snapshot. */
function fakeStore() {
  let saved = null;
  return {
    writes: 0,
    persist(records) { this.writes += 1; saved = JSON.stringify(records); },
    load() { return saved; },
    raw: () => saved,
  };
}

async function bootFacade({ store, grants, now } = {}) {
  const granter = await AgentIdentity.generate(new VaultMemory());
  const tokenRegistry = new TokenRegistry(new VaultMemory());
  const resourceBroker = createResourceKeyGrant({ identity: granter, tokenRegistry });
  // A CEK grant is only issuable for a resource the broker has sealed — seal it up front so every test
  // below is about DURABILITY rather than about broker setup.
  resourceBroker.sealResource(RESOURCE, 'geheim');
  return {
    granter, resourceBroker,
    facade: createGrantsOverPeer({
      identity: granter, podRoot: POD, tokenRegistry, resourceBroker,
      taskGrants: new TaskGrantManager({ identity: granter, agentId: granter.pubKey }),
      grants, now,
      persist: store ? (recs) => store.persist(recs) : null,
    }),
  };
}

async function makePeer() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const seal = generateKeypair();
  return { pubKey: id.pubKey, sealingPublicKey: seal.publicKey };
}

describe('the grant registry survives a restart', () => {
  it('a grant persisted before the restart is still live after it', async () => {
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    const bram = await makePeer();

    await facade.grant(bram, RESOURCE, { policy: { offline: true } });
    expect(store.writes).toBe(1);                                  // persisted at the moment of granting
    expect(facade.mayDecrypt(bram.pubKey, RESOURCE)).toBe(true);

    // ── the process ends and comes back ──────────────────────────────────────
    const { facade: afterRestart } = await bootFacade({ grants: hydrateGrants(store.load()) });

    expect(afterRestart.mayDecrypt(bram.pubKey, RESOURCE)).toBe(true);
    expect(afterRestart.liveGrants(RESOURCE)).toHaveLength(1);
    expect(afterRestart.liveGrants(RESOURCE)[0].peerPubKey).toBe(bram.pubKey);
  });

  it('WITHOUT persistence the same restart forgets — the bug this closes', async () => {
    // The control that keeps the test above honest: it must be persistence doing the work, not the harness.
    const { facade } = await bootFacade({});
    const bram = await makePeer();
    await facade.grant(bram, RESOURCE, { policy: { offline: true } });

    const { facade: afterRestart } = await bootFacade({});          // nothing carried over
    expect(afterRestart.mayDecrypt(bram.pubKey, RESOURCE)).toBe(false);
  });

  it('the SEAL-SIDE audience survives too — a re-seal after a restart still includes the grantee', async () => {
    // The quiet failure: no error, the grantee simply drops out of the next audience and stops being able
    // to open the resource. This is what `effectiveSealingKeys` feeds.
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    const bram = await makePeer();
    await facade.grant(bram, RESOURCE, { policy: { offline: true } });

    const { facade: afterRestart } = await bootFacade({ grants: hydrateGrants(store.load()) });
    const keys = afterRestart.effectiveSealingKeys([], RESOURCE, { scheme: 'per-resource-cek' });
    expect(keys).toContain(bram.sealingPublicKey);
  });

  it('a REVOKE is persisted too — a restart must not resurrect it', async () => {
    // The dangerous direction. If only grants were persisted, a restart would restore access that had been
    // deliberately taken away.
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    const bram = await makePeer();
    const { grantId } = await facade.grant(bram, RESOURCE, { policy: { offline: true } });
    await facade.revoke(grantId);

    const { facade: afterRestart } = await bootFacade({ grants: hydrateGrants(store.load()) });
    expect(afterRestart.mayDecrypt(bram.pubKey, RESOURCE)).toBe(false);
    expect(afterRestart.liveGrants(RESOURCE)).toEqual([]);
  });

  it('an EXPIRED grant does not come back to life across a restart', async () => {
    const store = fakeStore();
    // Anchored to the REAL clock: a token's `expiresAt` is stamped by the issuer with `Date.now()`, so a
    // synthetic epoch (1_000) would sit far in its past and nothing would ever look expired.
    let clock = Date.now();
    const { facade } = await bootFacade({ store, now: () => clock });
    const bram = await makePeer();
    await facade.grant(bram, RESOURCE, { policy: { offline: true }, expiresIn: 60 });
    expect(facade.mayDecrypt(bram.pubKey, RESOURCE)).toBe(true);

    clock += 10_000_000;                                            // well past expiry
    const { facade: afterRestart } = await bootFacade({
      store, grants: hydrateGrants(store.load()), now: () => clock,
    });
    expect(afterRestart.mayDecrypt(bram.pubKey, RESOURCE)).toBe(false);
    expect(afterRestart.liveGrants(RESOURCE)).toEqual([]);
  });
});

describe('the persistence seam is honest about its own failures', () => {
  it('a store that THROWS does not fail the grant — the token was already issued', async () => {
    // Reporting failure here would be the bigger lie: the grantee holds a real, working token whatever the
    // disk did. The grant stands; durability is the thing that degraded.
    const granter = await AgentIdentity.generate(new VaultMemory());
    const tokenRegistry = new TokenRegistry(new VaultMemory());
    const resourceBroker = createResourceKeyGrant({ identity: granter, tokenRegistry });
    resourceBroker.sealResource(RESOURCE, 'geheim');
    const facade = createGrantsOverPeer({
      identity: granter, podRoot: POD, tokenRegistry, resourceBroker,
      persist: () => { throw new Error('disk full'); },
    });
    const bram = await makePeer();

    const res = await facade.grant(bram, RESOURCE, { policy: { offline: true } });
    expect(res.grantId).toBeTruthy();
    expect(facade.mayDecrypt(bram.pubKey, RESOURCE)).toBe(true);     // in-memory truth is unaffected
  });

  it('a CORRUPT store degrades to fewer grants, never to a crash', async () => {
    // Fails CLOSED: a peer is denied and re-asks. A throw at construction would take the whole agent down
    // on a truncated file, which is a far worse failure than a forgotten grant.
    for (const junk of ['not json at all', '{"not":"an array"}', '[{"no":"grantId"}]', null, undefined, '[]']) {
      const map = hydrateGrants(junk);
      expect(map instanceof Map).toBe(true);
      expect(map.size).toBe(0);
    }
  });

  it('serialize → hydrate is a faithful round-trip through JSON', async () => {
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    const [bram, cato] = await Promise.all([makePeer(), makePeer()]);
    await facade.grant(bram, RESOURCE, { policy: { offline: true } });
    await facade.grant(cato, RESOURCE, { policy: { offline: true } });

    const back = hydrateGrants(store.load());
    expect(back.size).toBe(2);
    expect(serializeGrants(back)).toEqual(JSON.parse(store.raw()));
    for (const rec of back.values()) {
      expect(rec.grantId).toBeTruthy();
      expect(rec.mode).toBe(GRANT_MODE.CEK);
      expect(rec.resourceId).toBe(RESOURCE);
    }
  });

  it('the persisted record carries NO key material — a stolen registry file grants nobody anything', async () => {
    // What is on disk is bookkeeping: who, what, which mode, when it expires. The token lives with the
    // grantee and its revocation lives in the TokenRegistry.
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    const bram = await makePeer();
    await facade.grant(bram, RESOURCE, { policy: { offline: true } });

    const blob = store.raw();
    expect(blob).toContain(bram.pubKey);                 // the grantee IS named — that is the point

    // Assert the exact FIELD SET rather than scanning for suspicious substrings: a substring scan gives
    // false positives (the mode is literally called `per-resource-cek`) and false confidence (it only
    // catches the words someone thought of). A new field cannot slip in unnoticed this way.
    // (`task` is absent here: it is undefined for a resource grant, and JSON drops undefined — which is
    // also why `hydrateGrants` must tolerate a missing field rather than assume a fixed shape.)
    const [rec] = JSON.parse(blob);
    expect(Object.keys(rec).sort()).toEqual([
      'circleId', 'expiresAt', 'grantId', 'kind', 'mode', 'peerPubKey', 'resourceId', 'scope',
      'sealingPublicKey',
    ]);
    // Every retained field is a public identifier or bookkeeping — `sealingPublicKey` is a PUBLIC key, and
    // the wrapped CEK itself stays with the broker, never here.
    expect(rec.sealingPublicKey).toBe(bram.sealingPublicKey);
  });
});

describe('pruneExpired keeps a durable store from growing forever', () => {
  it('drops only the expired, persists once, and changes no decision', async () => {
    const store = fakeStore();
    let clock = Date.now();                                          // see the note above on anchoring
    const { facade } = await bootFacade({ store, now: () => clock });
    const [bram, cato] = await Promise.all([makePeer(), makePeer()]);
    await facade.grant(bram, RESOURCE, { policy: { offline: true }, expiresIn: 60 });
    // NOTE: a grant with no `expiresIn` is NOT eternal — the token carries a DEFAULT expiry (an hour). So
    // the durable registry self-limits: nothing outlives its token, and this jump is sized to land between
    // the two rather than past both.
    await facade.grant(cato, RESOURCE, { policy: { offline: true } });
    expect([...hydrateGrants(store.load()).values()].every((r) => r.expiresAt != null)).toBe(true);

    clock += 300_000;                                                // 5 min: past Bram's, inside Cato's
    expect(facade.liveGrants(RESOURCE)).toHaveLength(1);            // already ignored before pruning…
    const writesBefore = store.writes;
    expect(await facade.pruneExpired()).toBe(1);
    expect(store.writes).toBe(writesBefore + 1);

    // …and the surviving grant is untouched: pruning is housekeeping, not a policy change.
    expect(facade.mayDecrypt(cato.pubKey, RESOURCE)).toBe(true);
    expect(facade.mayDecrypt(bram.pubKey, RESOURCE)).toBe(false);
    expect(hydrateGrants(store.load()).size).toBe(1);
  });

  it('pruning nothing writes nothing — no pointless churn on a quiet store', async () => {
    const store = fakeStore();
    const { facade } = await bootFacade({ store });
    await facade.grant(await makePeer(), RESOURCE, { policy: { offline: true } });
    const writes = store.writes;
    expect(await facade.pruneExpired()).toBe(0);
    expect(store.writes).toBe(writes);
  });
});
