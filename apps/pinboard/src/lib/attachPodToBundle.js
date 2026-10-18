/**
 * attachPodToBundle / detachPodFromBundle — the ONE device-independent
 * pod-attach activation, shared by Pinboard web AND mobile.
 *
 * Platform-parity principle (user, 2026-05-18): web ≡ mobile; neither
 * is the "primitive" one. The pod-storage mechanism is all substrate
 * + the shared `Agent.js` bundle (closure `innerKeyMap` + `_podCtx`);
 * only this activation glue must be invoked by every entry point —
 * mobile `ServiceContext.attachPod` and desktop `podSignIn.
 * completePodSignIn` both call this, so the routing/provisioning/
 * classifier behave identically on both.
 *
 * Derives `identity` / `agentInfo` / `circleId` from the bundle (which
 * carries `agent.identity`, `groupId`, `deviceId`/`substrateDeviceId`,
 * `localActor` on both platforms); callers may override any.
 *
 * Order: `setAnchor` → idempotent `ensurePodProvisioned` (best-effort
 * — never blocks local-first use, `pod-independence.md`) → fill
 * `_podCtx` (classify+reverse) → `cache.attachInner(source)`.
 */

import { classify, reverseResolve } from './podPathMap.js';
import { ensurePodProvisioned }     from './existingPodProvisioner.js';

/**
 * @param {object} a
 * @param {object} a.bundle    a Pinboard bundle (web or mobile)
 * @param {object} a.source    the constructed inner DataSource (SolidPodSource)
 * @param {string} a.podRoot   writable pod storage root (pim:storage-derived)
 * @param {string} [a.webid]
 * @param {Function} a.fetch   authed fetch (used by provisioning)
 * @param {object} [a.identity]
 * @param {object} [a.agentInfo]  `{deviceId, agentUri}`
 * @param {string} [a.circleId]
 */
export async function attachPodToBundle({
  bundle, source, podRoot, webid, fetch: authedFetch,
  identity, agentInfo, circleId,
}) {
  if (!bundle?.cache?.attachInner) {
    throw new Error('attachPodToBundle: bundle missing cache.attachInner (cache:false?)');
  }
  const id   = identity ?? bundle.agent?.identity ?? null;
  const circle = circleId   ?? bundle.groupId ?? null;
  const info = agentInfo ?? {
    deviceId: bundle.deviceId ?? bundle.substrateDeviceId ?? bundle.agent?.address ?? 'pinboard-device',
    agentUri: bundle.localActor ?? webid ?? 'agent://pinboard',
  };

  try { bundle.podRouting?.setAnchor?.(podRoot); } catch { /* swallow */ }

  try {
    await ensurePodProvisioned({
      podRoot,
      webid,
      fetch:     authedFetch,
      pseudoPod: bundle.pseudoPod,
      identity:  id,
      agentInfo: info,
    });
  } catch { /* ensurePodProvisioned never throws; defensive */ }

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

/** Inverse: deactivate routing + revert the anchor (cache preserved). */
export function detachPodFromBundle({ bundle }) {
  if (bundle?._podCtx) bundle._podCtx.active = false;
  try { bundle?.podRouting?.setAnchor?.(null); } catch { /* swallow */ }
}
