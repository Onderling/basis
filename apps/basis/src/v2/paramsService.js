/**
 * paramsService — the composition seam for the parameter register (#36), basis side.
 *
 * The register itself is substrate (`@onderling/item-store` `createParamRegistry` / `setParam`); this is the
 * composition root that populates it by DI (invariant 5: the app declares its SETTABLE params INTO the
 * substrate register; the substrate never up-imports the app) and wires the `set-param` op to the value-
 * routing homes. It is deliberately thin — declaration + routing, no persistence of its own.
 *
 * WHY ONLY THE kind:user PARAMS ARE DECLARED HERE: a kind:internal param has no settable value (immutable by
 * construction — decision E), so it is never in the runtime value register; it lives only as the compiled-in
 * `param()` default and the stale-param guard's static census. The register the set-op reads therefore holds
 * exactly the params a person may change, and `set-param` refuses everything else (internal or unknown).
 *
 * VALUE ROUTING (decision C — no new sync plumbing): `set-param` routes a set value to the EXISTING sync home
 * for the param's scope. The three writers are injected as `homes` — the host wires them to the existing
 * mechanisms (`device → devices/<id>.json`, `agent → shared.json`, `circle → circle policy`). Nothing sets
 * these params today, so leaving the writers to the host is behaviour-preserving; the routing DISPATCH (by
 * scope) is what this seam owns.
 */
import { createParamRegistry, setParam, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
// The default VALUE is imported from the declaration site, so there is one source of truth for the number;
// a fitness test pins that the register's declared default equals the exported const (agreement, not a copy).
import { ASK_DEFAULT_TTL_MS } from './nearbyAsks.js';

/**
 * The settable (kind:user) params basis governs — the worked-example cluster. Grows as more clusters migrate;
 * each entry is `{ key, scope, kind:'user', default }` with the default sourced from the declaration site.
 */
export const BASIS_USER_PARAMS = [
  { key: 'nearby.ask.defaultTtlMs', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.USER, default: ASK_DEFAULT_TTL_MS },
];

/**
 * Build a param register seeded with basis's settable params. Injected DOWN into whatever needs the live
 * value or the set op. `extraParams` lets a test or a later cluster declare more without editing this factory.
 */
export function basisParamRegistry(extraParams = []) {
  const reg = createParamRegistry();
  for (const spec of [...BASIS_USER_PARAMS, ...extraParams]) reg.declare(spec);
  return reg;
}

/**
 * createParamsService — the `set-param` op over the register, callable through the standard skill shape
 * (`callSkill('set-param', { key, value }, ctx)`). One generic op, register-gated: it enforces `kind` (user
 * only) and routes by scope to the injected `homes` writers. Reads (`get`) return the live value.
 *
 * @param {object} [opts]
 * @param {object} [opts.register]  a param register (defaults to `basisParamRegistry()`)
 * @param {Record<'device'|'agent'|'circle', Function>} [opts.homes]  scope → sync-home writer
 */
export function createParamsService({ register = basisParamRegistry(), homes } = {}) {
  const service = {
    register,
    async callSkill(op, args = {}, _ctx = {}) {
      switch (op) {
        case 'set-param': return setParam(register, args, { homes });
        case 'get-param': return register.has(args.key)
          ? { ok: true, key: args.key, value: register.valueOf(args.key) }
          : { ok: false, error: 'param-unknown', key: args.key };
        case 'list-user-params': return { ok: true, params: register.userParams() };
        default: throw new Error(`paramsService.callSkill: unknown op "${op}"`);
      }
    },
  };
  return service;
}
