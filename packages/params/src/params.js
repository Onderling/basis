/**
 * params — THE PARAMETER REGISTER (task #36): the SECOND half of the declaration layer. It answers "what is
 * this tunable constant, who may change it, and where does a change sync" (`PLAN-homes.md` §"declaration
 * layer + the flywheel").
 *
 * ── Why it lives in `@onderling/params`, the zero-dep base leaf ──────────────────────────────────────────
 * `entryKinds` and `resolutionPolicy` (the other declaration-layer tables) live in `@onderling/item-store`
 * because they are item-store-DOMAIN facts (how a logged item behaves / how two writes merge). `params` is
 * NOT item-store-domain — a tunable constant lives in EVERY layer. It first moved item-store → `core`, but
 * `core` is a HEAVY mid-layer (it pulls solid-client + the crypto stack), so a lightweight leaf like
 * `@onderling/logger` that only wants to declare two params should not have to depend on the kernel and drag
 * all that in. A UNIVERSAL primitive belongs at the TRUE base: this package has ZERO dependencies, so anything
 * — `core`, every substrate, every app, and the leaves below `core` — can depend on it without coupling
 * upward or risking a cycle. `@onderling/core` and `@onderling/item-store` RE-EXPORT the whole surface, so
 * every existing `@onderling/core` / `@onderling/item-store` importer is unaffected. (Homed here 2026-08-09,
 * Frits: item-store → core → this leaf; the decision-C `@onderling/params` alternative, taken once the
 * `logger`-depends-on-`core` bloat proved core was not the base.)
 *
 * ── The two axes (decision B) ────────────────────────────────────────────────────────────────────────────
 * Every param declares two orthogonal facts, replacing the three overloaded `scope` vocabularies that meant
 * three different things:
 *   • `scope ∈ {device, agent, circle}` — drives SYNC. Where a set VALUE routes (decision C): a device param
 *     to `devices/<id>.json`, an agent param to `shared.json`, a circle param to the circle policy. There is
 *     NO new sync plumbing — the register declares + ROUTES to the existing homes (see `PARAM_HOME_FOR`).
 *   • `kind ∈ {internal, user}` — the SECURITY gate. A user op may set only `user`-declared params; an
 *     `internal` threshold cannot be poked through an opId to wreck an agent/circle setup.
 *
 * ── `param()` — declaration at the site, no runtime singleton (decision A) ───────────────────────────────
 * `export const X = param({ key, scope, kind, default })` RETURNS the resolved value so the use site stays
 * readable (`if (body.length > X)`), and it FORCES the shape (the carrot — a param cannot be written without
 * its key/scope/kind). It mutates NOTHING: there is no module-level array it pushes to at import, so there is
 * no import-order hazard. The census of every declared param is collected STATICALLY from source by the
 * stale-param guard (`scripts/lint-stale-params.mjs`), exactly as `lint-unreached-exports` reads exports —
 * not at runtime. The runtime register (below) is a plain INSTANCE, populated by DI at composition and
 * injected DOWN (invariant 5: the app declares its params INTO the register; the substrate never up-imports
 * the app), mirroring how `resolutionRegistryFromManifests` seeds the resolution registry.
 *
 * A `const` is evaluated once at import and can never track a value that syncs in LATER at runtime, so
 * `param()` returns the code DEFAULT — behaviour-preserving by construction (a migrated const returns exactly
 * what it held). The LIVE, possibly-synced value of a settable param is read through the register
 * (`register.valueOf(key)`), which is where DI put it. Default and live value coincide until an override is set.
 *
 * ── kind:internal is IMMUTABLE BY CONSTRUCTION (decision E) ──────────────────────────────────────────────
 * The register DECLARES an internal param (so a guard/agreement can see it) but keeps NO value slot behind
 * it: `valueOf` always returns its code default, `setValue` throws, `isSettable` is false. The immutability
 * is not "an op that declines" — there is nothing to poke. `setParam` refuses it anyway as the explicit
 * belt-and-suspenders gate (principle 9). The line never to cross: never give a kind:internal param a
 * settable/synced value — the moment it has one, immutability becomes a hope.
 *
 * ── Future: a richer metadata schema (roadmap — NOT implemented; extend when a consumer lands) ───────────
 * The spec is `{ key, scope, kind, default }` today. It is a plain object, so it can grow OPTIONAL fields
 * without breaking any existing declaration — the register just carries them and projections read them. The
 * point of growing it is to make the register SELF-DESCRIBING, so a settings surface can render copy and an
 * agent/LLM can reason about a param WITHOUT reading this code. Intended additions, each added only when a
 * real consumer needs it:
 *   • `description` — a terse, factual, dev/LLM-facing English one-liner (what this param is / does). The
 *       first field to add (it is also the settings-form's help text). Make it REQUIRED for `kind:user` and
 *       guard its PRESENCE — its CORRECTNESS is unenforceable prose (it can drift; `default` cannot), so keep
 *       it short and factual. NB it becomes disclosure surface once the register is queryable: nothing
 *       sensitive in it. The LOCALISED, user-facing copy is a separate concern — it belongs in the locale
 *       system keyed by the param key, not as a raw string here (one string cannot be both stable-English and
 *       localised).
 *   • `unit` — `'ms'` | `'days'` | `'bytes'` | `'count'` | … so a consumer need not guess the unit.
 *   • `range` / `enum` — allowed `{min,max}` or value set; lets a form render a slider/select and lets the
 *       set-param op validate a proposed value as a second gate.
 *   • `tags` / `category` — grouping for the form + agent reasoning (e.g. `['battery']`, `['privacy']`).
 *   • `effect` — direction/impact hint (e.g. "higher = more battery use") — the field that most helps an
 *       agent reason about a CHANGE without the code.
 * Start with `description` (+ `unit`); resist over-schematising until something reads the rest.
 */

/** The sync scope — decides where a set value routes (decision B/C). */
export const PARAM_SCOPE = Object.freeze({ DEVICE: 'device', AGENT: 'agent', CIRCLE: 'circle' });

/** The security kind — the set-op gate (decision B/E). `internal` is immutable by construction. */
export const PARAM_KIND = Object.freeze({ INTERNAL: 'internal', USER: 'user' });

/**
 * The EXISTING synced home each scope routes to (decision C — no new sync plumbing). Reused, not invented:
 * `device → devices/<id>.json`, `agent → shared.json` (both per the cross-app-settings convention), and
 * `circle → the circle policy/store`. This is the routing table `setParam` reports; the actual writers are
 * injected by the composition root, so the register declares + routes and owns no persistence.
 */
export const PARAM_HOME_FOR = Object.freeze({
  device: 'devices/<id>.json',
  agent:  'shared.json',
  circle: 'circle-policy',
});

const isScope = (s) => s === PARAM_SCOPE.DEVICE || s === PARAM_SCOPE.AGENT || s === PARAM_SCOPE.CIRCLE;
const isKind  = (k) => k === PARAM_KIND.INTERNAL || k === PARAM_KIND.USER;

/** Validate a param spec at declaration/registration — the shape the helper FORCES. */
function validateSpec(spec, who) {
  if (!spec || typeof spec !== 'object') throw new Error(`${who}: a param spec object is required`);
  if (typeof spec.key !== 'string' || !spec.key) throw new Error(`${who}: spec.key (a non-empty string) is required`);
  if (!isScope(spec.scope)) throw new Error(`${who}(${spec.key}): scope must be device|agent|circle`);
  if (!isKind(spec.kind))   throw new Error(`${who}(${spec.key}): kind must be internal|user`);
  if (!('default' in spec)) throw new Error(`${who}(${spec.key}): a default is required`);
  return spec;
}

/**
 * `param(spec)` — the declaration-site helper (decision A). Validates the spec and RETURNS its code default,
 * so `export const X = param({ … })` is the value at the use site AND the greppable, uniform declaration the
 * stale-param guard's static scan reads. Pure: it registers nothing at runtime (no import-order hazard).
 */
export function param(spec) {
  return validateSpec(spec, 'param').default;
}

/**
 * The runtime PARAMETER REGISTER — a plain instance (Map + `declare()` + accessors), the sibling shape of
 * `createResolutionRegistry()`. Populated by DI at composition (injected down) with the params it governs;
 * `valueOf` gives the live value, `setValue`/`setParam` route by scope, and kind is the settability gate.
 */
export function createParamRegistry() {
  const specs  = new Map();   // key -> frozen spec (user AND internal may be declared, for introspection/agreement)
  const values = new Map();   // key -> synced override — ONLY EVER a kind:user param (decision E: internal has no slot)

  const api = {
    /** Declare a param INTO the register (the DI seam — invariant 5). Last declaration wins; chainable. */
    declare(spec) {
      validateSpec(spec, 'paramRegistry.declare');
      specs.set(spec.key, Object.freeze({ ...spec }));
      return api;
    },

    has(key)        { return specs.has(key); },
    specOf(key)     { return specs.get(key) ?? null; },
    defaultOf(key)  { return specs.get(key)?.default; },
    kindOf(key)     { return specs.get(key)?.kind ?? null; },
    scopeOf(key)    { return specs.get(key)?.scope ?? null; },
    /** kind:user is settable; kind:internal is NEVER settable (immutable by construction). */
    isSettable(key) { return specs.get(key)?.kind === PARAM_KIND.USER; },

    /**
     * The LIVE value: the synced override if one has been set, else the code default. A kind:internal param
     * ALWAYS returns its default — there is no override path behind it (decision E).
     */
    valueOf(key) {
      const spec = specs.get(key);
      if (!spec) return undefined;
      if (spec.kind === PARAM_KIND.INTERNAL) return spec.default;   // immutable — no value slot is ever consulted
      return values.has(key) ? values.get(key) : spec.default;
    },

    /**
     * Record a synced override — kind:user ONLY. Throws on an unknown key or a kind:internal param: the value
     * store literally has no internal slot, so this cannot be the door immutability leaks through.
     */
    setValue(key, value) {
      const spec = specs.get(key);
      if (!spec) throw new Error(`paramRegistry.setValue: unknown param "${key}"`);
      if (spec.kind !== PARAM_KIND.USER) {
        throw new Error(`paramRegistry.setValue: "${key}" is kind:internal — immutable by construction, it has no settable value`);
      }
      values.set(key, value);
      return api;
    },

    keys()         { return [...specs.keys()]; },
    settableKeys() { return [...specs.keys()].filter((k) => specs.get(k).kind === PARAM_KIND.USER); },

    /**
     * The kind:user slice as a settings-form projection seed — key/scope/default plus the current live value.
     * This is the seam `buildSettingsForm` projects over (only user params are ever surfaced to a person).
     */
    userParams() {
      return [...specs.values()]
        .filter((s) => s.kind === PARAM_KIND.USER)
        .map((s) => ({ key: s.key, scope: s.scope, default: s.default, value: api.valueOf(s.key), home: PARAM_HOME_FOR[s.scope] }));
    },
  };
  return api;
}

/**
 * THE `set-param` OP (decision D) — the ONE generic security chokepoint. It reads the register and enforces
 * `kind`: it sets ONLY a kind:user param (scope-appropriate) and REFUSES a kind:internal one (and an unknown
 * key). One gate where it binds beats replicating the check per set-op (enforceability). On success it routes
 * the value to the EXISTING sync home for the param's scope (decision C) via the injected `homes` writers —
 * `device`/`agent`/`circle` → the writer the composition wired to `devices/<id>.json` / `shared.json` /
 * circle policy. The register never persists; it declares + routes.
 *
 * @param {object} register           a param register (createParamRegistry)
 * @param {object} arg
 * @param {string} arg.key            the param key to set
 * @param {*}      arg.value          the new value
 * @param {object} [opts]
 * @param {Record<'device'|'agent'|'circle', (p:{key,value,scope,spec})=>void>} [opts.homes]  scope → home writer
 * @returns {{ok:boolean, key?:string, value?:*, scope?:string, home?:string, error?:string}}
 */
export async function setParam(register, { key, value } = {}, { homes } = {}) {
  if (!register || typeof register.isSettable !== 'function') throw new Error('setParam: a param register is required');
  if (typeof key !== 'string' || !key) return { ok: false, error: 'param-key-required' };
  if (!register.has(key))          return { ok: false, error: 'param-unknown', key };
  if (!register.isSettable(key))   return { ok: false, error: 'param-internal', key };   // the kind gate — refuses internal

  register.setValue(key, value);
  const scope = register.scopeOf(key);
  const home = homes && homes[scope];
  // Await the home so `ok:true` means the value REACHED its sync home — a set that returned before the write
  // landed would be a lie a caller (or a set→read crossing test) could observe.
  if (typeof home === 'function') await home({ key, value, scope, spec: register.specOf(key) });
  return { ok: true, key, value, scope, home: PARAM_HOME_FOR[scope] };
}
