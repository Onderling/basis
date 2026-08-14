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
import { DEFAULT_RETENTION_DAYS } from './retentionPref.js';
import { DEFAULT_SHARE_NKN_ADDRESS, SHARE_NKN_ADDRESS_PARAM_KEY } from './addressSharing.js';

/**
 * The settable (kind:user) params basis governs — the worked-example cluster. Grows as more clusters migrate;
 * each entry is `{ key, scope, kind:'user', default }` with the default sourced from the declaration site.
 */
export const BASIS_USER_PARAMS = [
  { key: 'nearby.ask.defaultTtlMs', scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER, default: ASK_DEFAULT_TTL_MS },
  // The windowed-class retention default — INTERNAL since the cleanup redesign (the conversation is the
  // RECORD and never expires by policy; the user's act is the explicit purgeConversation control, an
  // operation, not a param). Kept in the register so the boot readers (`getParamValue('retention.chatDays')`)
  // still resolve; kind matches the declaration site, per the declare-agreement guard.
  { key: 'retention.chatDays',      scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: DEFAULT_RETENTION_DAYS },
  // Registered 2026-08-10 (review finding 2): declared kind:user at their sites but governed by no register
  // (inert settability). Defaults MUST match the declaration site — the duplicate-vocab guard enforces agreement.
  { key: 'calendarEmission.defaultDurationMin', scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER, default: 30 },
  { key: 'onlineCadence.pollIntervalMs',        scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 5000 },
  // The personal history mirror's switch — OFF by default: nothing mirrors until the person turns it on
  // (the connect-storage door flips it; boot reads it to wire the sealed follower sink).
  { key: 'history.mirror',                      scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER, default: false },
  // Instant restore's recency window (per circle, whichever half is LARGER wins): everything from the
  // last N days plus the newest M entries hydrate first, so conversations open live; the rest lands in
  // the background. Agent-scoped: the window is a preference of the PERSON, not of one device.
  { key: 'history.restore.recencyDays',         scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER, default: 30 },
  { key: 'history.restore.maxPerCircle',        scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER, default: 500 },
  // The wake-nudges switch (offline delivery) — consolidated from the bare cc-wake-nudges
  // AsyncStorage key (the device-params consolidation's exemplar). DEVICE scope: a wake token is
  // per install. The Settings CONTROL is the proper door (it runs the whole permission→token→relay
  // chain); a raw form write converges at the next boot's restore.
  { key: 'wake.nudges',                         scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: false },
  // "Never share my global address" — consolidated from the bare cc.shareNknAddress key. The register
  // read is now the ENFORCED value everywhere (realAgent's contact-QR gate reads it live); before the
  // consolidation the enforcement sites read an opt no shell ever passed — the setting was UI-only.
  { key: SHARE_NKN_ADDRESS_PARAM_KEY,           scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: DEFAULT_SHARE_NKN_ADDRESS },
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

  // The default homes: route each scope to its real store. Built ONLY for the scopes the register actually
  // declares a settable param for — a home writer exists iff a param that could reach it exists (so no
  // standing device/circle writer sits as code reached only by tests; it materialises when a real param of
  // that scope migrates). A writer is still a no-op if its store was not injected, so the seam degrades safely
  // (the set updates the in-memory register; only persistence is skipped).
  function defaultHomes(ctx) {
    const circleId = ctx?.circleId;
    const scopes = new Set(register.userParams().map((p) => p.scope));
    const h = {};
    if (scopes.has(PARAM_SCOPE.DEVICE)) {
      h.device = async ({ key, value }) => {
        if (settingsModule && dataSource) await settingsModule.updateSettings({ dataSource, deviceId, patch: { [key]: value }, scope: 'device' });
      };
    }
    if (scopes.has(PARAM_SCOPE.AGENT)) {
      h.agent = async ({ key, value }) => {
        if (settingsModule && dataSource) await settingsModule.updateSettings({ dataSource, deviceId, patch: { [key]: value }, scope: 'shared' });
      };
    }
    if (scopes.has(PARAM_SCOPE.CIRCLE)) {
      h.circle = async ({ key, value }) => {
        if (circlePolicy && circleId) await circlePolicy.update(circleId, { settings: { [key]: value } });
      };
    }
    return h;
  }

  const service = {
    register,
    settingsModule,
    /**
     * hydrate — the READ side (#36): load persisted kind:user param VALUES from the homes into the
     * register, so `valueOf` (and `get-param`) return the synced value, not just the code default. Call at
     * boot (device/agent scope) and per-circle-open (circle scope). Only genuinely-set values (≠ the code
     * default) become overrides — an unset param stays at its default. kind:internal params are never here.
     */
    async hydrate({ circleId } = {}) {
      const users = register.userParams();
      if (settingsModule && dataSource) {
        const loaded = await settingsModule.loadSettings({ dataSource, deviceId });
        for (const p of users) {
          if (p.scope !== PARAM_SCOPE.CIRCLE && loaded[p.key] !== undefined && loaded[p.key] !== p.default) {
            register.setValue(p.key, loaded[p.key]);
          }
        }
      }
      if (circlePolicy && circleId) {
        const policy = await circlePolicy.get(circleId);
        const cs = (policy && policy.settings) || {};
        for (const p of users) {
          if (p.scope === PARAM_SCOPE.CIRCLE && cs[p.key] !== undefined && cs[p.key] !== p.default) {
            register.setValue(p.key, cs[p.key]);
          }
        }
      }
      return register;
    },
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
