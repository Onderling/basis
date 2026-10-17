/**
 * pinboard — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5).
 *
 * Drives the shared, app-parameterized harness (`@onderling/sdk/testing`) with
 * pinboard's cores + manifest + Service:
 *   • LOCAL route  — `createPinboardService().callSkill(op, args, ctx)` calls the
 *                    pure `(scope, args, ctx)` core in `PINBOARD_CORES` DIRECTLY.
 *   • WIRE route   — the SAME cores, wrapped by `wireSkill` + registered as
 *                    `defineSkill`s (the `createPinboardService().skills`), invoked
 *                    over the serialized `{parts:[DataPart], from, envelope}`
 *                    path on a real `@onderling/sdk` agent.
 *
 * The per-route caller identity differs by construction (LOCAL uses a fixed
 * webid; WIRE uses the agent's own key on a self-invoke) — the harness
 * normalizes those actor fields (plus ids / stamps / `_sync`) away.
 */
import { describe, it, expect } from 'vitest';

import { createAgent, Parts } from '@onderling/sdk';
// The `local ≡ wire` harness lives at the SDK layer (dependency-free).
import { describeLocalWireFitness } from '@onderling/sdk/testing';

import { createPinboardService } from '../src/Service.js';
import { PINBOARD_CORES } from '../src/skills/index.js';
import { pinboardManifest } from '../manifest.js';

const ACTOR = 'webid:alice';

/** LOCAL invoker: fresh Service → callSkill calls the core directly. */
function makeLocalInvoker() {
  const svc = createPinboardService({ groupId: 'g1' });
  return (op, args = {}, ctx = {}) => svc.callSkill(op, args, { by: ACTOR, ...ctx });
}

/** WIRE invoker: fresh real agent registering the SAME buildSkills output; serialized invoke. */
async function makeWireInvoker() {
  const svc = createPinboardService({ groupId: 'g1' });
  const agent = await createAgent();
  for (const s of svc.skills) {
    agent.register(s.id, s.handler, { visibility: s.visibility });
  }
  return {
    invoke: async (op, args = {}) =>
      Parts.data(await agent.invoke(agent.address, op, Parts.wrap(args))),
    stop: () => agent.stop(),
  };
}

describeLocalWireFitness(
  {
    app:           'pinboard',
    coreIds:       Object.keys(PINBOARD_CORES),
    registeredIds: createPinboardService({ groupId: 'g1' }).skills.map((s) => s.id),
    manifestOpIds: pinboardManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      {
        name: 'getGroupRules (read, no rules yet)',
        run:  (invoke) => invoke('getGroupRules', { groupId: 'g1' }),
      },
      {
        name: 'listGroupMembers (read, no member map)',
        run:  (invoke) => invoke('listGroupMembers', {}),
      },
      {
        name: 'listMyRequests (read, after a postRequest)',
        run:  async (invoke) => {
          await invoke('postRequest', { text: 'need a ladder', intent: 'ask' });
          return invoke('listMyRequests', {});
        },
        // `display` — author-hydration block carries per-route ids.
        // `createdBy`/`updatedBy` — the converged CircleItemStore (migration
        // step 3) stamps these from the acting identity, which differs by route
        // (LOCAL webid vs WIRE agent key); not in DEFAULT_VOLATILE_KEYS. Same
        // treatment as apps/basis/test/v2/householdLocalWireFitness.test.js.
        volatile: ['display', 'createdBy', 'updatedBy'],
      },
      {
        name: 'cancelRequest (mutate, id chained from postRequest)',
        run:  async (invoke) => {
          const posted = await invoke('postRequest', { text: 'borrow a tent', intent: 'ask' });
          return invoke('cancelRequest', { requestId: posted.requestId });
        },
      },
    ],
  },
  { describe, it, expect },
);
