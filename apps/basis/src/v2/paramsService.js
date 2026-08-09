/**
 * paramsService — the composition seam for the parameter register (#36), basis side.
 *
 * The register is substrate (`@onderling/item-store` `createParamRegistry` / `setParam`); this is the
 * composition root that populates it by DI (invariant 5: the app declares its SETTABLE params INTO the
 * substrate register; the substrate never up-imports the app) and wires the `set-param` op to the value-
 * routing homes.
 *
 * VALUE ROUTING (#36 decision C) — REUSE the existing homes, no new sync plumbing:
 *   • device + agent → `@onderling/local-store` `createSettingsModule` — the `shared.json` + `devices/<id>.json`
 *     split (cross-app-settings convention), already extracted rule-of-two (Stoop → Tasks V1). A param KEY is
 *     a settings field; scope maps `device → 'device'`, `agent → 'shared'`.
 *   • circle → the circle policy's EXISTING `settings` map (per-circle setting values keyed by field), reached
 *     through the injected circle-policy store. No new `params` slot — a circle-scoped param IS a circle
 *     setting value, so it reuses the home already there (no duplication).
 *
 * ONE SOURCE OF TRUTH (decision a): the settings module's SCHEMA is DERIVED from the register's `userParams()`
 * — device-scoped user keys become `deviceFields`, agent-scoped become `sharedFields`, defaults come from the
 * register. The register declares once; the store persists; nothing maintains a second field list.
 *
 * Only kind:user params are declared into the register (a kind:internal param is immutable by construction —
 * decision E — so it has no settable value and is never here). `set-param` refuses everything else.
 */
import { createParamRegistry, setParam, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { createSettingsModule } from '@onderling/local-store';
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
 * The `@onderling/local-store` settings module whose SCHEMA is the register's device/agent user params
 * (decision a — one source of truth). Circle-scoped params are NOT here (they route to the circle policy).
 */
export function settingsModuleForRegister(register, { appId = 'basis' } = {}) {
  const users = register.userParams();
  const deviceFields = users.filter((p) => p.scope === PARAM_SCOPE.DEVICE).map((p) => p.key);
  const sharedFields = users.filter((p) => p.scope === PARAM_SCOPE.AGENT).map((p) => p.key);
  const defaults = Object.fromEntries(
    users.filter((p) => p.scope !== PARAM_SCOPE.CIRCLE).map((p) => [p.key, p.default]),
  );
  return createSettingsModule({ appId, sharedFields, deviceFields, defaults });
}

/**
 * createParamsService — the `set-param` op over the register, callable through the standard skill shape
 * (`callSkill('set-param', { key, value }, ctx)`). One generic op, register-gated: it enforces `kind` (user
 * only) and routes by scope to the real homes. `get-param` reads the live value; `list-user-params` is the
 * settings-form projection seed.
 *
 * @param {object} [opts]
 * @param {object}   [opts.register]     a param register (defaults to `basisParamRegistry()`)
 * @param {object}   [opts.dataSource]   a core.DataSource for the settings module (device/agent scopes)
 * @param {string}   [opts.deviceId]     this install's device id (per cross-app-settings)
 * @param {object}   [opts.circlePolicy] a circle-policy store (`.update(circleId, patch)`) for circle scope
 * @param {object}   [opts.settings]     an explicit settings module (else derived from the register)
 * @param {object}   [opts.homes]        explicit scope→writer override (tests / custom); else built from the stores
 */
export function createParamsService({ register = basisParamRegistry(), dataSource, deviceId, circlePolicy, settings, homes } = {}) {
  const settingsModule = settings ?? (dataSource ? settingsModuleForRegister(register) : null);

  // The default homes: route each scope to its real store. A writer is a no-op when its store was not injected,
  // so the seam degrades safely (the set still updates the in-memory register; only persistence is skipped).
  function defaultHomes(ctx) {
    const circleId = ctx?.circleId;
    return {
      device: async ({ key, value }) => {
        if (settingsModule && dataSource) await settingsModule.updateSettings({ dataSource, deviceId, patch: { [key]: value }, scope: 'device' });
      },
      agent: async ({ key, value }) => {
        if (settingsModule && dataSource) await settingsModule.updateSettings({ dataSource, deviceId, patch: { [key]: value }, scope: 'shared' });
      },
      circle: async ({ key, value }) => {
        if (circlePolicy && circleId) await circlePolicy.update(circleId, { settings: { [key]: value } });
      },
    };
  }

  const service = {
    register,
    settingsModule,
    async callSkill(op, args = {}, ctx = {}) {
      switch (op) {
        case 'set-param': return setParam(register, args, { homes: homes ?? defaultHomes(ctx) });
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
