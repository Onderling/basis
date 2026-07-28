/**
 * agents — install through the REAL commons-governance G1 catalog source.
 *
 * Proves the full loop: endorse → discover → install-with-scoped-grants,
 * with 's capability-security intact when the stubbed catalog is replaced by
 * the endorsement-backed `createCatalogSource`.
 *
 *   1. END-TO-END — a card the root ENDORSES appears in `listCatalog`, and
 *      `installAgent({ catalogId })` installs it default-deny, granting ONLY
 *      the requested-AND-declared skills (undeclared → rejected, no token).
 *   2. TRANSPARENT SWAP — the real source is the SAME `{ list, get }` shape as
 *      the stub: everything asserted over the stub holds over it.
 *   3. NEGATIVE — a card the root did NOT endorse (or FLAGGED) is not in the
 *      catalog, so it can't be installed via `catalogId` (the override path is
 *      the only way in, unchanged).
 *
 * Real primitives: Ed25519 AgentIdentity, the pseudo-pod, the endorsement
 * resource, createCatalogSource — no catalog mock. Relative @onderling imports,
 * matching install.test.js.
 */
import { describe, it, expect } from 'vitest';

import { AgentIdentity }   from '../../../packages/core/src/identity/AgentIdentity.js';
import { VaultMemory }     from '../../../packages/vault/src/VaultMemory.js';
import { createAgentRegistry } from '../../../packages/agent-registry/src/AgentRegistry.js';
import { createEndorsementResource } from '../../../packages/agent-registry/src/endorsementResource.js';
import { createCatalogSource }       from '../../../packages/agent-registry/src/catalogSource.js';
import { issueEndorsement }          from '../../../packages/agent-registry/src/endorsement.js';

import { INSTALL_CORES } from '../src/installCores.js';

const { installAgent, listCatalog } = INSTALL_CORES;

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function makeCard(pubKey, { id = 'catalog:summariser', name = 'Summariser', skills = ['summarise.thread', 'summarise.document'] } = {}) {
  return {
    name, description: 'Summarises threads.',
    url: 'https://example.invalid/agents/summariser', version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role: 'service' },
  };
}

/** In-memory pseudo-pod → a real createAgentRegistry over it (as install.test.js). */
function buildRegistry() {
  const map = new Map();
  const pod = {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
  return createAgentRegistry({ pseudoPod: pod, deviceId: 'this-device' });
}

/** An endorsement resource over its own in-memory pod. */
function buildEndorsements() {
  const map = new Map();
  const pod = {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
  return createEndorsementResource({ pseudoPod: pod, deviceId: 'root-device' });
}

/** A card resolver keyed by subject pubKey (the G1 resolveCard collaborator). */
function makeResolver(entries = []) {
  const byKey = new Map(entries.map((c) => [c['x-onderling'].pubKey, c]));
  return { byKey, resolve: (subject) => byKey.get(subject) ?? null };
}

async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

/* ── 1. End-to-end: endorse → discover → install ───────────────────────── */
describe('agents — G1 endorse → discover → install through the real catalog source', () => {
  it('a root-endorsed card appears in listCatalog and installs with ONLY granted+declared caps', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey);

    // ENDORSE — the bootstrap root signs a recommend over the exact card.
    const endorsements = buildEndorsements();
    await endorsements.append(issueEndorsement(root, { subject: agent.pubKey, card, tags: ['files'] }));

    // The real catalog source (single root, flat, verified) — SAME {list,get}
    // contract the stub had.
    const resolver = makeResolver([card]);
    const catalog  = createCatalogSource({ endorsementResource: endorsements, roots: [root.pubKey], resolveCard: resolver.resolve });

    // DISCOVER — the card shows up in the roster.
    const registry = buildRegistry();
    const listed = await listCatalog({ registry, catalog }, {});
    expect(listed.ok).toBe(true);
    const row = listed.catalog.find((c) => c.id === 'catalog:summariser');
    expect(row).toBeTruthy();
    expect(row.skills).toEqual(['summarise.document', 'summarise.thread']);

    // INSTALL — through 's capability-security path: grant ONE declared skill,
    // request one UNDECLARED skill (rejected, no token).
    const res = await installAgent({ registry, catalog }, {
      catalogId: 'catalog:summariser',
      grants:    ['summarise.thread', 'evil.exfiltrate'],
    });
    expect(res.ok).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.source).toBe('catalog');
    expect(res.granted.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(res.rejected).toEqual([{ skill: 'evil.exfiltrate', reason: 'not-declared' }]);
    expect(res.declined).toEqual(['summarise.document']);

    // Registry holds ONLY the granted capability (default-deny held through the real source).
    const entry = await registry.lookup('catalog:summariser');
    expect(entry.grants.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(entry.capabilities).toEqual(['summarise.thread']);
    expect(entry.pubKey).toBe(agent.pubKey);
  });

  it('a NON-endorsed card is not in the catalog → not installable by catalogId', async () => {
    const root  = await makeIdentity();
    const known = await makeIdentity();
    const other = await makeIdentity();
    const knownCard = makeCard(known.pubKey, { id: 'catalog:known' });
    const otherCard = makeCard(other.pubKey, { id: 'catalog:unlisted' });

    const endorsements = buildEndorsements();
    await endorsements.append(issueEndorsement(root, { subject: known.pubKey, card: knownCard }));
    // otherCard is resolvable BUT never endorsed by the root.
    const resolver = makeResolver([knownCard, otherCard]);
    const catalog  = createCatalogSource({ endorsementResource: endorsements, roots: [root.pubKey], resolveCard: resolver.resolve });

    const registry = buildRegistry();
    const listed = await listCatalog({ registry, catalog }, {});
    expect(listed.catalog.map((c) => c.id)).toEqual(['catalog:known']);

    // The unlisted card can't be installed via the curated path.
    const miss = await installAgent({ registry, catalog }, { catalogId: 'catalog:unlisted' });
    expect(miss.ok).toBe(false);
    expect(miss.error).toBe('catalog-entry-not-found');

    // …but the power-user override still sideloads it (unchanged), bypassing curation.
    const over = await installAgent({ registry }, { card: otherCard, grants: ['summarise.thread'] });
    expect(over.ok).toBe(true);
    expect(over.source).toBe('override');
    expect(over.agentId).toBe('catalog:unlisted');
  });

  it('a FLAGGED card drops out of the catalog (moderation) → no longer installable', async () => {
    const root  = await makeIdentity();
    const agent = await makeIdentity();
    const card  = makeCard(agent.pubKey, { id: 'catalog:sketchy' });

    const endorsements = buildEndorsements();
    await endorsements.append(issueEndorsement(root, { subject: agent.pubKey, card, claim: 'recommend' }));
    const resolver = makeResolver([card]);
    const catalog  = createCatalogSource({ endorsementResource: endorsements, roots: [root.pubKey], resolveCard: resolver.resolve });
    const registry = buildRegistry();

    // Before the flag: listed + installable.
    expect((await listCatalog({ registry, catalog }, {})).catalog.map((c) => c.id)).toEqual(['catalog:sketchy']);

    // The root FLAGS it (signed statement) → excluded.
    await endorsements.append(issueEndorsement(root, { subject: agent.pubKey, card, claim: 'flag' }));
    expect((await listCatalog({ registry, catalog }, {})).catalog).toEqual([]);
    expect((await installAgent({ registry, catalog }, { catalogId: 'catalog:sketchy' })).error).toBe('catalog-entry-not-found');
  });
});
