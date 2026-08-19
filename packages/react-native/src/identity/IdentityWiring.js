/**
 * IdentityWiring — assembles the identity-as-pod-content stack from the
 * arguments `createMeshAgent` accepts.
 *
 * Per Q-B.2 (locked 2026-04-29: side-by-side migration).  This module is
 * only invoked when `createMeshAgent` is called with a `pod: { ... }` opt.
 * When the opt is absent, the existing local-only Vault behaviour is
 * preserved unchanged — there is no fallback path through this module.
 *
 * The wiring is intentionally minimal:
 *   1. Build a `Bootstrap` from the user's BIP-39 mnemonic (or accept a
 *      pre-built one for advanced callers / tests).
 *   2. Construct an `IdentityPodStore` against the caller-supplied
 *      `PodClient` (we deliberately do NOT import `@onderling/pod-client`
 *      here — the caller passes the client in so the RN package stays
 *      decoupled from the pod-client package's transitive deps).
 *   3. `await podStore.init()` so the manifest is materialized before the
 *      agent starts processing inbound traffic.
 *   4. Construct an `IdentitySync` and `start()` it.
 *   5. Wire RN `AppState` → `sync.onForeground()` via a lazy import so
 *      Node test environments (and Web targets) work without bundling RN.
 *
 * The returned `dispose` is wired into `createMeshAgent`'s teardown so
 * `agent.stop()` cleans up the sync loop and the AppState listener.
 */

import { Bootstrap } from '@onderling/core';
import { IdentityPodStore } from '@onderling/pod-client';

// IdentitySync is shipped by B3 (running in parallel).  We reference it via
// dynamic import inside `attachIdentityToAgent` so this file can be required
// in environments where B3 hasn't been merged yet (e.g. mid-flight CI on a
// branch that lands before B3).  Once B3 is in `master`, the dynamic import
// resolves identically to a static one.  Callers may also inject a custom
// `IdentitySync` constructor via `opts.pod._identitySyncCtor` for tests.

/**
 * Wire identity-as-pod-content sync onto an already-constructed Vault +
 * AgentIdentity.  Returns the constructed pieces plus a `dispose` function
 * that the agent's teardown should invoke.
 *
 * @param {object} opts
 * @param {object} opts.vault                              local Vault, already constructed by createMeshAgent
 * @param {object} opts.identity                           AgentIdentity, already constructed
 * @param {object} opts.pod
 * @param {string} [opts.pod.webid]                        user's WebID (informational; podRoot is the truth)
 * @param {string} [opts.pod.mnemonic]                     BIP-39 phrase to recover the bootstrap secret
 * @param {object} [opts.pod.bootstrap]                    pre-built Bootstrap (alternative to mnemonic; for tests / advanced callers)
 * @param {object} opts.pod.podClient                      caller-supplied PodClient (from `@onderling/pod-client`)
 * @param {string} opts.pod.podRoot                        pod root URI; identity container will be at `<podRoot>/onderling/`
 * @param {number} [opts.pod.intervalMs=300_000]           IdentitySync polling interval (5 min default per Q-B.4)
 * @param {Function} [opts.pod._identitySyncCtor]          (test-only) inject IdentitySync constructor; default: lazy `import('@onderling/pod-client').IdentitySync`
 * @returns {Promise<{ bootstrap: object, podStore: object, sync: object, dispose: () => void }>}
 */
export async function attachIdentityToAgent({ vault, identity, pod } = {}) {
  if (!vault) {
    throw new Error('attachIdentityToAgent: vault is required');
  }
  if (!identity) {
    throw new Error('attachIdentityToAgent: identity is required');
  }
  if (!pod || typeof pod !== 'object') {
    throw new Error('attachIdentityToAgent: pod opt is required');
  }
  if (!pod.podClient) {
    throw new Error('attachIdentityToAgent: pod.podClient is required');
  }
  if (typeof pod.podRoot !== 'string' || pod.podRoot.length === 0) {
    throw new Error('attachIdentityToAgent: pod.podRoot is required');
  }
  if (!pod.bootstrap && (typeof pod.mnemonic !== 'string' || pod.mnemonic.length === 0)) {
    throw new Error('attachIdentityToAgent: pod.mnemonic or pod.bootstrap is required');
  }
  // `webid` is currently informational — we do not validate it here.  The
  // pod identity is rooted by `podRoot` + the AgentIdentity pubKey.  Apps
  // that map WebID → podRoot do so before calling createMeshAgent.

  // ── 1. Bootstrap ────────────────────────────────────────────────────────
  const bootstrap = pod.bootstrap ?? Bootstrap.fromMnemonic(pod.mnemonic);

  // ── 2. IdentityPodStore ─────────────────────────────────────────────────
  const podStore = new IdentityPodStore({
    podClient: pod.podClient,
    bootstrap,
    identity,
    podRoot:   pod.podRoot,
  });

  // ── 3. Materialize manifest ─────────────────────────────────────────────
  await podStore.init();

  // ── 4. IdentitySync ─────────────────────────────────────────────────────
  // Resolve the constructor.  Tests / advanced callers may inject; default
  // is a dynamic import from core so this file can be required even before
  // B3 lands.  The dynamic import resolves immediately once B3 is merged.
  let IdentitySyncCtor = pod._identitySyncCtor;
  if (!IdentitySyncCtor) {
    const podClient = await import('@onderling/pod-client');
    IdentitySyncCtor = podClient.IdentitySync;
    if (!IdentitySyncCtor) {
      throw new Error(
        'attachIdentityToAgent: IdentitySync is not exported from @onderling/pod-client. ' +
        'pass pod._identitySyncCtor explicitly.',
      );
    }
  }

  const sync = new IdentitySyncCtor({
    vault,
    podStore,
    intervalMs: pod.intervalMs ?? 300_000,
  });
  sync.start();

  // ── 5. RN AppState foreground trigger ───────────────────────────────────
  // Lazy import so apps without `react-native` available (Node tests, Web
  // targets via @onderling/core, etc.) construct successfully.  We swallow
  // any error from the import or listener registration — AppState
  // integration is a nice-to-have, not a correctness requirement.
  let appStateSub = null;
  try {
    const rn = await import('react-native').catch(() => null);
    const AppState = rn?.AppState ?? rn?.default?.AppState;
    if (AppState && typeof AppState.addEventListener === 'function') {
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && typeof sync.onForeground === 'function') {
          try { sync.onForeground(); } catch { /* swallow — non-fatal */ }
        }
      });
    }
  } catch {
    // RN not available — Node test env, Web target, or RN module shape
    // changed.  Non-fatal: skip the listener.
  }

  const dispose = () => {
    try { sync.stop(); } catch { /* swallow */ }
    if (appStateSub && typeof appStateSub.remove === 'function') {
      try { appStateSub.remove(); } catch { /* swallow */ }
    }
  };

  return { bootstrap, podStore, sync, dispose };
}
