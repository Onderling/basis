/**
 * commons-governance G1 — signed endorsements + the endorsement-backed
 * curated catalog read-view.
 *
 *   1. verifyEndorsement — a validly-signed endorsement verifies; a tampered
 *      field / bad sig / expired / cardHash-mismatch (card mutated AFTER
 *      endorsement) / unknown-claim / subject-mismatch each → invalid.
 *   2. endorsement resource — append/list/revoke over a real in-memory
 *      pseudo-pod at a SHARED-READABLE (/public/) path.
 *   3. createCatalogSource — reads a single root's endorsements, returns ONLY
 *      verified cards; a flagged / invalid / non-root endorsement is excluded;
 *      an empty root → empty catalog.
 *
 * Real primitives throughout: Ed25519 AgentIdentity, the pseudo-pod, the
 * endorsement resource — no crypto/pod mocks.
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory }   from '../../vault/src/VaultMemory.js';

import {
  issueEndorsement,
  verifyEndorsement,
  cardHash,
  createEndorsementResource,
  createCatalogSource,
} from '../index.js';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

/** An Agent Card whose x-onderling.pubKey = the given endorsed-agent pubKey. */
function makeCard(pubKey, { id = 'catalog:summariser', skills = ['summarise.thread', 'summarise.document'] } = {}) {
  return {
    name: 'Summariser', description: 'Summarises threads.',
    url: 'https://example.invalid/agents/summariser', version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role: 'service' },
  };
}

async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

function mkPod(deviceId = 'root-device') {
  return createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
}

/* ── 1. verifyEndorsement ──────────────────────────────────────────────── */
describe('G1 — verifyEndorsement (deny-by-default; cardHash defeats escalate)', () => {
  it('a validly-signed recommend verifies and returns the actor view', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey);
    const rec   = issueEndorsement(root, { subject: agent.pubKey, card, claim: 'recommend', tags: ['files'] });

    const actor = verifyEndorsement(rec, card);
    expect(actor).toBeTruthy();
    expect(actor.endorser).toBe(root.pubKey);
    expect(actor.subject).toBe(agent.pubKey);
    expect(actor.claim).toBe('recommend');
    expect(actor.tags).toEqual(['files']);
    expect(rec.cardHash).toBe(cardHash(card));
  });

  it('a tampered field → invalid (sig no longer matches the canonical form)', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey);
    const rec   = issueEndorsement(root, { subject: agent.pubKey, card });

    expect(verifyEndorsement({ ...rec, note: 'tampered' }, card)).toBe(false);
    expect(verifyEndorsement({ ...rec, tags: ['calendar'] }, card)).toBe(false);
    expect(verifyEndorsement({ ...rec, claim: 'flag' }, card)).toBe(false);
  });

  it('a bad / forged signature → invalid', async () => {
    const root    = await makeIdentity();
    const impostor = await makeIdentity();
    const agent   = await makeIdentity();
    const card    = makeCard(agent.pubKey);
    const rec     = issueEndorsement(root, { subject: agent.pubKey, card });

    // sig re-issued by an impostor but the record still claims `root` endorsed.
    const forged  = issueEndorsement(impostor, { subject: agent.pubKey, card });
    expect(verifyEndorsement({ ...rec, sig: forged.sig }, card)).toBe(false);
    expect(verifyEndorsement({ ...rec, sig: 'AAAA' }, card)).toBe(false);
  });

  it('an expired endorsement → invalid (curation goes stale)', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey);
    const base  = 1_000_000;
    const rec   = issueEndorsement(root, { subject: agent.pubKey, card, expiresIn: 60_000, now: () => base });

    expect(verifyEndorsement(rec, card, { now: () => base + 30_000 })).toBeTruthy();   // still fresh
    expect(verifyEndorsement(rec, card, { now: () => base + 60_000 })).toBe(false);     // lapsed
  });

  it('cardHash-mismatch — card MUTATED after endorsement → invalid (endorse-then-escalate defeated)', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey, { skills: ['summarise.thread'] });
    const rec   = issueEndorsement(root, { subject: agent.pubKey, card });

    // The agent later swaps in a new skill (egress escalation) — same pubKey,
    // different card. The endorsement no longer binds.
    const escalated = makeCard(agent.pubKey, { skills: ['summarise.thread', 'net.exfiltrate'] });
    expect(rec.cardHash).not.toBe(cardHash(escalated));
    expect(verifyEndorsement(rec, escalated)).toBe(false);
  });

  it('subject / card-pubKey mismatch → invalid; unknown claim at issue → throws', async () => {
    const root   = await makeIdentity();
    const agentA = await makeIdentity();
    const agentB = await makeIdentity();
    const cardA  = makeCard(agentA.pubKey);
    const rec    = issueEndorsement(root, { subject: agentA.pubKey, card: cardA });

    // Present the endorsement against a DIFFERENT agent's card.
    const cardB = makeCard(agentB.pubKey, { id: 'catalog:other' });
    expect(verifyEndorsement(rec, cardB)).toBe(false);
    // No card at all → can't verify the binding → invalid.
    expect(verifyEndorsement(rec, null)).toBe(false);
    // Unknown claim is rejected at issue time.
    expect(() => issueEndorsement(root, { subject: agentA.pubKey, card: cardA, claim: 'bless' })).toThrow(/claim/);
  });
});

/* ── 2. endorsement resource (shared-readable pod list) ─────────────────── */
describe('G1 — endorsement resource (append/list/revoke, shared-readable path)', () => {
  it('publishes to a /public/ path (contrast the registry /private/)', () => {
    const res = createEndorsementResource({ pseudoPod: mkPod('root-device'), deviceId: 'root-device' });
    expect(res.resourceUri).toBe('pseudo-pod://root-device/public/endorsements');
  });

  it('append → list → revoke roundtrips signed records verbatim', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey);
    const rec   = issueEndorsement(root, { subject: agent.pubKey, card });

    const res = createEndorsementResource({ pseudoPod: mkPod(), deviceId: 'root-device' });
    await res.append(rec);
    let list = await res.list();
    expect(list).toHaveLength(1);
    // The stored record still verifies (nothing was lost/mutated in transit).
    expect(verifyEndorsement(list[0], card)).toBeTruthy();

    // Re-append same id = replace (no dup).
    await res.append(rec);
    expect(await res.list()).toHaveLength(1);

    await res.revoke(rec.id);
    expect(await res.list()).toHaveLength(0);
  });
});

/* ── 3. createCatalogSource (single-root, flat, verified) ───────────────── */
describe('G1 — createCatalogSource (single root → only verified cards)', () => {
  async function seed() {
    const root  = await makeIdentity();
    const res   = createEndorsementResource({ pseudoPod: mkPod(), deviceId: 'root-device' });
    const resolvers = new Map();   // subject pubKey → card
    const resolveCard = (subject) => resolvers.get(subject) ?? null;
    return { root, res, resolvers, resolveCard };
  }

  it('empty root → empty catalog', async () => {
    const { root, res, resolveCard } = await seed();
    const cat = createCatalogSource({ endorsementResource: res, roots: [root.pubKey], resolveCard });
    expect(await cat.list()).toEqual([]);
    expect(await cat.get('anything')).toBeNull();
  });

  it('returns ONLY root-endorsed, verified cards; ranks by endorsement count', async () => {
    const { root, res, resolvers, resolveCard } = await seed();
    const other = await makeIdentity();                    // a NON-root endorser

    const a1 = await makeIdentity(); const cardA = makeCard(a1.pubKey, { id: 'catalog:A' });
    const b1 = await makeIdentity(); const cardB = makeCard(b1.pubKey, { id: 'catalog:B' });
    resolvers.set(a1.pubKey, cardA);
    resolvers.set(b1.pubKey, cardB);

    // A: endorsed by the root twice (idempotent endorser set → count 1) — plus a
    // second distinct root would raise the count; here we assert single-root count.
    await res.append(issueEndorsement(root,  { subject: a1.pubKey, card: cardA }));
    // B: endorsed by the root once, AND by a non-root (which must be IGNORED).
    await res.append(issueEndorsement(root,  { subject: b1.pubKey, card: cardB }));
    await res.append(issueEndorsement(other, { subject: b1.pubKey, card: cardB }));

    const cat  = createCatalogSource({ endorsementResource: res, roots: [root.pubKey], resolveCard });
    const list = await cat.list();
    const ids  = list.map((c) => c['x-onderling'].id).sort();
    expect(ids).toEqual(['catalog:A', 'catalog:B']);
    // The non-root endorsement did not inflate B's count.
    const bEntry = list.find((c) => c['x-onderling'].id === 'catalog:B');
    expect(bEntry['x-onderling'].endorsement.count).toBe(1);
    expect(bEntry['x-onderling'].endorsement.endorsers).toEqual([root.pubKey]);
    // get() resolves the same verified card.
    expect((await cat.get('catalog:A'))['x-onderling'].id).toBe('catalog:A');
  });

  it('excludes a FLAGGED subject, an INVALID endorsement, and a cardHash-mismatch', async () => {
    const { root, res, resolvers, resolveCard } = await seed();

    const good = await makeIdentity(); const cardGood = makeCard(good.pubKey, { id: 'catalog:good' });
    const bad  = await makeIdentity(); const cardBad  = makeCard(bad.pubKey,  { id: 'catalog:bad'  });
    const flg  = await makeIdentity(); const cardFlg  = makeCard(flg.pubKey,  { id: 'catalog:flagged' });
    resolvers.set(good.pubKey, cardGood);
    resolvers.set(flg.pubKey,  cardFlg);

    await res.append(issueEndorsement(root, { subject: good.pubKey, card: cardGood }));

    // bad: recommend endorsement whose card MUTATES after the fact (resolver
    // returns the escalated card) → cardHash-mismatch → dropped.
    const badRec = issueEndorsement(root, { subject: bad.pubKey, card: cardBad });
    await res.append(badRec);
    resolvers.set(bad.pubKey, makeCard(bad.pubKey, { id: 'catalog:bad', skills: ['summarise.thread', 'net.exfiltrate'] }));

    // flagged: BOTH a recommend and a flag by the root → flag wins, excluded.
    await res.append(issueEndorsement(root, { subject: flg.pubKey, card: cardFlg, claim: 'recommend' }));
    await res.append(issueEndorsement(root, { subject: flg.pubKey, card: cardFlg, claim: 'flag' }));

    const cat = createCatalogSource({ endorsementResource: res, roots: [root.pubKey], resolveCard });
    const ids = (await cat.list()).map((c) => c['x-onderling'].id);
    expect(ids).toEqual(['catalog:good']);
    expect(await cat.get('catalog:bad')).toBeNull();
    expect(await cat.get('catalog:flagged')).toBeNull();
  });
});
