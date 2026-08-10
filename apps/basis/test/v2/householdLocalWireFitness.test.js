/**
 * household — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5).  Completes the uniform-invocation-route
 * coverage: tasks-v0 + stoop already drive the shared harness; this adds
 * the third real app, household.
 *
 * Household differs from tasks-v0 / stoop: it has NO standalone
 * `createXService` that owns the wire adapters.  Its pure cores live in
 * `src/v2/householdApp.js` and are registered on the uniform wire path by
 * `realAgent.js`'s `wire(...)` block — which wraps each core with two small
 * adapters (`withBy`, `listWrap`) and a per-circle `storeFor`.  Those
 * adapters ARE production code, so both routes here reuse the SAME
 * `WIRED` table (op → adapted core → op declaration), exactly mirroring
 * `realAgent.js`:
 *
 *   • LOCAL route — the adapted core called DIRECTLY over the per-circle
 *     CircleItemStore (`createHouseholdService().stores.getStore(circleId)`),
 *     no synthetic envelope.
 *   • WIRE route  — the SAME adapted core wrapped by `wireSkill(core, op,
 *     { storeFor })` + registered on a real `@onderling/sdk` agent, invoked over
 *     the serialized `{parts:[DataPart], from, envelope}` path.
 *
 * The per-route caller identity differs by construction (LOCAL uses a fixed
 * webid; WIRE uses the agent's own key on a self-invoke).  The harness's
 * `stripVolatile` normalizes ids / stamps / actor fields away; household's
 * `CircleItemStore` additionally stamps `createdBy`/`updatedBy` (not in the
 * harness default set), so every case strips those two as well.
 *
 * listOpen's manifest `type` param is REQUIRED, but the dissolved app (like
 * the legacy one) supports the no-type "all open" call; we wire that op with
 * a `type`-optional CLONE of the op — byte-for-byte the `typeOptional` trick
 * in `realAgent.js` — so `wireSkill`'s validation permits it.
 */
import { describe, it, expect } from 'vitest';

import { createAgent, Parts, wireSkill } from '@onderling/sdk';
// The `local ≡ wire` harness lives at the SDK layer (dependency-free).
import { describeLocalWireFitness } from '@onderling/sdk/testing';

// Household's pure cores (the dissolved app) — basis's own src.
import * as householdApp from '../../src/v2/householdApp.js';
// The household manifest is the single contract; relative-imported exactly as
// realAgent.js does (basis carries no @onderling-app/household workspace dep).
import { householdManifest } from '../../../household/manifest.js';

const CIRCLE = 'fit';
const ACTOR  = 'webid:anne';

// CircleItemStore stamps createdBy/updatedBy from the acting member, which
// differs per route (LOCAL webid vs WIRE agent key) and is NOT in the harness's
// DEFAULT_VOLATILE_KEYS — strip it on every case. The claim cluster (now that the
// household ops delegate to the canonical task lifecycle) stamps the actor and a
// wall-clock the same way: assignees[] + the confirmation triplet vary per route.
const HH_VOLATILE = ['createdBy', 'updatedBy', 'assignees', 'confirmedAssignee', 'confirmedBy', 'confirmedAt'];

/** Resolve the scope circle from decoded args (circleId/groupId), default CIRCLE. */
const resolveCircle = (data) => (data?.circleId ?? data?.groupId) || CIRCLE;

/** Look up a household manifest op declaration by id. */
const hhOp = (id) => {
  const found = householdManifest.operations.find((o) => o.id === id);
  if (!found) throw new Error(`householdLocalWireFitness: no manifest op "${id}"`);
  return found;
};

/* ─── the SAME adapters realAgent.js's household wire() block uses ───────────
 * withBy   — thread the acting member (`by`) from the invoke ctx into the core.
 * listWrap — box the bare-array list cores in `{ items }` (a raw array would be
 *            mis-read as a Part[] on the wire), so BOTH routes return `{items}`.
 * typeOptional — clone an op with its `type` param made optional. */
const withBy   = (coreFn) => (store, a, ctx) => coreFn(store, a, { ...ctx, by: ctx.from ?? ACTOR });
const listWrap = (coreFn) => async (store, a, ctx) => ({ items: await coreFn(store, a, ctx) });
const typeOptional = (op) => ({
  ...op,
  params: (op.params ?? []).map((p) => (p.name === 'type' ? { ...p, required: false } : p)),
});

/**
 * The one wiring table — `[opId, adaptedCore, opDeclaration]` — driving BOTH
 * routes, mirroring realAgent.js's `wire('addItem', …)` block op-for-op so the
 * test exercises production's exact adapters.  Full 8-op set (not just the
 * representative cases) so the parity check covers every wired core.
 */
const WIRED = [
  ['addItem',      withBy(householdApp.addItem),      hhOp('addItem')],
  ['addTask',      withBy(householdApp.addTask),      hhOp('addTask')],
  ['markComplete', withBy(householdApp.markComplete), hhOp('markComplete')],
  ['claim',        withBy(householdApp.claim),        hhOp('claim')],
  ['reassign',     withBy(householdApp.reassign),     hhOp('reassign')],
  ['removeItem',   withBy(householdApp.removeItem),   hhOp('removeItem')],       // gated + attributed like the other writes
  ['listOpen',     listWrap(householdApp.listOpen),   typeOptional(hhOp('listOpen'))],
  ['listTasks',    listWrap(householdApp.listTasks),  hhOp('listTasks')],
];

/**
 * LOCAL invoker: a fresh household service; the adapted core is called DIRECTLY
 * over the resolved per-circle CircleItemStore (no synthetic DataPart).
 */
function makeLocalInvoker() {
  const svc = householdApp.createHouseholdService();   // in-memory no-pod default
  const cores = new Map(WIRED.map(([id, core]) => [id, core]));
  return (op, args = {}, ctx = {}) => {
    const core = cores.get(op);
    if (!core) throw new Error(`householdLocalWireFitness: no wired core "${op}"`);
    const store = svc.stores.getStore(resolveCircle(args));
    // withBy reads ctx.from; supply the fixed test webid on the local route.
    return core(store, args, { from: ACTOR, ...ctx });
  };
}

/**
 * WIRE invoker: a fresh real agent registering the SAME adapted cores via
 * `wireSkill`, invoked over the serialized parts path (self-invoke).  circleId
 * is injected into the DataPart args so `storeFor` resolves the same scope.
 */
async function makeWireInvoker() {
  const svc   = householdApp.createHouseholdService();
  const agent = await createAgent();
  const storeFor = (ctx) => svc.stores.getStore(resolveCircle(ctx.parts?.[0]?.data ?? {}));
  for (const [id, core, op] of WIRED) {
    agent.register(id, wireSkill(core, op, { storeFor }));
  }
  return {
    invoke: async (op, args = {}) =>
      Parts.data(await agent.invoke(agent.address, op, Parts.wrap({ ...args, circleId: CIRCLE }))),
    stop: () => agent.stop(),
  };
}

describeLocalWireFitness(
  {
    app:           'household',
    coreIds:       WIRED.map(([id]) => id),
    registeredIds: WIRED.map(([id]) => id),
    manifestOpIds: householdManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      {
        name:     'addItem (create shopping item)',
        run:      (invoke) => invoke('addItem', { type: 'shopping', text: 'buy milk' }),
        volatile: HH_VOLATILE,
      },
      {
        name:     'addTask (create task)',
        run:      (invoke) => invoke('addTask', { text: 'vacuum living room' }),
        volatile: HH_VOLATILE,
      },
      {
        name: 'markComplete (mutate, match chained from addItem)',
        run:  async (invoke) => {
          await invoke('addItem', { type: 'errand', text: 'post a parcel' });
          return invoke('markComplete', { match: 'post a parcel' });
        },
        volatile: HH_VOLATILE,
      },
      {
        name: 'claim (lifecycle, match chained from addTask)',
        run:  async (invoke) => {
          await invoke('addTask', { text: 'water the plants' });
          return invoke('claim', { match: 'water the plants' });
        },
        volatile: HH_VOLATILE,
      },
      {
        name: 'listOpen (read, all open after two shopping adds)',
        run:  async (invoke) => {
          await invoke('addItem', { type: 'shopping', text: 'apples' });
          await invoke('addItem', { type: 'shopping', text: 'bread' });
          return invoke('listOpen', { type: 'shopping' });
        },
        volatile: HH_VOLATILE,
      },
      {
        name: 'listTasks (read, after an addTask)',
        run:  async (invoke) => {
          await invoke('addTask', { text: 'sweep the floor' });
          return invoke('listTasks', {});
        },
        volatile: HH_VOLATILE,
      },
    ],
  },
  { describe, it, expect },
);
