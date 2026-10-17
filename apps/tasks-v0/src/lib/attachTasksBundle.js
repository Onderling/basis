/**
 * attachTasksBundle / detachTasksBundle — the ONE device-independent
 * pod-attach activation for Tasks, shared by Tasks web AND mobile.
 *
 * Mirror of `apps/pinboard/src/lib/attachPodToBundle.js` (commit `11a269a`).
 * Tasks M4 — platform-parity principle: web ≡ mobile; neither is the
 * "primitive" one. The pod-storage mechanism is all substrate +
 * the shared bundle (closure `innerKeyMap` + `_podCtx`); only this
 * activation glue must be invoked by every entry point —
 * `apps/tasks-v0/src/lib/podSignIn.js` (web) and
 * `apps/tasks-mobile/src/ServiceContext.attachPod` (mobile) both call
 * this, so routing/provisioning/classifier behave identically on both.
 *
 * Order: `setAnchor` → optional `ensurePodProvisioned` (injected;
 * best-effort — never blocks local-first use, `pod-independence.md`)
 * → fill `_podCtx` (classify+reverse) → `cache.attachInner(source)`.
 *
 * Pod provisioning: Tasks does not have its own provisioner yet (Pinboard's
 * `existingPodProvisioner` is app-specific; Tasks is the second consumer
 * but the rule-of-two lift to a shared package is a separate work item).
 * Callers may inject a `provision` callback; when absent the step is
 * skipped (byte-neutral — the no-pod path is unchanged).
 *
 * The `_podCtx` object is the same mutable holder Tasks' `buildBundle`
 * exposes. When `_podCtx` is absent from the bundle (pre-M4 or cache:
 * false path), this function skips it gracefully and just calls
 * `cache.attachInner(source)` — byte-neutral for the no-pod case.
 *
 * @module
 */

import { classify, reverseResolve } from './podPathMap.js';

/**
 * Activate pod routing + attach the inner DataSource on a Tasks bundle.
 *
 * @param {object} a
 * @param {object} a.bundle        a Tasks CircleState / circleBundle object;
 *   must have `cache.attachInner`. May have `_podCtx`, `podRouting`,
 *   `pseudoPod`.
 * @param {object} a.source        the constructed inner DataSource
 *   (SolidPodSource or equivalent).
 * @param {string} a.podRoot       pod storage root (pim:storage-derived)
 * @param {string} [a.webid]
 * @param {Function} a.fetch       authenticated fetch
 * @param {object} [a.agentInfo]   `{deviceId, agentUri}` — passed to
 *   `provision` if supplied.
 * @param {string} [a.circleId]      override if the bundle doesn't carry it
 * @param {Function} [a.provision] optional `async ({podRoot, webid,
 *   fetch, pseudoPod, agentInfo}) => void` provisioner. Best-effort:
 *   failures are swallowed. When absent the step is skipped.
 */
export async function attachTasksBundle({
  bundle, source, podRoot, webid, fetch: authedFetch,
  agentInfo, circleId, provision,
}) {
  if (!bundle?.cache?.attachInner) {
    throw new Error('attachTasksBundle: bundle missing cache.attachInner (cache:false?)');
  }

  const circle = circleId ?? bundle.circleId ?? bundle.groupId ?? null;
  const info = agentInfo ?? {
    deviceId: bundle.substrateDeviceId ?? bundle.deviceId ?? bundle.agent?.address ?? 'tasks-device',
    agentUri: bundle.localActor ?? webid ?? 'agent://tasks',
  };

  // setAnchor lets decentralised/hybrid policies resolve to this pod.
  try { bundle.podRouting?.setAnchor?.(podRoot); } catch { /* swallow */ }

  // Best-effort provisioning — create required pod containers + ACL if
  // absent. Never blocks local-first use (pod-independence.md).
  if (typeof provision === 'function') {
    try {
      await provision({
        podRoot,
        webid,
        fetch:     authedFetch,
        pseudoPod: bundle.pseudoPod,
        agentInfo: info,
      });
    } catch { /* provision failure must not block local-first use */ }
  }

  // Fill _podCtx so the innerKeyMap closure can route logical keys to
  // pod URIs. When _podCtx is absent (old bundle shape / cache:false),
  // the fill is a no-op — innerKeyMap stays identity → byte-neutral.
  if (bundle._podCtx) {
    bundle._podCtx.classify   = classify;
    bundle._podCtx.reverse    = reverseResolve;
    bundle._podCtx.podRouting = bundle.podRouting ?? null;
    bundle._podCtx.circleId     = circle;
    bundle._podCtx.vars       = {};
    bundle._podCtx.active     = !!(bundle.podRouting && classify);
  }

  await bundle.cache.attachInner(source);
}

/**
 * Inverse: deactivate routing + revert the anchor (cache preserved so
 * the user keeps working offline).
 *
 * @param {object} a
 * @param {object} [a.bundle]
 */
export function detachTasksBundle({ bundle }) {
  if (bundle?._podCtx) bundle._podCtx.active = false;
  try { bundle?.podRouting?.setAnchor?.(null); } catch { /* swallow */ }
}
