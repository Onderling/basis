// circlePodCustody.js — per-circle pod custody-resolution, SHARED (moved out of the web shell).
//
// A circle member already holds the circle group key (this device's per-circle X25519 sealing identity,
// vault-backed, unwraps it from the control agent's key resource + the no-pod key-event fold). So sealing /
// reading pod rows with that key is device-local MEMBER custody — not a broker/proxy. This module resolves,
// per circle, the {backend, sealed, strategy} triple and the seal-or-refuse write / read / ref operations
// the send + catch-up paths use, so the ONE agent seals→writes / range-queries→opens each circle's shared
// pod at call time (invariant #6).
//
// It lived in `apps/basis/web/v2/circleApp.js` (web-only), which (a) violated invariants 1+2 (a shell must
// carry no such logic) and (b) meant the shared store-construction path could not reach a circle's pod
// backend — the blocker for cache-mode mirroring (the store's pod feed). Extracting it behind an injected-
// dependency seam makes it platform-neutral: the PLATFORM supplies `ensureCirclePod` (how to stand up / get
// a circle's pod producer — web-woven today, RN later) + the policy and seal-strategy resolvers; everything
// here is pure of web/RN specifics. Reuses existing primitives only — no new crypto.

import {
  podStorageBackend, writeSealedMessage, readSealedMessage, readSealedMessagesSince,
} from '@onderling/pod-client';
import { resolveCircleDataPolicy, circleHasPod } from './circleDataPolicy.js';

/**
 * Build the per-circle pod custody-resolution surface over injected platform deps.
 *
 * @param {object} deps
 * @param {(circleId:string, policy:object)=>Promise<{podClient:object}|null>} deps.ensureCirclePod
 *        Stand up / fetch a circle's pod producer (platform-specific; provides `.podClient`).
 * @param {(circleId:string)=>Promise<{pod:string, storagePosture?:string}>} deps.policyFor
 *        The circle's data-policy (`policy.pod` + `policy.storagePosture`).
 * @param {(circleId:string, policy:object)=>Promise<{seal:Function, open:Function}|null>} deps.sealStrategyFor
 *        The live group-key {seal,open} for the circle (null for a p0/p1 posture or no key).
 */
export function createCirclePodCustody({ ensureCirclePod, policyFor, sealStrategyFor } = {}) {
  if (typeof ensureCirclePod !== 'function') throw new TypeError('createCirclePodCustody: ensureCirclePod(circleId, policy) required');
  if (typeof policyFor !== 'function')       throw new TypeError('createCirclePodCustody: policyFor(circleId) required');
  if (typeof sealStrategyFor !== 'function') throw new TypeError('createCirclePodCustody: sealStrategyFor(circleId, policy) required');

  /**
   * Resolve a circle's live pod backend + seal strategy, or null for a no-pod circle (the seam is inert;
   * fan-out-full stays). A SEALED posture (p2/p3) needs the live group key; p0/p1 seal nothing.
   */
  async function resolveCirclePodCustody(circleId) {
    if (!circleId) return null;
    const policy = await policyFor(circleId);
    if (!circleHasPod(policy.pod)) return null;                      // no-pod circle → inert seam
    const prod = await ensureCirclePod(circleId, policy);
    if (!prod?.podClient) return null;
    const sealed = policy.storagePosture === 'p2' || policy.storagePosture === 'p3';
    const strategy = await sealStrategyFor(circleId, policy);        // live group-key {seal,open}; null for p0/p1 or no key
    return { backend: podStorageBackend(prod.podClient), sealed, strategy };
  }

  /** Send-path data-move branch for a circle (`policy.pod` → 'fan-out-full' | 'pod-signal' | 'pod-only'). */
  async function circleSendDataMove(circleId) {
    const policy = await policyFor(circleId);
    return resolveCircleDataPolicy(policy.pod).dataMove;
  }

  /**
   * Seal + write one row to the circle's shared pod; return its opaque `ref` (the pod-signal fan carries it
   * in place of the body). SEAL-OR-REFUSE: a sealed circle whose group key is not resolvable THROWS rather
   * than write plaintext — the caller then degrades to fan-out-full, loudly (invariant #7). A p0/p1 circle
   * writes unsealed by design (seal === null).
   */
  async function circlePodWrite(circleId, envelope) {
    const c = await resolveCirclePodCustody(circleId);
    if (!c) throw new Error(`circlePodWrite: no shared pod for circle ${circleId}`);                       // → fan-out-full degrade
    if (c.sealed && !c.strategy) throw new Error(`circlePodWrite: sealed circle ${circleId} has no group key — refusing to write plaintext`);
    const ref = await writeSealedMessage(c.backend, c.strategy?.seal ?? null, envelope);
    return { ref };
  }

  /** Range-query + open the circle's shared-pod rows since a ts (the getMessagesSince catch-up merge). */
  async function circlePodReadSince(circleId, q) {
    const c = await resolveCirclePodCustody(circleId);
    if (!c || (c.sealed && !c.strategy)) return { items: [] };       // no pod / can't open → fall back to the local mirror
    return readSealedMessagesSince(c.backend, c.strategy?.open ?? null, { circleId, ...q });
  }

  /** Resolve one pod-signal REF envelope → the full envelope (read the pod row + unseal). */
  async function circleResolveRef(refEnvelope) {
    const c = await resolveCirclePodCustody(refEnvelope?.circleId);
    if (!c || (c.sealed && !c.strategy)) return null;                // no pod / can't open → inbox skips the ref (deferred)
    return readSealedMessage(c.backend, c.strategy?.open ?? null, refEnvelope.ref);
  }

  return { resolveCirclePodCustody, circleSendDataMove, circlePodWrite, circlePodReadSince, circleResolveRef };
}
