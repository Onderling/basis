/**
 * createMobileBootstrap — opinionated factory for the RN-side
 * "engine + pod + auth" bring-up sequence.
 *
 * The desktop equivalent is each app's own `apps/<name>/src/cli/_podFactory.js`
 * + manual session restore.  On RN we have an extra moving piece (the
 * `OidcSessionRN` to thaw from `expo-secure-store` first); this helper
 * standardises the order:
 *
 *   1. Restore tokens (caller-supplied `restoreTokens`).
 *   2. If authenticated → build a `PodClient` via `defaultPodFactory`.
 *   3. Hand control to a caller-supplied `buildEngine({podClient, oidc})`
 *      to construct the actual engine (Folio's SyncEngine, Pinboard's
 *      `bundle.cache.attachInner`, …).
 *   4. Wire `setBgRunOnce` to the engine's runOnce equivalent so
 *      background-fetch triggers reach a live engine.
 *
 * The factory is intentionally callback-based — it knows nothing about
 * the engine shape, only that an engine has a runOnce-like method the
 * caller wants to schedule.  Apps that don't use background fetch can
 * pass `null` for `runOnceFn`.
 *
 * Lifted from `apps/folio-mobile/src/lib/serviceBuilder.js` 2026-05-08
 * (Pinboard V3 Phase 40.2).  Folio-mobile's `ServiceContext` should be
 * the canonical caller; Pinboard V3's mobile bootstrap mirrors it.
 */

import { setBgRunOnce, clearBgRunOnce } from './bgRunOnce.js';
import { defaultPodFactory }            from './podFactory.js';

/**
 * @template TEngine
 *
 * @param {object} args
 * @param {object} args.oidc                                    OidcSessionRN-compatible.
 * @param {() => Promise<boolean>} [args.restoreTokens]         Called first; if it
 *                                                                resolves false, the bootstrap
 *                                                                returns `{authenticated:false}`.
 *                                                                Defaults to `oidc.restoreFromVault()`.
 * @param {object} [args.podCfg]                                When omitted, the bootstrap
 *                                                                does not build a PodClient (
 *                                                                local-only mode).
 * @param {string} [args.podCfg.podRoot]
 * @param {(args: { podClient: object|null, oidc: object }) => Promise<TEngine>} args.buildEngine
 * @param {(engine: TEngine) => () => Promise<unknown>} [args.runOnceFn]
 *        When supplied, returns a runOnce-shaped function that the
 *        bootstrap wires to `setBgRunOnce`.  Apps that don't do
 *        background fetch pass undefined.
 * @param {(msg: string) => void} [args.onWarning]
 *
 * @returns {Promise<{
 *   authenticated: boolean,
 *   engine: TEngine | null,
 *   podClient: object | null,
 *   detach: () => Promise<void>,
 * }>}
 */
export async function createMobileBootstrap({
  oidc,
  restoreTokens,
  podCfg,
  buildEngine,
  runOnceFn,
  onWarning,
}) {
  if (!oidc) throw new Error('createMobileBootstrap: oidc required');
  if (typeof buildEngine !== 'function') {
    throw new Error('createMobileBootstrap: buildEngine required');
  }

  const restored = typeof restoreTokens === 'function'
    ? await restoreTokens()
    : (typeof oidc.restoreFromVault === 'function'
      ? await oidc.restoreFromVault({ onWarning })
      : false);

  if (!restored || !oidc.isAuthenticated?.()) {
    return {
      authenticated: false,
      engine:        null,
      podClient:     null,
      detach:        async () => { /* nothing to detach */ },
    };
  }

  const podClient = podCfg?.podRoot
    ? await defaultPodFactory(podCfg, oidc)
    : null;

  const engine = await buildEngine({ podClient, oidc });

  if (typeof runOnceFn === 'function') {
    const fn = runOnceFn(engine);
    if (typeof fn === 'function') setBgRunOnce(fn);
  }

  const detach = async () => {
    clearBgRunOnce();
    if (engine && typeof engine.stop === 'function') {
      try { await engine.stop(); } catch { /* swallow */ }
    }
  };

  return { authenticated: true, engine, podClient, detach };
}
