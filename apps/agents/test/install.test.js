/**
 * agents — INSTALL: the install act + capability-security proof.
 *
 * Two layers, mirroring the test style:
 *   1. INSTALL SEMANTICS (direct core) — a card installs into the registry
 *      default-deny; only requested-AND-declared skills are granted;
 *      undeclared requests are rejected (no token); the power-user
 *      override installs a non-catalog card; uninstall reuses 's
 *      purge/revoke.
 *   2. CAPABILITY-SECURITY = the anti-virus (REAL primitives) — an
 *      installed agent granted ONLY skill A holds a real signed
 *      CapabilityToken for A. Presented to a real `PolicyEngine.checkInbound`
 *      it is ALLOWED for A but DENIED for an ungranted skill B (the token
 *      can't be stretched), and B is unreachable with no token at all.
 *      Revoke (reuse revokeAgent) makes even A go inert.
 *
 * Relative @onderling imports (self-contained, no reliance on app-local
 * node_modules), matching localWireFitness.test.js.
 */
import { describe, it, expect } from 'vitest';

import { Agent }           from '../../../packages/core/src/Agent.js';
import { AgentIdentity }   from '../../../packages/core/src/identity/AgentIdentity.js';
import { InternalBus, InternalTransport } from '../../../packages/core/src/transport/InternalTransport.js';
import { TrustRegistry }   from '../../../packages/core/src/permissions/TrustRegistry.js';
import { PolicyEngine }    from '../../../packages/core/src/permissions/PolicyEngine.js';
import { TokenRegistry }   from '../../../packages/core/src/permissions/TokenRegistry.js';
import { SkillRegistry }   from '../../../packages/core/src/skills/SkillRegistry.js';
import { VaultMemory }     from '../../../packages/vault/src/VaultMemory.js';
import { createAgentRegistry } from '../../../packages/agent-registry/src/AgentRegistry.js';

import { INSTALL_CORES } from '../src/installCores.js';
import { AGENT_CORES }   from '../src/cores.js';
import { createStubCatalog, STUB_CATALOG_CARDS } from '../src/defaultCatalog.js';

const { installAgent, listCatalog } = INSTALL_CORES;
const { viewAgent, revokeAgent, purgeAgent } = AGENT_CORES;

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const CARD = Object.freeze({
  name: 'Summariser', description: 'Summarises threads.',
  url:  'https://example.invalid/agents/summariser', version: '1.0',
  skills: [{ id: 'summarise.thread' }, { id: 'summarise.document' }],
  authentication: { schemes: ['Bearer'] },
  'x-onderling': { id: 'catalog:summariser', pubKey: 'pub-cat-summariser', role: 'service' },
});
const OVERRIDE_CARD = Object.freeze({
  name: 'Sideloaded', url: 'https://third-party.invalid/agent', version: '1.0',
  skills: [{ id: 'sideload.run' }],
  'x-onderling': { id: 'override:sideloaded', pubKey: 'pub-override-sideloaded', role: 'service' },
});

/** In-memory pseudo-pod → a real createAgentRegistry over it. */
function buildRegistry() {
  const map = new Map();
  const pod = {
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
  return createAgentRegistry({ pseudoPod: pod, deviceId: 'this-device' });
}

/** A deterministic mock token collaborator (semantics layer). */
function makeMockTokens() {
  let n = 0; const revoked = [];
  return {
    revoked,
    async issue({ subject, skill, expiresIn }) {
      n += 1; return { id: `tok-${n}`, expiresAt: '2027-01-01T00:00:00.000Z', subject, skill, expiresIn };
    },
    async revoke(id) { revoked.push(id); },
  };
}

/* ── 1. Install semantics (direct core) ────────────────────────────────── */
describe('agents — P3 installAgent (install act + capability-security semantics)', () => {
  it('curated install grants ONLY the requested-and-declared subset (default-deny)', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    const catalog  = createStubCatalog([CARD]);

    const res = await installAgent({ registry, tokens, catalog }, {
      catalogId: 'catalog:summariser',
      grants:    ['summarise.thread'],   // grant ONE of the two declared skills
    });

    expect(res.ok).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.source).toBe('catalog');
    expect(res.agentId).toBe('catalog:summariser');
    expect(res.granted.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(res.rejected).toEqual([]);
    // The OTHER declared skill was not requested → declined (default-deny made visible).
    expect(res.declined).toEqual(['summarise.document']);

    // The registry now holds the agent with ONLY the granted capability.
    const entry = await registry.lookup('catalog:summariser');
    expect(entry.grants.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(entry.capabilities).toEqual(['summarise.thread']);
    // Read-back skills = exactly the granted one (NOT the whole declared surface).
    expect(res.agent.skills).toEqual(['summarise.thread']);
  });

  it('install with NO grants is INERT — registered but zero authority', async () => {
    const registry = buildRegistry();
    const catalog  = createStubCatalog([CARD]);

    const res = await installAgent({ registry, catalog }, { catalogId: 'catalog:summariser' });

    expect(res.ok).toBe(true);
    expect(res.granted).toEqual([]);
    expect(res.declined).toEqual(['summarise.document', 'summarise.thread']);
    const entry = await registry.lookup('catalog:summariser');
    expect(entry.grants).toEqual([]);
    expect(entry.capabilities).toEqual([]);   // NO ambient authority
  });

  it('rejects a requested skill the card does NOT declare (never issues a token)', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    const catalog  = createStubCatalog([CARD]);

    const res = await installAgent({ registry, tokens, catalog }, {
      catalogId: 'catalog:summariser',
      grants:    ['summarise.thread', 'evil.exfiltrate'],   // 2nd is undeclared
    });

    expect(res.granted.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(res.rejected).toEqual([{ skill: 'evil.exfiltrate', reason: 'not-declared' }]);
    // No token was ever issued for the undeclared skill.
    expect(tokens.revoked).toEqual([]);
    const entry = await registry.lookup('catalog:summariser');
    expect(entry.grants.map((g) => g.skill)).toEqual(['summarise.thread']);
    expect(entry.capabilities).not.toContain('evil.exfiltrate');
  });

  it('power-user override installs a NON-catalog card (bypasses the catalog)', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    // NOTE: no catalog source at all — the override path must not need one.
    const res = await installAgent({ registry, tokens }, {
      card:   OVERRIDE_CARD,
      grants: ['sideload.run'],
    });

    expect(res.ok).toBe(true);
    expect(res.source).toBe('override');
    expect(res.agentId).toBe('override:sideloaded');
    const entry = await registry.lookup('override:sideloaded');
    expect(entry.pubKey).toBe('pub-override-sideloaded');
    expect(entry.grants.map((g) => g.skill)).toEqual(['sideload.run']);
  });

  it('override accepts a pasted JSON string card', async () => {
    const registry = buildRegistry();
    const res = await installAgent({ registry }, { card: JSON.stringify(OVERRIDE_CARD) });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('override');
    expect(await registry.lookup('override:sideloaded')).not.toBeNull();
  });

  it('honest structured errors: missing identity, missing source, unknown entry', async () => {
    const registry = buildRegistry();
    // A card with no pubKey/id.
    expect((await installAgent({ registry }, { card: { name: 'anon', skills: [] } })).error)
      .toBe('card-missing-identity');
    // catalogId but no catalog source injected.
    expect((await installAgent({ registry }, { catalogId: 'x' })).error).toBe('no-catalog');
    // catalogId not present in the source.
    const catalog = createStubCatalog([CARD]);
    expect((await installAgent({ registry, catalog }, { catalogId: 'nope' })).error)
      .toBe('catalog-entry-not-found');
    // neither card nor catalogId.
    expect((await installAgent({ registry }, {})).error).toBe('card-or-catalogId-required');
  });

  it('uninstall reuses P2: purge hard-deletes, revoke soft-disables', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    const catalog  = createStubCatalog([CARD]);
    await installAgent({ registry, tokens, catalog }, {
      catalogId: 'catalog:summariser', grants: ['summarise.thread'],
    });

    // Soft uninstall (revoke) — sweeps the grant token, keeps the entry.
    const rev = await revokeAgent({ registry, tokens }, { agentId: 'catalog:summariser' });
    expect(rev.revoked).toBe(true);
    expect(rev.tokensRevoked).toBe(1);
    expect((await registry.lookup('catalog:summariser')).revokedAt).not.toBeNull();

    // Hard uninstall (purge) — entry gone entirely.
    const pur = await purgeAgent({ registry, tokens }, { agentId: 'catalog:summariser' });
    expect(pur.purged).toBe(true);
    expect(await registry.lookup('catalog:summariser')).toBeNull();
  });
});

/* ── 2. Pluggable catalog source + governance seam ─────────────────────── */
describe('agents — P3 listCatalog (pluggable source; governance stubbed)', () => {
  it('no source → the honest "coming with the community catalog" state', async () => {
    const res = await listCatalog({ registry: buildRegistry() }, {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-catalog');
    expect(typeof res.message).toBe('string');
    expect(res.catalog).toEqual([]);
  });

  it('with the default stub source → installable cards with declared skills', async () => {
    const catalog = createStubCatalog();   // the shipped placeholder set
    const res = await listCatalog({ registry: buildRegistry(), catalog }, {});
    expect(res.ok).toBe(true);
    expect(res.count).toBe(STUB_CATALOG_CARDS.length);
    const summ = res.catalog.find((c) => c.id === 'catalog:summariser');
    expect(summ.skills).toEqual(['summarise.document', 'summarise.thread']);
    // Renderer-facing items projection (id/label), same convention as recovery.
    expect(res.items.every((i) => typeof i.id === 'string' && typeof i.label === 'string')).toBe(true);
  });

  it('a card from the catalog is directly installable by the same act', async () => {
    const registry = buildRegistry();
    const catalog  = createStubCatalog();
    const list = await listCatalog({ registry, catalog }, {});
    const first = list.catalog[0];
    const res = await installAgent({ registry, catalog }, { catalogId: first.id });
    expect(res.ok).toBe(true);
    expect(res.agentId).toBe(first.id);
  });
});

/* ── 3. Capability-security = the anti-virus (REAL token + PolicyEngine) ── */
describe('agents — P3 capability-security: an installed agent can ONLY do what it was granted', () => {
  const GRANTED_SKILL   = 'summarise.thread';
  const UNGRANTED_SKILL = 'summarise.document';

  /**
   * Real composition: an issuer Agent (the token authority) + a vault-backed
   * TokenRegistry + a PolicyEngine over a SkillRegistry with BOTH declared
   * skills registered as `requires-token`. The tokens collaborator issues
   * REAL signed tokens through the issuer and keeps them so the test can
   * present them to the gate — exactly the shape realAgent.js wires.
   */
  async function makeSecuredWorld() {
    const bus      = new InternalBus();
    const issuerId = await AgentIdentity.generate(new VaultMemory());
    const issuer   = new Agent({ identity: issuerId, transport: new InternalTransport(bus, issuerId.pubKey) });
    await issuer.start();

    const tokenRegistry = new TokenRegistry(new VaultMemory());
    const issuedById    = new Map();
    const tokens = {
      async issue({ subject, skill, expiresIn, constraints }) {
        const token = await issuer.issueCapabilityToken({ subject, skill, expiresIn, constraints });
        await tokenRegistry.store(token);
        issuedById.set(token.id, token);
        return { id: token.id, expiresAt: new Date(token.expiresAt).toISOString() };
      },
      revoke: (id) => tokenRegistry.revoke(id),
    };

    // The gate: both skills require a token; the installed agent is an
    // authenticated caller; the issuer is trusted; revocation reads the
    // TokenRegistry (the realAgent wiring).
    const skills = new SkillRegistry();
    for (const id of [GRANTED_SKILL, UNGRANTED_SKILL]) {
      skills.register(id, async () => [], { visibility: 'authenticated', policy: 'requires-token' });
    }
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(issuerId.pubKey, 'trusted');            // token issuer is trusted
    await trust.setTier(CARD['x-onderling'].pubKey, 'authenticated'); // the installed agent (caller)
    const policy = new PolicyEngine({
      trustRegistry: trust,
      skillRegistry: skills,
      agentPubKey:   issuerId.pubKey,   // tokens are agentId-bound to the issuer
      isRevoked:     (id) => tokenRegistry.isRevoked(id),
    });

    return { issuer, tokens, tokenRegistry, issuedById, policy, callerPubKey: CARD['x-onderling'].pubKey };
  }

  it('grants ONLY the granted skill; the same token is DENIED for an ungranted skill', async () => {
    const world = await makeSecuredWorld();
    const registry = buildRegistry();
    const catalog  = createStubCatalog([CARD]);

    // Install granting ONLY the one skill.
    const res = await installAgent(
      { registry, tokens: world.tokens, catalog },
      { catalogId: 'catalog:summariser', grants: [GRANTED_SKILL] },
    );
    expect(res.tokenBacked).toBe(true);
    const tokenId = res.granted[0].tokenId;
    const token   = world.issuedById.get(tokenId).toJSON();   // the REAL signed token

    // ALLOWED — the installed agent presents its token for the GRANTED skill.
    const ok = await world.policy.checkInbound({
      peerPubKey: world.callerPubKey, skillId: GRANTED_SKILL, token,
    });
    expect(ok.allowed).toBe(true);

    // DENIED — the SAME token cannot be stretched to an UNGRANTED skill.
    await expect(world.policy.checkInbound({
      peerPubKey: world.callerPubKey, skillId: UNGRANTED_SKILL, token,
    })).rejects.toThrow(/grants skill/);

    // DENIED — with NO token the ungranted skill is unreachable, AND the
    // agent holds no token for it in the first place.
    await expect(world.policy.checkInbound({
      peerPubKey: world.callerPubKey, skillId: UNGRANTED_SKILL, token: null,
    })).rejects.toMatchObject({ code: 'NO_TOKEN' });
    expect(await world.tokenRegistry.get(world.issuer.pubKey, UNGRANTED_SKILL)).toBeNull();

    await world.issuer.stop();
  });

  it('revoke (reuse P2 revokeAgent) makes even the granted skill go inert', async () => {
    const world = await makeSecuredWorld();
    const registry = buildRegistry();
    const catalog  = createStubCatalog([CARD]);

    const res = await installAgent(
      { registry, tokens: world.tokens, catalog },
      { catalogId: 'catalog:summariser', grants: [GRANTED_SKILL] },
    );
    const token = world.issuedById.get(res.granted[0].tokenId).toJSON();

    // Before revoke: allowed.
    expect((await world.policy.checkInbound({
      peerPubKey: world.callerPubKey, skillId: GRANTED_SKILL, token,
    })).allowed).toBe(true);

    // Revoke the whole agent — sweeps its grant token.
    const rev = await revokeAgent({ registry, tokens: world.tokens }, { agentId: 'catalog:summariser' });
    expect(rev.tokensRevoked).toBe(1);

    // After revoke: the token is rejected at the gate (revocation enforced).
    await expect(world.policy.checkInbound({
      peerPubKey: world.callerPubKey, skillId: GRANTED_SKILL, token,
    })).rejects.toThrow(/revoked/i);

    await world.issuer.stop();
  });
});
