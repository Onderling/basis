/**
 * commons-governance G3 — federation + moderation: circle-scoped, admin-gated
 * COMMUNITY catalogues, SUBSCRIBE, expiresAt lapse, revoke, and fork/exit.
 *
 * These tests assert RESULTS from a SUBSCRIBER's point of view (what appears in
 * their derived catalogue) over REAL primitives:
 *   • Ed25519 `AgentIdentity` (no crypto mock),
 *   • the real `createCommunityCatalogue` over an in-memory pseudo-pod,
 *   • the REAL circle-policy gate — `@onderling/circles` `inAudience('role:admin')`
 *     over the circle's roster (we do NOT invent a parallel admin check),
 *   • the real `createCatalogueSource` / `walkTrustGraph` web-of-trust walk.
 *
 *   ADMIN-GATED WRITE · SUBSCRIBE/unsubscribe · FEDERATION UNION (+ WoT within
 *   a community) · EXPIRES/LAPSE · REVOKE · FORK/exit.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { inAudience }    from '@onderling/circles';
import { VaultMemory }   from '../../vault/src/VaultMemory.js';

import {
  issueEndorsement,
  createCommunityCatalogue,
  createCommunitySubscriptions,
  createCatalogueSource,
} from '../index.js';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

function agentCard(pubKey, { id, role = 'service', skills = ['summarise.thread'] } = {}) {
  return {
    name: id, description: `agent ${id}`,
    url: `https://example.invalid/agents/${id}`, version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role },
  };
}
function curatorCard(pubKey, { id } = {}) {
  return { name: id, url: `https://example.invalid/curators/${id}`, version: '1.0', skills: [], 'x-onderling': { id, pubKey, role: 'curator' } };
}

/** An in-memory pseudo-pod (etag-CAS honoured by createEndorsementResource). */
function memPod() {
  const map = new Map();
  return {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: String(map.get(uri)?.updatedAt ?? '') } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: String(body?.updatedAt ?? '') }; },
  };
}

/**
 * A circle is just a roster: `{ id, roles: { admin: [pubKey...] } }`. The gate
 * we wire into the community catalogue is the REAL circles audience resolver —
 * exactly the `by ∈ admins` check the share policy uses.
 */
function circleAdminGate(circle) {
  return (endorserPubKey) => inAudience(endorserPubKey, 'role:admin', { roleMembers: circle.roles });
}

/** A card registry shared by the community + the walk's resolveCard. */
function cardBook() {
  const cards = new Map();
  return {
    set(identity, card) { cards.set(identity.pubKey, card); return identity; },
    swap(pubKey, card)  { cards.set(pubKey, card); },
    resolveCard: (subject) => cards.get(subject) ?? null,
  };
}

const idsOf = (list) => list.map((c) => c['x-onderling'].id);

/* ── 1. ADMIN-GATED WRITE ──────────────────────────────────────────────── */
describe('G3 — the community catalogue write is gated to circle admins', () => {
  it('an ADMIN endorsement is accepted + appears; a NON-admin write is REJECTED', async () => {
    const adminId   = await makeIdentity();
    const strangerId = await makeIdentity();
    const agentId   = await makeIdentity();
    const books = cardBook();
    books.set(agentId, agentCard(agentId.pubKey, { id: 'catalogue:A' }));

    const circle = { id: 'circleC', roles: { admin: [adminId.pubKey] } };
    const community = createCommunityCatalogue({
      circleId: 'circleC', isAdmin: circleAdminGate(circle),
      pseudoPod: memPod(), deviceId: 'host-node',
    });

    // Admin endorses → accepted.
    const good = issueEndorsement(adminId, { card: books.resolveCard(agentId.pubKey) });
    await community.endorse(good);

    // A stranger signs a well-formed endorsement of the SAME agent → REJECTED
    // (the circle policy is the gate — not who signs the record, but whether
    // that signer is a circle admin).
    const bad = issueEndorsement(strangerId, { card: books.resolveCard(agentId.pubKey) });
    await expect(community.endorse(bad)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const listed = await community.list();
    expect(listed.map((e) => e.endorser)).toEqual([adminId.pubKey]);   // only the admin's survives
  });
});

/* ── 2. SUBSCRIBE / unsubscribe ────────────────────────────────────────── */
describe('G3 — subscribe: a community\'s admins become the subscriber\'s curator roots', () => {
  it('subscribing to C surfaces C\'s admin-endorsed agents; unsubscribe removes them', async () => {
    const adminId = await makeIdentity();
    const agentId = await makeIdentity();
    const books = cardBook();
    books.set(agentId, agentCard(agentId.pubKey, { id: 'catalogue:A' }));

    const circle = { id: 'circleC', roles: { admin: [adminId.pubKey] } };
    const community = createCommunityCatalogue({ circleId: 'circleC', isAdmin: circleAdminGate(circle), pseudoPod: memPod(), deviceId: 'host' });
    await community.endorse(issueEndorsement(adminId, { card: books.resolveCard(agentId.pubKey) }));

    const subs = createCommunitySubscriptions({
      resolveCommunity: (id) => id === 'circleC' ? { admins: [adminId.pubKey], list: community.list } : null,
    });
    const catalogue = createCatalogueSource({
      roots: () => subs.roots(),                        // live thunk
      resolveEndorsements: (pk) => subs.resolveEndorsements(pk),
      resolveCard: books.resolveCard,
    });

    expect(idsOf(await catalogue.list())).toEqual([]);    // not subscribed yet → nothing
    subs.subscribe('circleC');
    expect(idsOf(await catalogue.list())).toEqual(['catalogue:A']);   // joined → C's curation appears
    subs.unsubscribe('circleC');
    expect(idsOf(await catalogue.list())).toEqual([]);    // left → curation drops out
  });
});

/* ── 3. FEDERATION UNION (+ WoT within a community) ────────────────────── */
describe('G3 — federation: subscribing to two communities UNIONS their catalogues', () => {
  it('unions C + D; the web-of-trust walk still applies within a community\'s admin roots', async () => {
    const cAdmin = await makeIdentity();
    const dAdmin = await makeIdentity();
    const curatorX = await makeIdentity();   // C's admin vouches for curator X (transitive WoT)
    const agC = await makeIdentity();         // C admin → agC directly (depth 1)
    const agX = await makeIdentity();         // curator X → agX (depth 2 within C)
    const agD = await makeIdentity();         // D admin → agD directly

    const books = cardBook();
    books.set(curatorX, curatorCard(curatorX.pubKey, { id: 'curatorX' }));
    books.set(agC, agentCard(agC.pubKey, { id: 'catalogue:C1' }));
    books.set(agX, agentCard(agX.pubKey, { id: 'catalogue:C2' }));
    books.set(agD, agentCard(agD.pubKey, { id: 'catalogue:D1' }));

    const circleC = { id: 'C', roles: { admin: [cAdmin.pubKey] } };
    const circleD = { id: 'D', roles: { admin: [dAdmin.pubKey] } };
    const commC = createCommunityCatalogue({ circleId: 'C', isAdmin: circleAdminGate(circleC), pseudoPod: memPod(), deviceId: 'nodeC' });
    const commD = createCommunityCatalogue({ circleId: 'D', isAdmin: circleAdminGate(circleD), pseudoPod: memPod(), deviceId: 'nodeD' });

    await commC.endorse(issueEndorsement(cAdmin, { card: books.resolveCard(agC.pubKey) }));         // C: admin → agC
    await commC.endorse(issueEndorsement(cAdmin, { card: books.resolveCard(curatorX.pubKey) }));     // C: admin → curator X
    await commD.endorse(issueEndorsement(dAdmin, { card: books.resolveCard(agD.pubKey) }));         // D: admin → agD

    // Curator X's OWN endorsement (of agX) lives in X's personal pod — the
    // transitive-WoT fallback resolver. Only reachable because C's admin
    // vouched for X (WITHIN C's admin roots).
    const personal = new Map([[curatorX.pubKey, [issueEndorsement(curatorX, { card: books.resolveCard(agX.pubKey) })]]]);

    const subs = createCommunitySubscriptions({
      resolveCommunity: (id) => id === 'C' ? { admins: [cAdmin.pubKey], list: commC.list }
                              : id === 'D' ? { admins: [dAdmin.pubKey], list: commD.list } : null,
      resolveEndorsements: (pk) => personal.get(pk) ?? [],
    });
    const catalogue = createCatalogueSource({ roots: () => subs.roots(), resolveEndorsements: (pk) => subs.resolveEndorsements(pk), resolveCard: books.resolveCard });

    subs.subscribe('C');
    expect(idsOf(await catalogue.list()).sort()).toEqual(['catalogue:C1', 'catalogue:C2']);   // WoT within C: depth 1 + transitive depth 2
    subs.subscribe('D');
    expect(idsOf(await catalogue.list()).sort()).toEqual(['catalogue:C1', 'catalogue:C2', 'catalogue:D1']);   // federation union
  });
});

/* ── 4. EXPIRES / LAPSE ────────────────────────────────────────────────── */
describe('G3 — an endorsement past expiresAt LAPSES out of the subscriber\'s catalogue', () => {
  it('a recommend drops from the catalogue once now ≥ expiresAt (curation goes stale unless renewed)', async () => {
    const adminId = await makeIdentity();
    const agentId = await makeIdentity();
    const books = cardBook();
    books.set(agentId, agentCard(agentId.pubKey, { id: 'catalogue:A' }));

    const circle = { id: 'C', roles: { admin: [adminId.pubKey] } };
    const community = createCommunityCatalogue({ circleId: 'C', isAdmin: circleAdminGate(circle), pseudoPod: memPod(), deviceId: 'host' });

    const t0 = 1_000_000;
    // A short-lived endorsement issued at t0, expiring +1000ms.
    const rec = issueEndorsement(adminId, { card: books.resolveCard(agentId.pubKey), expiresIn: 1000, now: () => t0 });
    await community.endorse(rec);

    const subs = createCommunitySubscriptions({ resolveCommunity: () => ({ admins: [adminId.pubKey], list: community.list }) });
    subs.subscribe('C');

    const build = (nowMs) => createCatalogueSource({
      roots: () => subs.roots(), resolveEndorsements: (pk) => subs.resolveEndorsements(pk),
      resolveCard: books.resolveCard, now: () => nowMs,
    });

    expect(idsOf(await build(t0 + 500).list())).toEqual(['catalogue:A']);   // still fresh
    expect(idsOf(await build(t0 + 2000).list())).toEqual([]);             // lapsed → gone

    // Renewal: the admin re-endorses with a fresh expiry → back in the catalogue.
    await community.endorse(issueEndorsement(adminId, { card: books.resolveCard(agentId.pubKey), expiresIn: 1000, now: () => t0 + 2000 }));
    expect(idsOf(await build(t0 + 2500).list())).toEqual(['catalogue:A']);
  });
});

/* ── 5. REVOKE ─────────────────────────────────────────────────────────── */
describe('G3 — an admin revoke drops the endorsement from subscribers', () => {
  it('after revoke the subject disappears from the subscriber\'s catalogue; a non-admin cannot revoke', async () => {
    const adminId    = await makeIdentity();
    const strangerId = await makeIdentity();
    const agentId    = await makeIdentity();
    const books = cardBook();
    books.set(agentId, agentCard(agentId.pubKey, { id: 'catalogue:A' }));

    const circle = { id: 'C', roles: { admin: [adminId.pubKey] } };
    const community = createCommunityCatalogue({ circleId: 'C', isAdmin: circleAdminGate(circle), pseudoPod: memPod(), deviceId: 'host' });
    const rec = issueEndorsement(adminId, { card: books.resolveCard(agentId.pubKey) });
    await community.endorse(rec);

    const subs = createCommunitySubscriptions({ resolveCommunity: () => ({ admins: [adminId.pubKey], list: community.list }) });
    subs.subscribe('C');
    const catalogue = createCatalogueSource({ roots: () => subs.roots(), resolveEndorsements: (pk) => subs.resolveEndorsements(pk), resolveCard: books.resolveCard });

    expect(idsOf(await catalogue.list())).toEqual(['catalogue:A']);

    await expect(community.revoke(rec.id, { by: strangerId.pubKey })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(idsOf(await catalogue.list())).toEqual(['catalogue:A']);   // rejected revoke = no change

    await community.revoke(rec.id, { by: adminId.pubKey });        // admin revoke
    expect(idsOf(await catalogue.list())).toEqual([]);              // gone for the subscriber
  });
});

/* ── 6. FORK / EXIT ────────────────────────────────────────────────────── */
describe('G3 — fork/exit: community D copies C\'s endorsement set, then diverges', () => {
  it('D forks C (copied sigs still verify under C\'s curator), then adds/removes independently', async () => {
    const cAdmin = await makeIdentity();
    const dAdmin = await makeIdentity();
    const ag1 = await makeIdentity();
    const ag2 = await makeIdentity();   // D adds this AFTER the fork (divergence)
    const books = cardBook();
    books.set(ag1, agentCard(ag1.pubKey, { id: 'catalogue:1' }));
    books.set(ag2, agentCard(ag2.pubKey, { id: 'catalogue:2' }));

    const circleC = { id: 'C', roles: { admin: [cAdmin.pubKey] } };
    const circleD = { id: 'D', roles: { admin: [dAdmin.pubKey] } };
    const commC = createCommunityCatalogue({ circleId: 'C', isAdmin: circleAdminGate(circleC), pseudoPod: memPod(), deviceId: 'nodeC' });
    const commD = createCommunityCatalogue({ circleId: 'D', isAdmin: circleAdminGate(circleD), pseudoPod: memPod(), deviceId: 'nodeD' });

    await commC.endorse(issueEndorsement(cAdmin, { card: books.resolveCard(ag1.pubKey) }));

    // A D admin forks C's endorsement set into D. The copied statement keeps
    // C's admin as `endorser` → still verifies, no permission from C needed.
    const forkRes = await commD.fork({ by: dAdmin.pubKey, endorsements: await commC.list(), resolveCard: books.resolveCard });
    expect(forkRes.adopted).toBe(1);
    expect(forkRes.adoptedEndorsers).toEqual([cAdmin.pubKey]);

    // A non-admin cannot fork into D.
    await expect(commD.fork({ by: (await makeIdentity()).pubKey, endorsements: [], resolveCard: books.resolveCard }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    // D's subscribers: roots = D's admins ∪ the adopted (forked) endorsers, so
    // the copied C-signed statements are reachable under D's ownership.
    const subs = createCommunitySubscriptions({
      resolveCommunity: (id) => id === 'D'
        ? { admins: [dAdmin.pubKey, ...forkRes.adoptedEndorsers], list: commD.list } : null,
    });
    subs.subscribe('D');
    const catalogue = createCatalogueSource({ roots: () => subs.roots(), resolveEndorsements: (pk) => subs.resolveEndorsements(pk), resolveCard: books.resolveCard });

    expect(idsOf(await catalogue.list())).toEqual(['catalogue:1']);   // D has C's agent, under D's ownership

    // DIVERGE: D's own admin adds agent 2 → only in D, not C.
    await commD.endorse(issueEndorsement(dAdmin, { card: books.resolveCard(ag2.pubKey) }));
    expect(idsOf(await catalogue.list()).sort()).toEqual(['catalogue:1', 'catalogue:2']);
    expect((await commC.list()).length).toBe(1);                  // C did not gain agent 2

    // DIVERGE (remove): D's admin revokes the forked C-signed statement → drops
    // from D only. (D owns its copy; C's original is untouched.)
    const forked = (await commD.list()).find((e) => e.endorser === cAdmin.pubKey);
    await commD.revoke(forked.id, { by: dAdmin.pubKey });
    expect(idsOf(await catalogue.list())).toEqual(['catalogue:2']);
    expect((await commC.list()).length).toBe(1);                  // C still has its original
  });
});
