/**
 * Service.js — calendar's §1b op→atom dispatch adapter (PLAN-capability-arc §1b · #65b "collapse the rest").
 *
 * ── What this is (and what it is NOT) ────────────────────────────────────────────────────────────────
 * The FUNCTIONALITY-side adapter that lets a caller invoke a calendar capability by its canonical
 * `(atom × noun)` pair instead of its bespoke op-id — the same seam the household pilot
 * (`apps/basis/src/v2/householdApp.js`) opened, and that tasks-v0 (`apps/tasks-v0/src/Service.js`) +
 * pinboard (`apps/pinboard/src/Service.js`) already carry. It is ADDITIVE: it registers the EXISTING
 * `registerCalendarSkills(...)` skill set unchanged and routes `(atom, noun)` → opId → the real handler.
 * No skill, store, or manifest is modified; the legacy dispatch path (`createCalendarAgent` registering the
 * same skills on a `core.Agent`) stays byte-identical.
 *
 * ── The register-collector + DataPart wrapper (why calendar differs from tasks-v0/pinboard) ──────────────
 * tasks-v0/pinboard's `buildSkills(...)` RETURN an array of `{id, handler}` the service maps by id. calendar's
 * `registerCalendarSkills(agent, store, opts)` instead REGISTERS each op onto a `core.Agent` via
 * `agent.register(name, fn)`. So this service passes a tiny COLLECTOR that captures those registrations into
 * a Map (`collector.register(name, fn)` → `byId.set(name, fn)`) — no real agent/transport is booted. The
 * calendar handlers read their args from the first DataPart (`parts?.[0]?.data`), so `callSkill` wraps `args`
 * in a synthetic single `DataPart` (mirroring tasks-v0/pinboard). Calendar handlers RETURN `Parts[]` (a
 * `[DataPart({...})]`), not a bare object — a real `core.Agent` reply carries the same parts — so `callSkill`
 * returns that array verbatim: `callSkill(op, args)` is byte-identical to invoking the registered handler
 * directly.
 *
 * ── generic:{} is intentional — calendar has NO CircleItemStore ──────────────────────────────────────
 * `dispatchCapability` is called with `generic: {}` (empty). Every declared calendar noun/atom
 * (`calendar-event` × {add, list, remove, claim, submit, reject}) resolves to a bespoke op via
 * `resolveCapability` (bespoke-first), so the generic store-backed CRUD fallback must never fire; an
 * undeclared/unimplemented `(atom × noun)` correctly returns `{ok:false, code:'unimplemented'}`.
 *
 * ── SECURITY / gate guardrail (docs/architecture.md) ─────────────────────────────────────────────────
 * `callSkill` is the default-deny security boundary. This adapter is therefore NOT to be wired as a live
 * `(atom, noun)` entry that BYPASSES the gate: the live interpreter path resolves `(atom, noun)` → opId at
 * the GATED basis waist (the capability gate authorises the pair BEFORE dispatch), then dispatches
 * through the gated `callSkill`. This service exists for tests + that future gated wiring — it hands the
 * resolved opId to the real handler; it does not decide authorisation. The fallback never bypasses the gate.
 */
import { DataPart } from '@onderling/core';
import { dispatchCapability } from '@onderling/app-manifest';

import { CalendarStore } from './CalendarStore.js';
import { registerCalendarSkills } from './skills/index.js';
import { calendarManifest } from '../manifest.js';

/**
 * createCalendarService — build the calendar skill set (via the existing `registerCalendarSkills`, unchanged)
 * and expose the §1b entries. An in-memory `CalendarStore` default makes it standalone-runnable (tests +
 * future gated wiring); a real boot injects the same pre-wired store `createCalendarAgent` would.
 *
 * @param {object}  [deps]
 * @param {object}  [deps.store]           a `CalendarStore` (defaults to an in-memory one)
 * @param {string}  [deps.actor]           default actor (only used when building the default store)
 * @param {() => object}            [deps.simulateSync]   forwarded to `registerCalendarSkills`
 * @param {(event: object) => void} [deps.publishEvent]   forwarded to `registerCalendarSkills`
 * @param {(webid:string, snapshot:object) => Promise<void>} [deps.inviteAttendee]  forwarded verbatim
 * @param {object}  [deps.manifest]        defaults to the real `calendarManifest`
 */
export function createCalendarService({
  store,
  actor,
  simulateSync,
  publishEvent,
  inviteAttendee,
  manifest = calendarManifest,
} = {}) {
  const calStore = store ?? new CalendarStore({ actor });

  // Collector: mirror `registerCalendarSkills`'s `agent.register(name, fn)` into a byId map. No real
  // core.Agent/transport is booted — this is the functionality-side adapter, not a live service.
  const byId = new Map();
  const collector = { register: (name, fn) => { byId.set(name, fn); } };
  registerCalendarSkills(collector, calStore, { simulateSync, publishEvent, inviteAttendee });

  const service = {
    /**
     * callSkill(opId, args, ctx) — invoke a calendar op by its bespoke id. Wraps `args` in the single
     * `DataPart` the calendar handlers read via `parts?.[0]?.data`. Returns the handler's `Parts[]` verbatim
     * (byte-identical to invoking the registered handler directly). `ctx` is accepted for signature parity
     * with the tasks-v0/pinboard adapters; calendar handlers carry the actor inside `args.actor`.
     */
    async callSkill(opId, args = {}, _ctx = {}) {
      const handler = byId.get(opId);
      if (!handler) throw new Error(`calendarService.callSkill: unknown op "${opId}"`);
      return handler({ parts: [DataPart({ ...args })] });
    },

    /**
     * callCapability(atom, noun, args, ctx) — the §1b atom-dispatch entry: invoke a calendar capability by
     * its canonical `(atom × noun)` instead of a bespoke op-id. Bespoke-first: `dispatchCapability` resolves
     * the pair against the manifest and, when a real op implements it, dispatches THROUGH that op (identical
     * to `callSkill(opId, …)`). `generic: {}` — calendar has no CircleItemStore, so there is no generic CRUD
     * fallback; an undeclared/unimplemented pair returns `{ok:false, code:'unimplemented'}` and never
     * bypasses the gate.
     */
    async callCapability(atom, noun, args = {}, ctx = {}) {
      return dispatchCapability(
        manifest,
        { atom, noun, args },
        { dispatch: (opId, a) => service.callSkill(opId, a, ctx), generic: {}, ctx },
      );
    },

    /** The bound store — exposed for tests + future gated wiring. */
    store: calStore,
  };
  return service;
}

export default createCalendarService;
