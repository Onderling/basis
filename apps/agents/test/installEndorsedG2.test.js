/**
 * agents — install through the commons-governance G2 WEB-OF-TRUST catalog.
 *
 * Extends installEndorsed.test.js (G1, single-root) to the G2 graph source:
 *   1. TRANSITIVE INSTALL — an agent discovered by WALKING the graph (root →
 *      curator B → agent X, depth 2) installs end-to-end with 's
 *      capability-security (only granted+declared caps land).
 *   2. cardHash-AT-INSTALL — a card SWAPPED after listing (endorse-then-escalate)
 *      fails the re-verify inside `catalog.get`, so install can't proceed. Proves
 *      the cardHash binding holds not just at list time but at install time.
 *   3. MULTI-ROOT — a card reachable only from the SECOND root still installs.
 *
 * Real primitives: Ed25519 AgentIdentity, the endorsement records, the real
 * createCatalogSource graph walk — no catalog mock.
 */
import { describe, it, expect } from 'vitest';

import { AgentIdentity }        from '../../../packages/core/src/identity/AgentIdentity.js';
import { VaultMemory }          from '../../../packages/vault/src/VaultMemory.js';
import { createAgentRegistry }  from '../../../packages/agent-registry/src/AgentRegistry.js';
import { createCatalogSource }  from '../../../packages/agent-registry/src/catalogSource.js';
import { issueEndorsement }     from '../../../packages/agent-registry/src/endorsement.js';

import { INSTALL_CORES } from '../src/installCores.js';

const { installAgent, listCatalog } = INSTALL_CORES;

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function agentCard(pubKey, { id, skills = ['summarise.thread', 'summarise.document'] } = {}) {
  return {
    name: id, description: 'agent',
    url: `https://example.invalid/agents/${id}`, version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role: 'service' },
  };
}
function curatorCard(pubKey, { id } = {}) {
  return { name: id, url: `https://example.invalid/curators/${id}`, version: '1.0', skills: [], 'x-onderling': { id, pubKey, role: 'curator' } };
}

function buildRegistry() {
  const map = new Map();
  const pod = {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
  return createAgentRegistry({ pseudoPod: pod, deviceId: 'this-device' });
}

/** A hermetic per-curator endorsement graph (the real WoT seam). */
function graph() {
  const lists = new Map();
  const cards = new Map();
  return {
    card(identity, card) { cards.set(identity.pubKey, card); return identity; },
    setCard(pubKey, card) { cards.set(pubKey, card); },
    endorse(endorser, subjectIdentity, { claim = 'recommend', tags = [] } = {}) {
      const rec = issueEndorsement(endorser, { subject: subjectIdentity.pubKey, card: cards.get(subjectIdentity.pubKey), claim, tags });
      const arr = lists.get(endorser.pubKey) ?? [];
      arr.push(rec); lists.set(endorser.pubKey, arr);
      return rec;
    },
    resolveEndorsements: (pk) => lists.get(pk) ?? [],
    resolveCard: (subject) => cards.get(subject) ?? null,
  };
}

async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

/* ── 1. Transitive install ─────────────────────────────────────────────── */
describe('agents — G2 transitive discovery → install with capability-security', () => {
  it('an agent reached at depth 2 (root → curator B → X) installs granting ONLY granted+declared caps', async () => {
    const g = graph();
    const root  = await makeIdentity();
    const B     = await makeIdentity();
    const X     = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(B, curatorCard(B.pubKey, { id: 'curatorB' }));
    g.card(X, agentCard(X.pubKey, { id: 'catalog:X' }));
    g.endorse(root, B);   // trust curator B
    g.endorse(B, X, { tags: ['files'] });   // B recommends agent X → depth 2

    const catalog = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const registry = buildRegistry();

    const listed = await listCatalog({ registry, catalog }, {});
    expect(listed.catalog.map((c) => c.id)).toEqual(['catalog:X']);

    const res = await installAgent({ registry, catalog }, { catalogId: 'catalog:X', grants: ['summarise.thread', 'evil.exfiltrate'] });
    expect(res.ok).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.source).toBe('catalog');
    expect(res.granted.map((gr) => gr.skill)).toEqual(['summarise.thread']);
    expect(res.rejected).toEqual([{ skill: 'evil.exfiltrate', reason: 'not-declared' }]);

    const entry = await registry.lookup('catalog:X');
    expect(entry.capabilities).toEqual(['summarise.thread']);
    expect(entry.pubKey).toBe(X.pubKey);
  });

  it('MULTI-ROOT: a card reachable only from the second root still installs', async () => {
    const g = graph();
    const rootA = await makeIdentity();
    const rootB = await makeIdentity();
    const Y     = await makeIdentity();
    g.card(rootA, curatorCard(rootA.pubKey, { id: 'rootA' }));
    g.card(rootB, curatorCard(rootB.pubKey, { id: 'rootB' }));
    g.card(Y, agentCard(Y.pubKey, { id: 'catalog:Y' }));
    g.endorse(rootB, Y);   // only rootB vouches for Y

    const catalog = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [rootA.pubKey, rootB.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const registry = buildRegistry();
    expect((await listCatalog({ registry, catalog }, {})).catalog.map((c) => c.id)).toEqual(['catalog:Y']);
    const res = await installAgent({ registry, catalog }, { catalogId: 'catalog:Y', grants: ['summarise.thread'] });
    expect(res.ok).toBe(true);
    expect((await registry.lookup('catalog:Y')).capabilities).toEqual(['summarise.thread']);
  });
});

/* ── 2. cardHash re-verify AT INSTALL ──────────────────────────────────── */
describe('agents — G2 cardHash re-verify holds at install time', () => {
  it('a card swapped AFTER listing (escalate) fails the install re-verify → not installable', async () => {
    const g = graph();
    const root = await makeIdentity();
    const X    = await makeIdentity();
    g.card(root, curatorCard(root.pubKey, { id: 'root' }));
    g.card(X, agentCard(X.pubKey, { id: 'catalog:X', skills: ['summarise.thread'] }));
    g.endorse(root, X);

    const catalog = createCatalogSource({ resolveEndorsements: g.resolveEndorsements, roots: [root.pubKey], resolveCard: g.resolveCard, maxDepth: 4 });
    const registry = buildRegistry();

    // At list time the endorsed card is present.
    expect((await listCatalog({ registry, catalog }, {})).catalog.map((c) => c.id)).toEqual(['catalog:X']);

    // The agent SWAPS its card (adds an egress skill) — same pubKey, new content.
    g.setCard(X.pubKey, agentCard(X.pubKey, { id: 'catalog:X', skills: ['summarise.thread', 'net.exfiltrate'] }));

    // Install re-derives → cardHash no longer matches the endorsement → dropped.
    const res = await installAgent({ registry, catalog }, { catalogId: 'catalog:X', grants: ['summarise.thread'] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('catalog-entry-not-found');
    expect(await registry.lookup('catalog:X')).toBeNull();
  });
});
