/**
 * agents — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision) + CONTROL-op semantics.
 *
 * Drives the shared harness with the agents app's cores + manifest,
 * backed by a REAL `createAgentRegistry` over a minimal in-memory
 * pseudo-pod stub (a Map behind `read`/`write`):
 *   • LOCAL route — the pure core in `AGENT_CORES` called directly over
 *     the `{ registry, tokens }` store.
 *   • WIRE route  — the SAME core, wrapped by `wireSkill` + registered
 *     as a `defineSkill`, invoked over the serialized parts path on a
 *     real `@onderling/sdk` agent.
 *
 * The harness runs TWICE: once with a deterministic mock token
 * collaborator (the token-backed path) and once without one (the
 * honest degraded `tokenBacked: false` path).  A third, direct-core
 * describe block asserts the ORDER discipline (decision 2 — token op
 * BEFORE registry mirror), best-effort continuation, and purge
 * semantics that equivalence comparison alone can't prove.
 *
 * RESOLUTION NOTE: `apps/agents` has no `node_modules` yet, so bare
 * `@onderling/*` imports don't resolve when this suite runs standalone.
 * The @onderling modules are therefore imported here via RELATIVE paths so
 * the test is self-contained.  `manifest.js` + `src/cores.js` are
 * import-free (no bare `@onderling/*`) and imported normally; the wire
 * defs are built inline below with the relative `wireSkill` — mirroring
 * `src/wireSkills.js`'s `buildAgentSkills` exactly (that module keeps
 * its bare `@onderling/sdk` import for eventual integration).
 */
import { describe, it, expect } from 'vitest';

// Relative @onderling imports so the suite runs without app-local node_modules.
import { createHash } from 'node:crypto';
import { createAgent, wireSkill, Parts } from '../../../packages/sdk/src/index.js';
import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';
import { createAgentRegistry } from '../../../packages/agent-registry/src/AgentRegistry.js';
import { createVersionStore } from '../../../packages/versioning/src/versionStore.js';
import { renderWeb } from '../../../packages/app-manifest/src/renderWeb.js';
import { validateManifest } from '../../../packages/app-manifest/src/validate.js';
import { fetchSectionItems } from '../../../packages/web-adapter/src/fetchSectionItems.js';

// App-local, import-free modules.
import { AGENT_CORES } from '../src/cores.js';
import { RECOVERY_CORES } from '../src/recoveryCores.js';
import { INSTALL_CORES } from '../src/installCores.js';
import { createStubCatalog } from '../src/defaultCatalog.js';
import { agentsManifest } from '../manifest.js';

const ALL_CORES = { ...AGENT_CORES, ...RECOVERY_CORES, ...INSTALL_CORES };

/**
 * Deterministic catalog fixture (install ops): a fixed stub source so
 * the two routes compare byte-for-byte. One card declares two skills; the
 * install cases grant a subset (capability-security) or install via the
 * power-user override with a pasted card.
 */
const CATALOG_CARD = Object.freeze({
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
const makeCatalog = () => createStubCatalog([CATALOG_CARD]);

const DEVICE = 'laptop-anne';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Deterministic seed resource (v2 agent-registry shape) — two active
 * agents + one soft-revoked, all with fixed stamps so the two routes
 * compare byte-for-byte.
 */
function seedResource() {
  return {
    v:         2,
    updatedAt: '2026-07-01T00:00:00.000Z',
    agents: [
      {
        agentId:      'laptop-anne',
        pubKey:       'pub-anne-laptop',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/laptop',
        role:         'device',
        name:         'Anne (laptop)',
        deviceId:     'laptop-anne',
        capabilities: ['tasks', 'stoop'],
        grants: [
          { tokenId: 't-1', skill: 'tasks.addTask', capability: 'tasks', subject: 'circle:home', expiresAt: '2027-01-01T00:00:00.000Z' },
        ],
        signedAt:  '2026-07-01T09:00:00.000Z',
        revokedAt: null,
      },
      {
        agentId:      'phone-anne',
        pubKey:       'pub-anne-phone',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/phone',
        role:         'device',
        name:         'Anne (phone)',
        deviceId:     'phone-anne',
        capabilities: ['tasks'],
        grants: [
          { tokenId: 't-2', skill: 'stoop.postRequest', capability: 'stoop', subject: null, expiresAt: null },
        ],
        signedAt:  '2026-07-01T08:00:00.000Z',
        revokedAt: null,
      },
      {
        agentId:      'old-tablet',
        pubKey:       'pub-anne-tablet',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/tablet',
        role:         'device',
        name:         'Anne (old tablet)',
        deviceId:     'old-tablet',
        capabilities: ['tasks'],
        grants:       [],
        // Soft-revoked — must be OMITTED from listAgents, but still
        // resolvable via viewAgent (status: 'revoked').
        signedAt:  '2026-06-01T00:00:00.000Z',
        revokedAt: '2026-06-15T00:00:00.000Z',
      },
    ],
  };
}

/** Minimal in-memory pseudo-pod: read/write a Map of uri → resource body. */
function makePseudoPodStub() {
  const map = new Map();
  return {
    _map: map,
    async read(uri) {
      return map.has(uri) ? { bytes: map.get(uri), etag: null } : null;
    },
    async write(uri, body /*, etag */) {
      map.set(uri, body);
      return { etag: null };
    },
  };
}

/** A fresh, deterministically-seeded registry over the stub. */
function buildRegistry() {
  const pod = makePseudoPodStub();
  const registry = createAgentRegistry({ pseudoPod: pod, deviceId: DEVICE });
  pod._map.set(registry.resourceUri, seedResource());
  return registry;
}

/**
 * Deterministic mock token collaborator (the duck-typed contract the
 * wire layer later binds to `Agent.issueCapabilityToken` +
 * `TokenRegistry.revoke`).  Sequential ids + a fixed expiry so results
 * compare byte-for-byte across the two routes; records every call for
 * the direct-core assertions.
 */
function makeMockTokens() {
  let n = 0;
  const issued  = [];
  const revoked = [];
  return {
    issued,
    revoked,
    async issue({ subject, skill, expiresIn }) {
      n += 1;
      issued.push({ subject, skill, expiresIn });
      return { id: `tok-${n}`, expiresAt: '2026-12-31T00:00:00.000Z' };
    },
    async revoke(tokenId) {
      revoked.push(tokenId);
    },
  };
}

/**
 * Deterministic per-circle version-store fixture (recovery ops): a
 * REAL `createVersionStore` over a Map backend, frozen clock, seeded
 * with two captures (ts 1000 'v1-original' → ts 7000 'v2-current';
 * clock parked at 9000 so restore's pre-snapshot lands at a fixed ts).
 * Both routes build IDENTICAL fixtures → results compare byte-for-byte.
 */
const shaJson = async (c) => createHash('sha256')
  .update(typeof c === 'string' ? c : JSON.stringify(c) ?? 'undefined', 'utf8')
  .digest('hex');
const FIXTURE_URI = 'pseudo-pod://circle-home/items/post-1';

function makeVersionFixture() {
  const bytes = new Map();
  const backend = {
    async get(k)     { return bytes.has(k) ? { bytes: bytes.get(k) } : null; },
    async put(k, b)  { bytes.set(k, b); return { etag: '"e"', _v: 1 }; },
    async delete(k)  { bytes.delete(k); },
    async list(p)    { return [...bytes.keys()].filter((k) => k.startsWith(p)).sort(); },
  };
  const live = new Map();
  let t = 1000;
  const store = createVersionStore({
    backend, hash: shaJson, now: () => t, writerId: 'circle-home',
    readLive:  async (uri) => live.get(uri),
    writeLive: async (uri, c) => { live.set(uri, c); },
  });
  const seed = async () => {
    live.set(FIXTURE_URI, 'v2-current');
    t = 1000; await store.capture(FIXTURE_URI, 'v1-original');
    t = 7000; await store.capture(FIXTURE_URI, 'v2-current');
    t = 9000; // restore's pre-snapshot ts
  };
  // Resolver contract: only circle 'home' has a store (others → null).
  const versionStoreFor = (circleId) => (circleId === 'home' ? store : null);
  return { seed, versionStoreFor, live };
}

/** LOCAL invoker: call the pure core directly over the store. */
function makeLocalInvokerWith({ withTokens, withVersions = false, withCatalog = false }) {
  return () => {
    const fixture = withVersions ? makeVersionFixture() : null;
    const store = {
      registry:        buildRegistry(),
      tokens:          withTokens ? makeMockTokens() : null,
      versionStoreFor: fixture ? fixture.versionStoreFor : null,
      catalog:         withCatalog ? makeCatalog() : null,
    };
    let seeded = null;
    return async (op, args = {}, ctx = {}) => {
      if (fixture) await (seeded ??= fixture.seed());
      return ALL_CORES[op](store, args, ctx);
    };
  };
}

/** Wire defs — mirrors src/wireSkills.js's buildAgentSkills (relative wireSkill). */
function buildWireDefs(registry, tokens = null, versionStoreFor = null, catalog = null) {
  const store = { registry, tokens, versionStoreFor, catalog };
  const storeFor = () => store;
  const op = (id) => agentsManifest.operations.find((o) => o.id === id);
  const wire = (id) => ({
    id,
    handler:    wireSkill(ALL_CORES[id], op(id), { storeFor }),
    visibility: 'authenticated',
  });
  return [
    wire('listAgents'),
    wire('viewAgent'),
    wire('createProfile'),
    wire('setProfileProperty'),
    wire('getProfileProperties'),
    wire('setProfileDriver'),
    wire('getProfileDrivers'),
    wire('setProfileDisclosure'),
    wire('getProfileDisclosure'),
    wire('getPersonaView'),
    wire('getPersonaRelease'),
    wire('setAgentSkillExposure'),
    wire('getAgentSkillExposure'),
    wire('revokeAgent'),
    wire('grantAgent'),
    wire('grantRole'),
    wire('revokeGrant'),
    wire('purgeAgent'),
    wire('listDataVersions'),
    wire('restoreDataVersion'),
    wire('listCatalog'),
    wire('installAgent'),
  ];
}

/** WIRE invoker: fresh real agent with the wire skills; serialized invoke. */
function makeWireInvokerWith({ withTokens, withVersions = false, withCatalog = false }) {
  return async () => {
    const registry = buildRegistry();
    const tokens   = withTokens ? makeMockTokens() : null;
    const fixture  = withVersions ? makeVersionFixture() : null;
    const catalog  = withCatalog ? makeCatalog() : null;
    if (fixture) await fixture.seed();
    const agent = await createAgent();
    for (const s of buildWireDefs(registry, tokens, fixture ? fixture.versionStoreFor : null, catalog)) {
      agent.register(s.id, s.handler, { visibility: s.visibility });
    }
    return {
      invoke: async (op, args = {}) =>
        Parts.data(await agent.invoke(agent.address, op, Parts.wrap(args))),
      stop: () => agent.stop(),
    };
  };
}

/* ── Harness run 1 — token-backed path (mock collaborator injected) ───── */
describeLocalWireFitness(
  {
    app:           'agents',
    coreIds:       Object.keys(ALL_CORES),
    registeredIds: buildWireDefs(buildRegistry(), makeMockTokens()).map((s) => s.id),
    manifestOpIds: agentsManifest.operations.map((o) => o.id),
    makeLocalInvoker: makeLocalInvokerWith({ withTokens: true, withVersions: true, withCatalog: true }),
    makeWireInvoker:  makeWireInvokerWith({ withTokens: true, withVersions: true, withCatalog: true }),
    cases: [
      {
        // Proves soft-revoke filtering: 'old-tablet' is absent (2 rows).
        name: 'listAgents (non-revoked roster)',
        run:  (invoke) => invoke('listAgents', {}),
      },
      {
        // Detail by agentId — skills derived from grants + capabilities.
        name: 'viewAgent by agentId',
        run:  (invoke) => invoke('viewAgent', { agentId: 'laptop-anne' }),
      },
      {
        // Detail by pubKey — proves pubKey resolution (not webid).
        name: 'viewAgent by pubKey',
        run:  (invoke) => invoke('viewAgent', { agentId: 'pub-anne-phone' }),
      },
      {
        // Detail of a soft-revoked agent still resolves (status: revoked).
        name: 'viewAgent of a revoked agent (status surfaced)',
        run:  (invoke) => invoke('viewAgent', { agentId: 'old-tablet' }),
      },
      {
        // Grant — token issued (deterministic tok-1) + mirrored into the
        // entry; explicit capability/expiry/subject args honoured.
        name: 'grantAgent (explicit capability + expiry + subject)',
        run:  (invoke) => invoke('grantAgent', {
          agentId:       'phone-anne',
          skill:         'stoop.report',
          capability:    'stoop',
          expiresInDays: 7,
          subject:       'pub-anne-phone',
        }),
      },
      {
        // Grant with defaults — capability ← skill, subject ← the
        // entry's pubKey, expiry ← 30 days.
        name: 'grantAgent (defaults: capability=skill, subject=pubKey)',
        run:  (invoke) => invoke('grantAgent', { agentId: 'pub-anne-laptop', skill: 'folio.sync' }),
      },
      {
        // Full-agent revoke: 1 grant token revoked, entry soft-revoked,
        // read-back shows status 'revoked' + drops off the roster.
        name: 'revokeAgent (tokens revoked, then registry; off the roster)',
        run:  async (invoke) => {
          const revoked = await invoke('revokeAgent', { agentId: 'laptop-anne' });
          const roster  = await invoke('listAgents', {});
          return { revoked, roster };
        },
      },
      {
        // Single-grant revoke (adjust): grant t-2 removed + its orphaned
        // coarse capability un-mirrored from the entry.
        name: 'revokeGrant (grant removed + capability un-mirrored)',
        run:  async (invoke) => {
          const revoked = await invoke('revokeGrant', { agentId: 'phone-anne', tokenId: 't-2' });
          const view    = await invoke('viewAgent', { agentId: 'phone-anne' });
          return { revoked, view };
        },
      },
      {
        // Hard delete works on an ALREADY-REVOKED agent; read-back
        // proves the entry is gone (not merely hidden).
        name: 'purgeAgent (removes even a revoked entry)',
        run:  async (invoke) => {
          const purged = await invoke('purgeAgent', { agentId: 'old-tablet' });
          const view   = await invoke('viewAgent', { agentId: 'old-tablet' });
          return { purged, view };
        },
      },

      /* ── recovery (deterministic version fixture, circle 'home') ── */
      {
        // Series roster (no uri) + one resource's versions (with uri).
        name: 'listDataVersions (series roster + per-uri pick-list)',
        run:  async (invoke) => {
          const series   = await invoke('listDataVersions', { circleId: 'home' });
          const versions = await invoke('listDataVersions', { circleId: 'home', uri: FIXTURE_URI });
          return { series, versions };
        },
      },
      {
        // Unknown circle → honest structured miss (no throw).
        name: 'listDataVersions of an unknown circle → no-version-store',
        run:  (invoke) => invoke('listDataVersions', { circleId: 'nope' }),
      },
      {
        // Roll back to ts 1000 ('v1-original'); the pre-restore snapshot
        // lands at the frozen ts 9000 — fully deterministic both routes.
        name: 'restoreDataVersion (undoable rollback to a prior version)',
        run:  async (invoke) => {
          const restored = await invoke('restoreDataVersion', {
            circleId: 'home', uri: FIXTURE_URI, version: '1000',
          });
          const after = await invoke('listDataVersions', { circleId: 'home', uri: FIXTURE_URI });
          return { restored, after };
        },
      },
      {
        // Boundary miss → structured VERSION_NOT_FOUND, mirroring how
        // callSkill surfaces skill errors.
        name: 'restoreDataVersion of a missing version → structured error',
        run:  (invoke) => invoke('restoreDataVersion', {
          circleId: 'home', uri: FIXTURE_URI, version: '424242',
        }),
      },

      /* ── install (deterministic stub catalog) ─────────────────────── */
      {
        // The curated catalog roster (one stub card, two declared skills).
        name: 'listCatalog (curated source roster)',
        run:  (invoke) => invoke('listCatalog', {}),
      },
      {
        // CAPABILITY-SECURITY: install a catalog card granting ONLY one of
        // its two declared skills → the installed agent holds exactly that
        // grant (the other declared skill is declined, never granted).
        name: 'installAgent (curated, capability-security: grant a subset)',
        // A freshly registered agent's signedAt→lastSeen is wall-clock.
        volatile: ['lastSeen'],
        run:  async (invoke) => {
          const installed = await invoke('installAgent', {
            catalogId: 'catalog:summariser',
            grants:    JSON.stringify(['summarise.thread']),
          });
          const view = await invoke('viewAgent', { agentId: 'catalog:summariser' });
          return { installed, view };
        },
      },
      {
        // Power-user OVERRIDE: install a non-catalog card (bypasses the
        // catalog), granting its declared skill.
        name: 'installAgent (power-user override, pasted card)',
        volatile: ['lastSeen'],
        run:  async (invoke) => {
          const installed = await invoke('installAgent', {
            card:   JSON.stringify(OVERRIDE_CARD),
            grants: JSON.stringify(['sideload.run']),
          });
          const roster = await invoke('listAgents', {});
          return { installed, roster };
        },
      },
      {
        // DEFAULT-DENY + reject-undeclared: install with NO grants leaves
        // the agent inert; a grant for a skill the card never declared is
        // rejected (no token issued), not silently granted.
        name: 'installAgent (default-deny + rejects an undeclared skill)',
        volatile: ['lastSeen'],
        run:  async (invoke) => {
          const inert = await invoke('installAgent', { catalogId: 'catalog:summariser' });
          const rejected = await invoke('installAgent', {
            catalogId: 'catalog:summariser',
            grants:    JSON.stringify(['summarise.thread', 'evil.exfiltrate']),
          });
          return { inert, rejected };
        },
      },
    ],
  },
  { describe, it, expect },
);

/* ── Harness run 2 — degraded path (NO token collaborator) ─────────────
 * The control ops still keep the registry mirror honest but must say so:
 * `tokenBacked: false`, `tokensRevoked: 0`.  The synthetic `local-…`
 * tokenId + wall-clock expiry are per-route volatile → stripped.
 */
describeLocalWireFitness(
  {
    app:           'agents (no token collaborator — degraded, honest)',
    coreIds:       Object.keys(ALL_CORES),
    registeredIds: buildWireDefs(buildRegistry()).map((s) => s.id),
    manifestOpIds: agentsManifest.operations.map((o) => o.id),
    makeLocalInvoker: makeLocalInvokerWith({ withTokens: false }),
    makeWireInvoker:  makeWireInvokerWith({ withTokens: false }),
    cases: [
      {
        name: 'revokeAgent without tokens → tokenBacked false, still revoked',
        run:  async (invoke) => {
          const revoked = await invoke('revokeAgent', { agentId: 'laptop-anne' });
          const roster  = await invoke('listAgents', {});
          return { revoked, roster };
        },
      },
      {
        name:     'grantAgent without tokens → tokenBacked false, mirror still written',
        // Synthetic tokenId + Date.now()-derived expiry differ per route.
        volatile: ['tokenId', 'expiresAt'],
        run:  (invoke) => invoke('grantAgent', { agentId: 'phone-anne', skill: 'tasks.listTasks' }),
      },
      {
        // No versionStoreFor injected at all (this run) → the recovery ops
        // answer the honest degraded miss on both routes.
        name: 'listDataVersions without a resolver → no-version-store',
        run:  (invoke) => invoke('listDataVersions', { circleId: 'home' }),
      },
      {
        // No catalog source injected → the honest "coming with the
        // community catalog" state on both routes.
        name: 'listCatalog without a source → no-catalog',
        run:  (invoke) => invoke('listCatalog', {}),
      },
      {
        // Override install still works WITHOUT a catalog (bypasses it);
        // degraded tokens → tokenBacked false, mirror still written.
        name: 'installAgent override without tokens → tokenBacked false, mirror written',
        volatile: ['tokenId', 'expiresAt', 'lastSeen'],
        run:  (invoke) => invoke('installAgent', {
          card:   JSON.stringify(OVERRIDE_CARD),
          grants: JSON.stringify(['sideload.run']),
        }),
      },
    ],
  },
  { describe, it, expect },
);

/* ── Direct-core semantics — what equivalence alone can't prove ──────── */
describe('agents — P2 control-op semantics (direct core)', () => {
  it('grantAgent: token issued BEFORE the registry mirror (order discipline)', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    const events   = [];
    const issueOrig = tokens.issue.bind(tokens);
    tokens.issue = async (a) => { events.push('tokens.issue'); return issueOrig(a); };
    const applyOrig = registry.applyGrant;
    const spied = {
      ...registry,
      applyGrant: async (...a) => { events.push('registry.applyGrant'); return applyOrig(...a); },
    };

    const res = await AGENT_CORES.grantAgent(
      { registry: spied, tokens },
      { agentId: 'phone-anne', skill: 'stoop.report' },
    );

    expect(events).toEqual(['tokens.issue', 'registry.applyGrant']);
    expect(res.granted).toBe(true);
    expect(res.tokenBacked).toBe(true);
    expect(res.tokenId).toBe('tok-1');
    // Defaults honoured on the token side: subject ← pubKey, 30 days.
    expect(tokens.issued).toEqual([
      { subject: 'pub-anne-phone', skill: 'stoop.report', expiresIn: 30 * MS_PER_DAY },
    ]);
    // Mirror matches the issued token (read-back in the result).
    expect(res.agent.grantSummary.tokens).toContainEqual({
      tokenId:    'tok-1',
      skill:      'stoop.report',
      capability: 'stoop.report',        // capability defaults to skill
      subject:    'pub-anne-phone',
      expiresAt:  '2026-12-31T00:00:00.000Z',
    });
    expect(res.agent.skills).toContain('stoop.report');
  });

  it('grantAgent: a token-issue failure propagates and the mirror is untouched', async () => {
    const registry = buildRegistry();
    const tokens = {
      async issue() { throw new Error('issuer offline'); },
      async revoke() {},
    };

    await expect(
      AGENT_CORES.grantAgent({ registry, tokens }, { agentId: 'phone-anne', skill: 'stoop.report' }),
    ).rejects.toThrow('issuer offline');

    // Never mirror a grant whose token doesn't exist.
    const entry = await registry.lookup('phone-anne');
    expect(entry.grants.map((g) => g.tokenId)).toEqual(['t-2']);
  });

  it('revokeAgent: revokes each grant token FIRST (best-effort), then the registry', async () => {
    const registry = buildRegistry();
    // Give laptop-anne a second grant so best-effort continuation shows.
    await registry.applyGrant('laptop-anne', { tokenId: 't-9', skill: 'folio.sync', capability: 'folio' });

    const events = [];
    const tokens = {
      async issue() { throw new Error('unused'); },
      async revoke(tokenId) {
        events.push(`tokens.revoke:${tokenId}`);
        if (tokenId === 't-1') throw new Error('token store hiccup');   // individual failure
      },
    };
    const revokeOrig = registry.revoke;
    const spied = {
      ...registry,
      revoke: async (...a) => { events.push('registry.revoke'); return revokeOrig(...a); },
    };

    const res = await AGENT_CORES.revokeAgent({ registry: spied, tokens }, { agentId: 'laptop-anne' });

    // Both tokens attempted BEFORE the registry revoke; the t-1 failure
    // doesn't stop t-9 nor the registry side.
    expect(events).toEqual(['tokens.revoke:t-1', 'tokens.revoke:t-9', 'registry.revoke']);
    expect(res).toMatchObject({ revoked: true, tokensRevoked: 1, tokenBacked: true });
    expect(res.agent.status).toBe('revoked');
    // Gone from the roster, still resolvable in detail.
    const roster = await AGENT_CORES.listAgents({ registry });
    expect(roster.agents.map((a) => a.agentId)).toEqual(['phone-anne']);
  });

  it('revokeAgent without tokens: honest degraded result, registry still revoked', async () => {
    const registry = buildRegistry();
    const res = await AGENT_CORES.revokeAgent({ registry }, { agentId: 'pub-anne-laptop' });
    expect(res).toMatchObject({ revoked: true, tokensRevoked: 0, tokenBacked: false });
    expect(res.agent.status).toBe('revoked');
  });

  it('revokeAgent: unknown id → revoked false, nothing touched', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    const res = await AGENT_CORES.revokeAgent({ registry, tokens }, { agentId: 'nope' });
    expect(res).toEqual({ revoked: false, tokensRevoked: 0, tokenBacked: true, agent: null });
    expect(tokens.revoked).toEqual([]);
  });

  it('revokeGrant: token revoked, then grant un-mirrored (orphaned capability dropped)', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();

    const res = await AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-2' });

    expect(tokens.revoked).toEqual(['t-2']);
    expect(res.revoked).toBe(true);
    expect(res.tokenBacked).toBe(true);
    // Grant gone; 'stoop' was only referenced by t-2 → un-mirrored too
    // ('tasks' was never grant-backed and stays).
    expect(res.agent.grantSummary.total).toBe(0);
    expect(res.agent.skills).toEqual(['tasks']);
  });

  it('revokeGrant: a token-revoke failure propagates and the grant stays mirrored', async () => {
    const registry = buildRegistry();
    const tokens = {
      async issue() { throw new Error('unused'); },
      async revoke() { throw new Error('token store down'); },
    };

    await expect(
      AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-2' }),
    ).rejects.toThrow('token store down');

    // Never un-mirror a still-live token (the UI must not under-claim).
    const entry = await registry.lookup('phone-anne');
    expect(entry.grants.map((g) => g.tokenId)).toEqual(['t-2']);
  });

  it('revokeGrant: unknown tokenId → revoked false, token side untouched', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    const res = await AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-404' });
    expect(res.revoked).toBe(false);
    expect(tokens.revoked).toEqual([]);
    expect(res.agent.grantSummary.total).toBe(1);   // grant still there
  });

  it('purgeAgent: hard-deletes even an already-revoked entry; idempotent on a miss', async () => {
    const registry = buildRegistry();

    const first = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'old-tablet' });
    expect(first).toEqual({ purged: true, tokensRevoked: 0, tokenBacked: false, agent: null });   // read-back proves it's gone
    expect(await registry.lookup('old-tablet')).toBeNull();
    expect((await registry.list()).map((a) => a.agentId)).toEqual(['laptop-anne', 'phone-anne']);

    const again = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'old-tablet' });
    expect(again).toEqual({ purged: false, tokensRevoked: 0, tokenBacked: false, agent: null });
  });

  it('purgeAgent sweeps live grant tokens BEFORE erasing the entry (no invisible authority)', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    // Give the agent a live token-backed grant, then purge WITHOUT revoking first.
    await AGENT_CORES.grantAgent({ registry, tokens }, { agentId: 'old-tablet', skill: 'bot.*' });
    const granted = await registry.lookup('old-tablet');
    const liveTokenId = granted.grants[granted.grants.length - 1].tokenId;

    const res = await AGENT_CORES.purgeAgent({ registry, tokens }, { agentId: 'old-tablet' });
    expect(tokens.revoked).toContain(liveTokenId);   // enforced authority died first
    expect(res).toMatchObject({ purged: true, tokenBacked: true, agent: null });
    expect(res.tokensRevoked).toBeGreaterThanOrEqual(1);
    expect(await registry.lookup('old-tablet')).toBeNull();
  });

  it('purgeAgent: resolves by pubKey too (never webid)', async () => {
    const registry = buildRegistry();
    const byPubKey = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'pub-anne-phone' });
    expect(byPubKey.purged).toBe(true);
    // webid must NOT resolve (it matches several entries by design).
    const byWebid = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'https://anne.pod/profile#me' });
    expect(byWebid).toEqual({ purged: false, tokensRevoked: 0, tokenBacked: false, agent: null });
  });

  it('backward compat: a bare registry still works as the store (read ops)', async () => {
    const registry = buildRegistry();
    const roster = await AGENT_CORES.listAgents(registry);
    expect(roster.agents).toHaveLength(2);
    const view = await AGENT_CORES.viewAgent(registry, { agentId: 'laptop-anne' });
    expect(view.agent.agentId).toBe('laptop-anne');
    // Control ops accept it too — degraded (no tokens by definition).
    const res = await AGENT_CORES.revokeAgent(registry, { agentId: 'laptop-anne' });
    expect(res).toMatchObject({ revoked: true, tokenBacked: false });
  });
});

/* ── grantRole — roles as capability bundles (direct core) ───────────
 * grantRole delegates to a `roleGrants` collaborator (core's
 * RoleGrantManager) that sets the governance role AND materializes the
 * bundle's cap-tokens.  Equivalence across routes is covered structurally
 * by the degraded path (no collaborator → identical on both routes); these
 * direct-core cases prove the token-backed materialization + resolution.
 */
describe('agents — grantRole (roles as capability bundles, direct core)', () => {
  /** Deterministic mock RoleGrantManager: records grants, returns fixed ids. */
  function makeMockRoleGrants() {
    const grants = [];
    return {
      grants,
      async grant({ memberPubKey, groupId, roleId, expiresIn }) {
        grants.push({ memberPubKey, groupId, roleId, expiresIn });
        return {
          roleId,
          rank:   70,
          proof:  { role: roleId, memberPubKey, groupId },
          tokens: [{ id: `role-tok-1` }, { id: `role-tok-2` }],
        };
      },
    };
  }

  it('materializes the bundle: sets the role and reports the token ids (subject named)', async () => {
    const registry = buildRegistry();
    const roleGrants = makeMockRoleGrants();
    const res = await AGENT_CORES.grantRole(
      { registry, roleGrants },
      { groupId: 'my-circle', role: 'warden', subject: 'member-W-pubkey', expiresInDays: 2 },
    );
    expect(res).toEqual({
      granted:    true,
      roleBacked: true,
      role:       'warden',
      rank:       70,
      groupId:    'my-circle',
      subject:    'member-W-pubkey',
      tokenIds:   ['role-tok-1', 'role-tok-2'],
    });
    expect(roleGrants.grants).toEqual([
      { memberPubKey: 'member-W-pubkey', groupId: 'my-circle', roleId: 'warden', expiresIn: 2 * MS_PER_DAY },
    ]);
  });

  it('resolves the member by agentId/pubKey when no subject is given', async () => {
    const registry = buildRegistry();
    const roleGrants = makeMockRoleGrants();
    const res = await AGENT_CORES.grantRole(
      { registry, roleGrants },
      { groupId: 'g', role: 'admin', agentId: 'phone-anne' },
    );
    // phone-anne → its pubKey becomes the grant subject.
    expect(res.granted).toBe(true);
    expect(res.subject).toBe('pub-anne-phone');
    expect(roleGrants.grants[0].memberPubKey).toBe('pub-anne-phone');
  });

  it('degrades honestly with no collaborator (roleBacked false, nothing materialized)', async () => {
    const registry = buildRegistry();
    const res = await AGENT_CORES.grantRole(
      { registry },
      { groupId: 'g', role: 'warden', subject: 'w' },
    );
    expect(res).toEqual({
      granted: false, roleBacked: false, role: null, rank: null,
      groupId: null, subject: null, tokenIds: [],
    });
  });

  it('missing groupId / role / member → degraded (no grant attempted)', async () => {
    const registry = buildRegistry();
    const roleGrants = makeMockRoleGrants();
    const res = await AGENT_CORES.grantRole({ registry, roleGrants }, { role: 'warden', subject: 'w' });
    expect(res.granted).toBe(false);
    expect(res.roleBacked).toBe(true);   // a collaborator IS present, but args are incomplete
    expect(roleGrants.grants).toEqual([]);
  });
});

/* ── recovery VIEWS — the browsable "restore lost data" surface ──────
 * The recovery ops must be reachable BY SCREEN, not only via chat/LLM
 * (manifest = the single contract; renderWeb projects it).  Asserts:
 *   1. the manifest (with the two new views) still validates STRICT
 *      (skillId cross-check against operations[]);
 *   2. both data-version views project with the right dataSource +
 *      context args ($circleId; the detail adds $uri);
 *   3. restoreDataVersion surfaces as a danger-confirm itemAction on
 *      the data-version sections ONLY (never on the agent sections);
 *   4. the core's ADDITIVE `items` key carries {id, label} rows the
 *      list renderer reads — while `series`/`versions` stay intact;
 *   5. the whole seam end-to-end: fetchSectionItems substitutes the
 *      section's context args and the reply's items are renderable.
 */
describe('agents — P3 recovery views (renderWeb projection)', () => {
  const nav = renderWeb(agentsManifest);
  const section = (id) => nav.sections.find((s) => s.id === id);

  it('manifest with the recovery views validates (strict skillId cross-check)', () => {
    const res = validateManifest(agentsManifest, { strict: true });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('data-versions LIST view projects with the series dataSource + $circleId context arg', () => {
    const s = section('data-versions');
    expect(s).toBeDefined();
    expect(s.itemType).toBe('data-version');
    expect(s.labelField).toBe('uri');
    expect(s.dataSource).toEqual({
      skillId:         'listDataVersions',
      argsFromContext: { circleId: '$circleId' },
    });
    // No shape:'record' — the roster is a plain list.
    expect(s.shape).toBeUndefined();
  });

  it('data-version-detail view projects the per-uri pick-list ($circleId + $uri)', () => {
    const s = section('data-version-detail');
    expect(s).toBeDefined();
    expect(s.itemType).toBe('data-version');
    expect(s.dataSource).toEqual({
      skillId:         'listDataVersions',
      argsFromContext: { circleId: '$circleId', uri: '$uri' },
    });
    // The drilldown is itself a LIST (a version pick-list), not a record.
    expect(s.shape).toBeUndefined();
  });

  it('restoreDataVersion is a danger-confirm itemAction on BOTH data-version sections', () => {
    for (const id of ['data-versions', 'data-version-detail']) {
      const s = section(id);
      const restore = s.itemActions.find((a) => a.opId === 'restoreDataVersion');
      expect(restore, `restore action on ${id}`).toBeDefined();
      expect(restore.label).toBe('Restore version');
      expect(restore.appliesTo).toEqual({ type: 'data-version' });
      expect(restore.confirm.severity).toBe('danger');
      expect(typeof restore.confirm.message).toBe('string');
      // listDataVersions is the section's data source, never a button.
      expect(s.itemActions.map((a) => a.opId)).not.toContain('listDataVersions');
      // No creative verbs on data-version → no add affordances.
      expect(s.affordances).toEqual([]);
    }
  });

  it('the restore action stays scoped to data-version (agent sections untouched)', () => {
    for (const id of ['agents', 'agent-detail']) {
      expect(section(id).itemActions.map((a) => a.opId)).not.toContain('restoreDataVersion');
    }
    // And conversely: agent control ops don't leak onto the recovery sections.
    for (const id of ['data-versions', 'data-version-detail']) {
      const opIds = section(id).itemActions.map((a) => a.opId);
      expect(opIds).not.toContain('revokeAgent');
      expect(opIds).not.toContain('purgeAgent');
    }
  });

  it('listDataVersions additively exposes `items` rows (series mode: id/label ← uri)', async () => {
    const fixture = makeVersionFixture();
    await fixture.seed();
    const store = { versionStoreFor: fixture.versionStoreFor };

    const res = await RECOVERY_CORES.listDataVersions(store, { circleId: 'home' });
    expect(res.ok).toBe(true);
    // Domain key intact…
    expect(res.series).toEqual([{ uri: FIXTURE_URI, latestMs: 7000, count: 2 }]);
    // …and the additive renderer key mirrors the SAME rows with id+label.
    expect(res.items).toEqual([
      { uri: FIXTURE_URI, latestMs: 7000, count: 2, id: FIXTURE_URI, label: FIXTURE_URI },
    ]);
  });

  it('listDataVersions additively exposes `items` rows (versions mode: label ← ISO(ts) · id)', async () => {
    const fixture = makeVersionFixture();
    await fixture.seed();
    const store = { versionStoreFor: fixture.versionStoreFor };

    const res = await RECOVERY_CORES.listDataVersions(store, { circleId: 'home', uri: FIXTURE_URI });
    expect(res.ok).toBe(true);
    expect(res.versions).toHaveLength(2);            // domain key intact, newest-first
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.id)).toEqual(res.versions.map((v) => v.id));
    // Newest first: ts 7000 then 1000; label is deterministic ISO(ts) · id.
    expect(res.items[0].label).toBe(`1970-01-01T00:00:07.000Z · ${res.versions[0].id}`);
    expect(res.items[1].label).toBe(`1970-01-01T00:00:01.000Z · ${res.versions[1].id}`);
    // Rows keep the pick-list fields the restore needs.
    expect(res.items[0]).toMatchObject({ ts: 7000, sha256: res.versions[0].sha256 });
  });

  it('degraded miss keeps its honest shape (no items key invented on ok:false)', async () => {
    const res = await RECOVERY_CORES.listDataVersions({}, { circleId: 'home' });
    expect(res).toEqual({ ok: false, error: 'no-version-store', circleId: 'home' });
  });

  it('end-to-end seam: fetchSectionItems substitutes $circleId/$uri and yields renderable items', async () => {
    const fixture = makeVersionFixture();
    await fixture.seed();
    const store = { versionStoreFor: fixture.versionStoreFor };
    const callSkill = (skillId, args) => ALL_CORES[skillId](store, args);

    // Series section — host materializer supplies the active circle.
    const roster = await fetchSectionItems(section('data-versions'), {
      callSkill, context: { circleId: 'home' },
    });
    expect(roster.items.map((i) => i.label)).toEqual([FIXTURE_URI]);

    // Detail section — host ALSO supplies $uri (the picked series row).
    const picks = await fetchSectionItems(section('data-version-detail'), {
      callSkill, context: { circleId: 'home', uri: FIXTURE_URI },
    });
    expect(picks.uri).toBe(FIXTURE_URI);
    expect(picks.items).toHaveLength(2);
    expect(picks.items.every((i) => typeof i.id === 'string' && typeof i.label === 'string')).toBe(true);
  });
});
