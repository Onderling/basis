/**
 * agents — install through a commons-governance G3 COMMUNITY catalogue.
 *
 * The end-to-end federation proof: a card discovered via a CIRCLE-scoped,
 * admin-gated community catalogue — reached because the user SUBSCRIBED to that
 * community — installs through 's capability-security UNCHANGED (only
 * granted+declared caps land). The community write is gated by the REAL circle
 * policy (`@onderling/circles` `inAudience('role:admin')`); the subscriber's roots
 * are the community's admins.
 *
 * Real primitives end-to-end: Ed25519 AgentIdentity · the real
 * createCommunityCatalogue over an in-memory pod · the real circles admin gate ·
 * createCommunitySubscriptions → createCatalogueSource walk · installCores.
 */
import { describe, it, expect } from 'vitest';

import { AgentIdentity }        from '../../../packages/core/src/identity/AgentIdentity.js';
import { VaultMemory }          from '../../../packages/vault/src/VaultMemory.js';
import { createAgentRegistry }  from '../../../packages/agent-registry/src/AgentRegistry.js';
import { createCatalogueSource }  from '../../../packages/agent-registry/src/catalogueSource.js';
import { issueEndorsement }     from '../../../packages/agent-registry/src/endorsement.js';
import { createCommunityCatalogue }        from '../../../packages/agent-registry/src/communityCatalogue.js';
import { createCommunitySubscriptions }  from '../../../packages/agent-registry/src/subscriptions.js';
import { inAudience }           from '../../../packages/circles/src/audience.js';

import { INSTALL_CORES } from '../src/installCores.js';

const { installAgent, listCatalogue } = INSTALL_CORES;

function agentCard(pubKey, { id, skills = ['summarise.thread', 'summarise.document'] } = {}) {
  return {
    name: id, description: 'agent',
    url: `https://example.invalid/agents/${id}`, version: '1.0',
    skills: skills.map((s) => ({ id: s })),
    authentication: { schemes: ['Bearer'] },
    'x-onderling': { id, pubKey, role: 'service' },
  };
}
function buildRegistry() {
  const map = new Map();
  const pod = {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
  return createAgentRegistry({ pseudoPod: pod, deviceId: 'this-device' });
}
function memPod() {
  const map = new Map();
  return {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: String(map.get(uri)?.updatedAt ?? '') } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: String(body?.updatedAt ?? '') }; },
  };
}
async function makeIdentity() { return AgentIdentity.generate(new VaultMemory()); }

describe('agents — G3 community-catalogue discovery → P3 install with capability-security', () => {
  it('a subscriber installs an admin-endorsed community agent; grants are still capped to declared skills', async () => {
    const adminId = await makeIdentity();
    const agentId = await makeIdentity();
    const card = agentCard(agentId.pubKey, { id: 'catalogue:community' });
    const cards = new Map([[agentId.pubKey, card]]);
    const resolveCard = (subject) => cards.get(subject) ?? null;

    // A circle whose admin roster is the real circles policy gate.
    const circle = { id: 'circle', roles: { admin: [adminId.pubKey] } };
    const community = createCommunityCatalogue({
      circleId: 'circle',
      isAdmin: (pk) => inAudience(pk, 'role:admin', { roleMembers: circle.roles }),
      pseudoPod: memPod(), deviceId: 'companion-node',   // <- CAN be the community's companion node (R1-R3)
    });
    await community.endorse(issueEndorsement(adminId, { card, tags: ['files'] }));

    // The user subscribes to the community → its admins are their curator roots.
    const subs = createCommunitySubscriptions({
      resolveCommunity: (id) => id === 'circle' ? { admins: [adminId.pubKey], list: community.list } : null,
    });
    subs.subscribe('circle');

    const catalogue = createCatalogueSource({
      roots: () => subs.roots(),
      resolveEndorsements: (pk) => subs.resolveEndorsements(pk),
      resolveCard,
    });
    const registry = buildRegistry();

    const listed = await listCatalogue({ registry, catalogue }, {});
    expect(listed.catalogue.map((c) => c.id)).toEqual(['catalogue:community']);

    const res = await installAgent({ registry, catalogue }, {
      catalogueId: 'catalogue:community',
      grants: ['summarise.thread', 'evil.exfiltrate'],
    });
    expect(res.ok).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.source).toBe('catalogue');
    expect(res.granted.map((gr) => gr.skill)).toEqual(['summarise.thread']);
    expect(res.rejected).toEqual([{ skill: 'evil.exfiltrate', reason: 'not-declared' }]);

    const entry = await registry.lookup('catalogue:community');
    expect(entry.capabilities).toEqual(['summarise.thread']);
    expect(entry.pubKey).toBe(agentId.pubKey);
  });
});
