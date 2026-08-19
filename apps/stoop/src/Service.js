/**
 * Service.js — stoop's §1b op→atom adapter (PLAN-capability-arc §1b; mirrors the #65b household pilot).
 *
 * ── What this is (and what it is NOT) ────────────────────────────────────────────────────────────────
 * This is the FUNCTIONALITY-side adapter that lets a caller invoke a stoop capability by its canonical
 * `(atom × noun)` pair instead of its bespoke op-id — the same seam `apps/basis/src/v2/householdApp.js`
 * opened for household. It is ADDITIVE: it wraps the EXISTING `buildSkills({...})` skill set unchanged and
 * routes `(atom, noun)` → opId → the real `defineSkill` handler. No skill, agent, or manifest is modified;
 * the legacy dispatch path (a `core.Agent` registering `buildSkills` and answering A2A task requests) stays
 * byte-identical.
 *
 * ── The DataPart wrapper (why stoop differs from household) ──────────────────────────────────────────
 * Household was already dissolved onto a per-circle `CircleItemStore`; its ops are pure functions over that
 * store. Stoop is NOT dissolved — it still uses legacy `@onderling/core` `defineSkill('opId', ({parts, from}) =>
 * ...)` handlers where structured args ride in a single `DataPart` (see `dataArgs(parts)` in
 * `src/skills/index.js`). So `callSkill` here builds the SYNTHETIC single-DataPart input the handlers expect:
 *   handler({ parts: [{ type: 'DataPart', data: {...args} }], from: ctx.by, envelope: ctx.envelope ?? {} })
 * `buildSkills` closes over ONE group's `ItemStore` + `groupId` (single-bundle mode — the same mode
 * `Agent.js` uses when `getBundle` is absent), so the store IS the scope: callSkill does NOT inject a
 * scope/group key into `data`. Ops that genuinely take a group (e.g. `leaveGroup({groupId})`) receive it as
 * an ordinary arg the caller passes, not as an injected scope.
 *
 * ── generic:{} is intentional — stoop has NO CircleItemStore ─────────────────────────────────────────
 * `dispatchCapability` is called with `generic: {}` (empty). Every declared stoop noun resolves to a
 * bespoke op via `resolveCapability` (bespoke-first), so the generic store-backed fallback must never fire;
 * an undeclared/unimplemented `(atom × noun)` correctly returns `{ok:false, code:'unimplemented'}`. (A
 * declared-but-op-less noun would return `{ok:false, code:'no-generic'}` here rather than silently
 * inventing CRUD — stoop has no generic store to serve it, by design.)
 *
 * ── SECURITY / gate guardrail (docs/architecture.md) ─────────────────────────────────────────────────
 * `callSkill` is the default-deny security boundary. This adapter is therefore NOT to be wired as a live
 * `(atom, noun)` entry that BYPASSES the gate: the live interpreter path resolves `(atom, noun)` → opId at
 * the GATED basis waist (the capability gate authorises the pair BEFORE dispatch). This service exists
 * for tests + the future gated wiring — it hands the resolved opId to the real handler, it does not decide
 * authorisation.
 */
import { dispatchCapability } from '@onderling/app-manifest';
import { CircleItemStore, createTaskStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { buildSkills, buildStoopScope, STOOP_CORES } from './skills/index.js';
import { stoopManifest } from '../manifest.js';

/** A no-op OfferingMatch stub: posts store locally + "broadcast" resolves to no claims (no transport wired). */
const noopOfferingMatch = () => ({ broadcast: async () => ({ claims: [] }), addPeer() {} });

/**
 * createStoopService — build the stoop skill set (via the existing `buildSkills`, unchanged) and expose the
 * §1b entries. In-memory defaults make it standalone-runnable (tests + future gated wiring); a real boot
 * injects the same `store`/`offeringMatch`/`members`/… `Agent.js` wires (single-bundle mode).
 *
 * @param {object}  [deps]
 * @param {object}  [deps.store]        an `ItemStore` (defaults to an in-memory MemorySource-backed one)
 * @param {object}  [deps.offeringMatch]   L1e OfferingMatch (defaults to a no-op broadcast stub)
 * @param {object}  [deps.manifest]     defaults to the real `stoopManifest`
 *  …plus the remaining `buildSkills` deps (notifier, reveals, members, controlAgent, muted, localActor,
 *    groupId, dataLocationConfig, chat, metrics, bundle) — all optional, forwarded verbatim.
 */
export function createStoopService({
  store,
  offeringMatch,
  notifier,
  reveals,
  members,
  controlAgent,
  muted,
  localActor,
  groupId,
  dataLocationConfig,
  chat,
  metrics,
  bundle,
  manifest = stoopManifest,
} = {}) {
  const itemStore = store ?? createTaskStore(
    new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }),
  );

  // Build the dep bag ONCE (hoisting the offeringMatch/muted defaults) so the wire
  // route (buildSkills) and the local route (the direct-core scope) share the
  // exact same instances — a call routed either way sees identical state.
  const deps = {
    store:      itemStore,
    offeringMatch: offeringMatch ?? noopOfferingMatch(),
    notifier:   notifier ?? null,
    reveals:    reveals ?? null,
    members:    members ?? null,
    controlAgent,
    muted:      muted ?? new Set(),
    localActor,
    groupId:    groupId ?? null,
    dataLocationConfig,
    chat:       chat ?? null,
    metrics:    metrics ?? null,
    bundle:     bundle ?? {},
  };
  const skills = buildSkills(deps);
  const scope  = buildStoopScope(deps);   // the SAME `scope` wireSkill hands each core on the wire route
  const byId = new Map(skills.map((s) => [s.id, s]));

  const service = {
    /**
     * callSkill(opId, args, ctx) — invoke a stoop op by its bespoke id, the LOCAL route (decision #5).
     *
     * Workstream B: for an op with a pure `(scope, args, ctx)` core in `STOOP_CORES`, call that core
     * DIRECTLY over the bound `scope` — no synthetic `DataPart`. Ops WITHOUT a pure core (the ~96
     * op-less skills + the hand-written ones like postRequest/markReturned/leaveGroup) keep the legacy
     * handler path: their contract is `({parts, from, envelope})`, so we hand them the single `DataPart`
     * they read via `dataArgs(parts)`. `ctx.by` is the acting WebID (`from`); the store is in the scope.
     */
    async callSkill(opId, args = {}, ctx = {}) {
      const core = STOOP_CORES[opId];
      if (core) {
        return core(scope, { ...args }, { from: ctx.by, envelope: ctx.envelope ?? {} });
      }
      const skill = byId.get(opId);
      if (!skill) throw new Error(`stoopService.callSkill: unknown op "${opId}"`);
      return skill.handler({
        parts:    [{ type: 'DataPart', data: { ...args } }],
        from:     ctx.by,
        envelope: ctx.envelope ?? {},
      });
    },

    /**
     * callCapability(atom, noun, args, ctx) — the §1b atom-dispatch entry: invoke a stoop capability by its
     * canonical `(atom × noun)` instead of a bespoke op-id. Bespoke-first: `dispatchCapability` resolves the
     * pair against the manifest and, when a real op implements it, dispatches THROUGH that op (identical to
     * `callSkill(opId, …)`). `generic: {}` — stoop has no CircleItemStore, so there is no generic CRUD
     * fallback; an undeclared/unimplemented pair returns `{ok:false, code:'unimplemented'}`.
     *
     * NB — `group-leave` (leaveGroup = the canonical `remove` atom) is an awkward-but-real GATED capability:
     * routing `('remove','group-leave')` here to the existing `leaveGroup` op is pure resolution and stays
     * INERT (no behaviour/gating changed).
     * // FOLLOW-UP (Frits decision): keep group-leave gate-capability vs reclassify to a domain verb
     */
    async callCapability(atom, noun, args = {}, ctx = {}) {
      return dispatchCapability(
        manifest,
        { atom, noun, args },
        { dispatch: (opId, a) => service.callSkill(opId, a, ctx), generic: {}, ctx },
      );
    },

    /** The built skill set + the bound store — exposed for tests + future gated wiring. */
    skills,
    store: itemStore,
  };
  return service;
}

export default createStoopService;
