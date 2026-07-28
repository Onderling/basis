/**
 * commons-governance G2 — the web-of-trust graph over the endorsement set.
 *
 * G1 was single-root + flat; G2 is the real WoT: MULTIPLE curator roots, a
 * TRANSITIVE bounded-depth walk over `recommend` edges, and trust-path-proximity
 * ranking. These tests assert RESULTS (ranked catalog membership + ORDER) over
 * real primitives (Ed25519 AgentIdentity + a hermetic per-curator endorsement
 * seam + an injected card resolver) — no crypto/pod mocks.
 *
 *   TRANSITIVE REACH · BOUNDED DEPTH · PROXIMITY RANKING · CYCLE-SAFE ·
 *   MULTI-ROOT · FLAG precedence · offline CACHE.
 *
 * The curator-vs-agent rule (see trustGraph.js header): reachability is
 * universal (every recommend extends the walk); candidacy is by card role
 * (a `role:'curator'` card is a trust node walked THROUGH, not listed).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory }   from '../../vault/src/VaultMemory.js';

import { issueEndorsement, createCatalogSource, walkTrustGraph } from '../index.js';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

/** An installable AGENT card (default role 'service' → a catalog candidate). */
function agentCard(pubKey, { id, role = 'service', skills = ['summarise.thread'] } = {}) {
  return {
    name: id, description: `agent ${id}`,
    url: `https://example.invalid/agents/${id}`, version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role },
  };
}

/** A CURATOR identity card (role 'curator' → a trust node, walked but NOT listed). */
function curatorCard(pubKey, { id } = {}) {
  return {
    name: id, description: `curator ${id}`,
    url: `https://example.invalid/curators/${id}`, version: '1.0',
    skills: [],
    'x-onderling': { id, pubKey, role: 'curator' },
  };
}

/**
 * A hermetic per-curator endorsement graph. Each identity publishes its own
 * list; `resolveEndorsements(pubKey)` returns that list (the real WoT seam).
 * `resolveCard(subject)` returns the registered card.
 */
function graph() {
  const lists = new Map();   // endorser pubKey → endorsement[]
  const cards = new Map();   // subject pubKey → card
  return {
    card(identity, card) { cards.set(identity.pubKey, card); return identity; },
    endorse(endorser, subjectIdentity, { claim = 'recommend', card, tags = [] } = {}) {
      const c = card ?? cards.get(subjectIdentity.pubKey);
      const rec = issueEndorsement(endorser, { subject: subjectIdentity.pubKey, card: c, claim, tags });
      const arr = lists.get(endorser.pubKey) ?? [];
      arr.push(rec);
      lists.set(endorser.pubKey, arr);
      return rec;
    },
    resolveEndorsements: (pk) => lists.get(pk) ?? [],
    resolveCard: (subject) => cards.get(subject) ?? null,
  };
}

const idsOf = (list) => list.map((c) => c['x-onderling'].id);

/* ── TRANSITIVE REACH ───────────────────────────────────────────────────── */
describe('G2 — transitive reach (the walk)', () => {
  it('root → curator B → agent X: X is a candidate at depth 2; an agent behind an UNREACHABLE curator is excluded', async () => {
    const g = graph();
    const root     = await makeIdentity();
    const B        = await makeIdentity();
    const X        = await makeIdentity();
    const outsider = await makeIdentity();   // a curator NOT reached from root
    const Y        = await makeIdentity();

    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'curatorB' }));
    g.card(X, agentCard(X.pubKey, { id: 'catalog:X' }));
    g.card(outsider, curatorCard(outsider.pubKey, { id: 'curatorZ' }));
    g.card(Y, agentCard(Y.pubKey, { id: 'catalog:Y' }));

    g.endorse(root, B);          // root vouches for curator B  (B node-depth 1)
    g.endorse(B, X);             // B vouches for agent X        (X candidate-depth 2)
    g.endorse(outsider, Y);      // an UNREACHABLE curator vouches for Y

    const cat  = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const list = await cat.list();

    expect(idsOf(list)).toEqual(['catalog:X']);            // X reachable; Y excluded; curator B not listed
    expect(list[0]['x-onderling'].endorsement.depth).toBe(2); // two endorsement hops from the root
    expect(await cat.get('catalog:Y')).toBeNull();
  });
});

/* ── BOUNDED DEPTH ──────────────────────────────────────────────────────── */
describe('G2 — bounded depth', () => {
  it('an agent reachable only beyond maxDepth is EXCLUDED', async () => {
    const g = graph();
    const root = await makeIdentity();
    const B    = await makeIdentity();
    const C    = await makeIdentity();
    const deep = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'B' }));
    g.card(C, curatorCard(C.pubKey, { id: 'C' }));
    g.card(deep, agentCard(deep.pubKey, { id: 'catalog:deep' }));

    g.endorse(root, B);   // B depth 1
    g.endorse(B, C);      // C depth 2
    g.endorse(C, deep);   // deep candidate-depth 3

    // maxDepth 2 → the walk reads nodes at depth < 2 (root, B); C is depth 2 so
    // its endorsements are NOT read → deep (depth 3) never surfaces.
    const shallow = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 2 });
    expect(idsOf(await shallow.list())).toEqual([]);

    // maxDepth 3 → deep is reachable.
    const deeper = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 3 });
    expect(idsOf(await deeper.list())).toEqual(['catalog:deep']);
  });
});

/* ── PROXIMITY RANKING ──────────────────────────────────────────────────── */
describe('G2 — trust-path-proximity ranking', () => {
  it('a directly-root-endorsed agent outranks a depth-3 one; breadth breaks ties', async () => {
    const g = graph();
    const root = await makeIdentity();
    const B    = await makeIdentity();
    const C    = await makeIdentity();
    const near = await makeIdentity();     // endorsed directly by root → depth 1
    const far  = await makeIdentity();     // root → B → C → far → depth 3

    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'B' }));
    g.card(C, curatorCard(C.pubKey, { id: 'C' }));
    g.card(near, agentCard(near.pubKey, { id: 'catalog:near' }));
    g.card(far,  agentCard(far.pubKey,  { id: 'catalog:far' }));

    g.endorse(root, near);   // near depth 1
    g.endorse(root, B); g.endorse(B, C); g.endorse(C, far);   // far depth 3

    const cat  = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const list = await cat.list();
    expect(idsOf(list)).toEqual(['catalog:near', 'catalog:far']);   // proximity: near (1) before far (3)
    expect(list[0]['x-onderling'].endorsement.depth).toBe(1);
    expect(list[1]['x-onderling'].endorsement.depth).toBe(3);
  });

  it('same depth → MORE distinct reachable endorsers ranks higher (breadth tiebreak)', async () => {
    const g = graph();
    const root1 = await makeIdentity();
    const root2 = await makeIdentity();
    const popular = await makeIdentity();   // endorsed by BOTH roots at depth 1
    const lonely  = await makeIdentity();   // endorsed by ONE root at depth 1

    g.card(root1, curatorCard(root1.pubKey, { id: 'root1' }));
    g.card(root2, curatorCard(root2.pubKey, { id: 'root2' }));
    g.card(popular, agentCard(popular.pubKey, { id: 'catalog:popular' }));
    g.card(lonely,  agentCard(lonely.pubKey,  { id: 'catalog:lonely' }));

    g.endorse(root1, popular);
    g.endorse(root2, popular);
    g.endorse(root1, lonely);

    const cat  = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root1.pubKey, root2.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const list = await cat.list();
    expect(idsOf(list)).toEqual(['catalog:popular', 'catalog:lonely']);   // same depth 1; popular has 2 endorsers
    expect(list[0]['x-onderling'].endorsement.count).toBe(2);
    expect(list[1]['x-onderling'].endorsement.count).toBe(1);
  });
});

/* ── CYCLE-SAFE ─────────────────────────────────────────────────────────── */
describe('G2 — cycle safety', () => {
  it('an a ↔ b endorsement cycle terminates (no infinite loop)', async () => {
    const g = graph();
    const root = await makeIdentity();
    const a = await makeIdentity();
    const b = await makeIdentity();
    const leaf = await makeIdentity();

    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(a, curatorCard(a.pubKey, { id: 'A' }));
    g.card(b, curatorCard(b.pubKey, { id: 'B' }));
    g.card(leaf, agentCard(leaf.pubKey, { id: 'catalog:leaf' }));

    g.endorse(root, a);
    g.endorse(a, b);
    g.endorse(b, a);       // cycle a → b → a
    g.endorse(b, leaf);

    const cat  = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 6 });
    const list = await cat.list();               // must return (the test completing IS the assertion)
    expect(idsOf(list)).toEqual(['catalog:leaf']);
    expect(list[0]['x-onderling'].endorsement.depth).toBe(3);   // root→a(1)→b(2)→leaf(3)
  });
});

/* ── MULTI-ROOT ─────────────────────────────────────────────────────────── */
describe('G2 — multi-root union', () => {
  it("two roots' subgraphs union; an agent reachable from EITHER appears", async () => {
    const g = graph();
    const rootA = await makeIdentity();
    const rootB = await makeIdentity();
    const onlyA = await makeIdentity();
    const onlyB = await makeIdentity();

    g.card(rootA, curatorCard(rootA.pubKey, { id: 'rootA' }));
    g.card(rootB, curatorCard(rootB.pubKey, { id: 'rootB' }));
    g.card(onlyA, agentCard(onlyA.pubKey, { id: 'catalog:onlyA' }));
    g.card(onlyB, agentCard(onlyB.pubKey, { id: 'catalog:onlyB' }));

    g.endorse(rootA, onlyA);
    g.endorse(rootB, onlyB);

    // With only rootA, onlyB is invisible.
    const single = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [rootA.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    expect(idsOf(await single.list())).toEqual(['catalog:onlyA']);

    // Union of both roots.
    const both = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [rootA.pubKey, rootB.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    expect(idsOf(await both.list()).sort()).toEqual(['catalog:onlyA', 'catalog:onlyB']);
  });
});

/* ── FLAG precedence ────────────────────────────────────────────────────── */
describe('G2 — flag precedence (a reachable curator flag excludes outright)', () => {
  it('a flag from any reachable curator removes an otherwise-recommended agent, even with a closer recommend', async () => {
    const g = graph();
    const root = await makeIdentity();
    const B    = await makeIdentity();
    const x    = await makeIdentity();
    const cardX = agentCard(x.pubKey, { id: 'catalog:x' });

    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'B' }));
    g.card(x, cardX);

    g.endorse(root, x);          // root RECOMMENDS x directly (depth 1 — the CLOSER claim)
    g.endorse(root, B);          // root trusts curator B
    g.endorse(B, x, { claim: 'flag' });   // B (depth-2 reach) FLAGS x

    const cat = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    expect(idsOf(await cat.list())).toEqual([]);        // flag wins even though a closer curator recommended
    expect(await cat.get('catalog:x')).toBeNull();
  });
});

/* ── OFFLINE CACHE ──────────────────────────────────────────────────────── */
describe('G2 — offline read-through cache', () => {
  it('serves the last good ranked catalog when the endorsement source is unreachable', async () => {
    const g = graph();
    const root = await makeIdentity();
    const x = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(x, agentCard(x.pubKey, { id: 'catalog:x' }));
    g.endorse(root, x);

    let online = true;
    const resolveEndorsements = (pk) => {
      if (!online) throw new Error('network down');
      return g.resolveEndorsements(pk);
    };
    let store = null;
    const cache = { read: () => store, write: (e) => { store = e; } };

    const cat = createCatalogSource({ resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4, cache });
    expect(idsOf(await cat.list())).toEqual(['catalog:x']);   // online: derives + fills cache

    online = false;
    expect(idsOf(await cat.list())).toEqual(['catalog:x']);   // offline: served from cache
    expect((await cat.get('catalog:x'))['x-onderling'].id).toBe('catalog:x');
  });

  it('with no cache, an unreachable source throws (no silent empty catalog)', async () => {
    const root = await makeIdentity();
    const cat = createCatalogSource({
      resolveEndorsements: () => { throw new Error('down'); },
      roots: [root.pubKey], resolveCard: () => null, maxDepth: 4,
    });
    await expect(cat.list()).rejects.toThrow(/down/);
  });
});

/* ── walkTrustGraph directly (pure walk) + G1 back-compat pool seam ──────── */
describe('G2 — walkTrustGraph pure + endorsementResource pool back-compat', () => {
  it('the pool seam (a single shared list) reproduces the walk (G1 special case)', async () => {
    const g = graph();
    const root = await makeIdentity();
    const B    = await makeIdentity();
    const x    = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'B' }));
    g.card(x, agentCard(x.pubKey, { id: 'catalog:x' }));
    g.endorse(root, B);
    g.endorse(B, x);

    // Flatten every curator's list into ONE pool → the endorsementResource seam.
    const pool = [...[root, B, x].flatMap((i) => g.resolveEndorsements(i.pubKey))];
    const endorsementResource = { list: async () => pool };

    const cat = createCatalogSource({ endorsementResource, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    expect(idsOf(await cat.list())).toEqual(['catalog:x']);   // same result as the resolver seam
  });

  it('walkTrustGraph returns proximity-ordered candidates with depth + endorsers', async () => {
    const g = graph();
    const root = await makeIdentity();
    const near = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(near, agentCard(near.pubKey, { id: 'catalog:near' }));
    g.endorse(root, near, { tags: ['files'] });

    const ranked = await walkTrustGraph({ roots: [root.pubKey], endorsementsOf: g.resolveEndorsements, resolveCard: g.resolveCard, maxDepth: 4 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].depth).toBe(1);
    expect(ranked[0].endorsers).toEqual([root.pubKey]);
    expect(ranked[0].tags).toEqual(['files']);
  });
});
