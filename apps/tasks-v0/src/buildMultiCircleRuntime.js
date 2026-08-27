/**
 * `buildMultiCircleRuntime` — in-process tasks-v0 multi-circle runtime.
 *
 * Extracted 2026-05-20 from `test/v2-multi-circle.test.js`'s
 * `buildMultiCircle()` fixture so that:
 *   - the existing v2-multi-circle test suite continues to drive it
 *     end-to-end;
 *   the "tasks-v0 multi-circle through manifest-host" proof
 *     (`test/manifest-host-mount.test.js`) reuses it;
 *   the recombination demo (`examples/manifest-host-demo/`)
 *     reuses it too.
 *
 * Mirrors `bin/tasks-ui.js --multi-circle` (lines 332–414) but without
 * the CLI option parsing, TTY attachment, web-UI mount, or Telegram
 * bridge.  Pure in-process: identity is generated, transport is the
 * mesh's internal bus, storage is in-memory.
 *
 * Returns the four primitives every consumer needs:
 *
 *   { meshAgent, primaryBundle, circlesMap, localStoreBundle,
 *     spawnCircleInProcess }
 *
 * - `meshAgent` — the single shared agent that owns the skill registry.
 * - `primaryBundle` — the primary-circle bundle from `createCircleAgent`.
 * - `circlesMap` — `Map<circleId, CircleState>` the bundleResolver picks from.
 * - `localStoreBundle` — backing storage (shared across circles).
 * - `spawnCircleInProcess(circleId)` — in-process sibling-circle spawner,
 *   already stashed on every CircleState via `._spawnCircleInProcess`.
 *
 * After this returns, `meshAgent.start()` has been awaited; skills
 * are registered; multi-circle dispatch is live.
 */

import { buildMeshAgent } from './MeshAgent.js';
import { createCircleAgent } from './Circle.js';
import { buildBundle } from './storage/buildBundle.js';
import { wireSkills } from './wireSkills.js';
import { multiCircleResolver } from './bundleResolver.js';
import { buildMultiCircleOnboardingSkills } from './skills/multiCircleOnboarding.js';

const DEFAULT_ANNE = 'https://id.example/anne';

/**
 * @param {object} [opts]
 * @param {string} [opts.primaryCircleId='primary-circle']
 * @param {string} [opts.primaryCircleName='Primary']
 * @param {string} [opts.primaryCircleKind='project']
 * @param {Array<{webid: string, displayName: string, role: string}>}
 *           [opts.primaryMembers]
 * @param {string} [opts.label='tasks-multi-circle']
 * @param {object} [opts.localStoreBundle]
 *           Optional caller-supplied bundle; defaults to `buildBundle()`.
 */
export async function buildMultiCircleRuntime({
  primaryCircleId   = 'primary-circle',
  primaryCircleName = 'Primary',
  primaryCircleKind = 'project',
  primaryMembers  = [{ webid: DEFAULT_ANNE, displayName: 'Anne', role: 'admin' }],
  label           = 'tasks-multi-circle',
  localStoreBundle = buildBundle(),
} = {}) {
  const { meshAgent, identity } = await buildMeshAgent({
    localStoreBundle,
    label,
    // The agent's revocation truth: every circle in the map, asked at verify time. The engine takes
    // ONE resolver at construction, so a circle spawned later must be REACHABLE from it rather than
    // pushing itself in — the map is that reach.
    circleStates: () => circlesMap.values(),
  });

  const primaryConfig = {
    circleId:  primaryCircleId,
    name:    primaryCircleName,
    kind:    primaryCircleKind,
    members: primaryMembers,
  };

  const primaryBundle = await createCircleAgent({
    circleConfig:           primaryConfig,
    localStoreBundle,
    identity,
    transport:            meshAgent.transport,
    agent:                meshAgent,
    registerSkills:       false,   // wireSkills owns registration below
    wireOnboardingSkills: false,
  });
  const primaryCircleState = primaryBundle._circleState;
  const circlesMap = new Map([[primaryCircleState.circleId, primaryCircleState]]);

  async function spawnCircleInProcess(circleId) {
    if (circlesMap.has(circleId)) return circlesMap.get(circleId);
    const path = `mem://tasks/circles/${circleId}/config.json`;
    const raw  = await localStoreBundle.cache.read(path);
    if (!raw) throw new Error(`no saved config at ${path}`);
    const cfg  = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const spawned = await createCircleAgent({
      circleConfig:           cfg,
      localStoreBundle,
      identity,
      transport:            meshAgent.transport,
      agent:                meshAgent,
      registerSkills:       false,
      wireOnboardingSkills: false,
    });
    const cs = spawned._circleState;
    cs._spawnCircleInProcess = spawnCircleInProcess;
    circlesMap.set(cfg.circleId, cs);
    return cs;
  }
  primaryCircleState._spawnCircleInProcess = spawnCircleInProcess;

  wireSkills({
    meshAgent,
    bundleResolver: multiCircleResolver(circlesMap),
    circlesProvider:  () => circlesMap.values(),
    members:        primaryBundle.members,
  });

  for (const def of buildMultiCircleOnboardingSkills({
    bundleResolver: multiCircleResolver(circlesMap),
  })) {
    meshAgent.skills.register(def);
  }

  await meshAgent.start();

  return {
    meshAgent,
    primaryBundle,
    circlesMap,
    localStoreBundle,
    spawnCircleInProcess,
  };
}
