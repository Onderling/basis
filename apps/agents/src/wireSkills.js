/**
 * wireSkills — the WIRE route for the agents app.
 *
 * Wraps each pure core in `AGENT_CORES` with `wireSkill(coreFn, op,
 * { storeFor })` — the manifest op stays the single contract; the
 * `defineSkill`-shaped handler is DERIVED from it (same generator
 * tasks-v0 / stoop use).  `storeFor` resolves the scope store from the
 * skill context; for this single-user surface the store is the injected
 * `{ registry, tokens? }` pair regardless of ctx:
 *   • `registry` — the `@onderling/agent-registry` instance (mirror truth).
 *   • `tokens`   — OPTIONAL token collaborator
 *     `{ issue({subject, skill, expiresIn}) → Promise<{id, expiresAt?}>,
 *        revoke(tokenId) → Promise<void> }`
 *     — the eventual binding is `Agent.issueCapabilityToken` +
 *     `TokenRegistry.revoke`. Without it the control ops run in the
 *     honest degraded mode (`tokenBacked: false`, mirror-only).
 *
 * Returns `[{ id, handler, visibility }]` — register each on a
 * `core.Agent` via `agent.register(id, handler, { visibility })`.
 *
 * NB: the eventual basis integration (composeManifests / realAgent)
 * is a later step and is NOT wired here.
 */
import { buildSkillsFromManifest } from '@onderling/sdk';

import { agentsManifest } from '../manifest.js';
import { AGENT_CORES } from './cores.js';
import { RECOVERY_CORES } from './recoveryCores.js';
import { INSTALL_CORES } from './installCores.js';

/**
 * @param {object} args
 * @param {object} args.registry  an `@onderling/agent-registry` instance
 *   (`createAgentRegistry({ pseudoPod, deviceId })`) — the store the
 *   cores read + mutate.
 * @param {object} [args.tokens]  optional duck-typed token collaborator
 *   (see module doc) backing the grant/revoke ops.
 * @param {(circleId: string) => object|null} [args.versionStoreFor]
 *   optional resolver to a circle pod's `@onderling/versioning` store,
 *   backing the recovery ops (web: `getCircleVersionStore`; mobile:
 *   its RN twin). Without it the recovery ops answer an honest
 *   `{ok:false, error:'no-version-store'}` — always wired, never hidden,
 *   so route parity stays unconditional.
 * @param {object} [args.catalogue]  optional pluggable curated-catalogue
 *   SOURCE ({ list, get }) backing the install ops (default: the local
 *   `createStubCatalogue`). Without it `listCatalogue` answers the honest
 *   `no-catalogue` "coming with the community catalogue" state and only the
 *   power-user override (install from a pasted card) works.
 *   commons-governance: the source's trust/curation is designed
 *   separately — buildAgentSkills treats it as opaque data.
 * @returns {Array<{ id: string, handler: Function, visibility: string }>}
 */
export function buildAgentSkills({ registry, tokens, versionStoreFor, catalogue, profiles, roleGrants } = {}) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('buildAgentSkills: registry (agent-registry) with list() required');
  }
  if (tokens && (typeof tokens.issue !== 'function' || typeof tokens.revoke !== 'function')) {
    throw new TypeError('buildAgentSkills: tokens must expose issue() and revoke() when supplied');
  }
  if (versionStoreFor != null && typeof versionStoreFor !== 'function') {
    throw new TypeError('buildAgentSkills: versionStoreFor must be a function when supplied');
  }
  if (catalogue != null && typeof catalogue.list !== 'function') {
    throw new TypeError('buildAgentSkills: catalogue must expose list() when supplied');
  }

  // Single-user surface — the store is the injected bundle for every ctx.
  const store = {
    registry,
    tokens:          tokens ?? null,
    versionStoreFor: versionStoreFor ?? null,
    catalogue:         catalogue ?? null,
    profiles:        profiles ?? null,   // identity step 4 — createProfile collaborator (owner-root-backed)
    roleGrants:      roleGrants ?? null, // grantRole collaborator (core RoleGrantManager: setRole + materialize bundle)
  };

  // The wired op ids, in registration order. Unlike folio (which filters by
  // `op.runtime`), agents wires an explicit curated subset drawn from three
  // core maps. Resolve each id to its manifest op up front so a stray id fails
  // fast with the same message the old `op(id)` helper produced.
  const WIRED_IDS = [
    'listAgents',
    'viewAgent',
    'createProfile',
    'setProfileProperty',
    'getProfileProperties',
    'setProfileDriver',
    'getProfileDrivers',
    'setProfileCircleMembership',
    'setProfileDisclosure',
    'getProfileDisclosure',
    'getPersonaView',
    'getPersonaRelease',
    'setAgentSkillExposure',
    'getAgentSkillExposure',
    'revokeAgent',
    'grantAgent',
    'grantRole',
    'revokeGrant',
    'purgeAgent',
    'listDataVersions',
    'restoreDataVersion',
    'listCatalogue',
    'installAgent',
  ];
  const operations = WIRED_IDS.map((id) => {
    const found = agentsManifest.operations.find((o) => o.id === id);
    if (!found) throw new Error(`buildAgentSkills: no manifest op "${id}"`);
    return found;
  });

  const CORES = { ...AGENT_CORES, ...RECOVERY_CORES, ...INSTALL_CORES };

  // agents' manifest ops declare no `visibility`; every wired op registers as
  // `'authenticated'` (unchanged from the per-op `wire(id, 'authenticated')`),
  // so pass a constant `visibilityFor` rather than the helper's `op.visibility`
  // default.
  return buildSkillsFromManifest({
    operations,
    cores:         CORES,
    storeFor:      () => store,
    visibilityFor: () => 'authenticated',
    label:         'buildAgentSkills',
  });
}
