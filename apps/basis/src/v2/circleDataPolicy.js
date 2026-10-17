/**
 * basis v2 — the ONE circle data-policy (Phase 3, C9).
 *
 * A circle's data posture used to be stated as TWO enums that describe the
 * SAME concept and drift apart:
 *
 *   - `policy.pod`      (`none | shared | personal | hybrid`) — where the
 *                        circle's shared content lives, persisted in the
 *                        circle policy (circlePolicy.js).
 *   - PseudoPod `mode`  (`standalone | replication-ring | cache`) — how the
 *                        store backs that content, chosen at store-build time.
 *
 * They are two views of one decision. This module makes `policy.pod` the
 * SINGLE canonical data-policy vocabulary and derives, in ONE place, both
 *   (a) the Phase-2 `dataMove` branch (how a message MOVES on the send path),
 *   (b) the PseudoPod/store `mode` (how the store BACKS the content), and
 *   (c) the catch-up strategy (which was already re-deriving the same posture),
 * so a circle's data posture is stated once and read by every consumer instead
 * of being re-derived independently in each. The seal/at-rest posture
 * (`storagePosture` p0–p3) and pinboard's storage TIER are ORTHOGONAL axes and
 * are NOT folded in here (see circleStoragePolicy.js / resolveCircleStorage.js).
 *
 * Pure JS — no I/O, no clock, no random. Deterministic for tests.
 */

import { CIRCLE_POLICY_ENUMS } from './circlePolicy.js';
import { PSEUDO_POD_MODES }    from '@onderling/pseudo-pod';

/**
 * The canonical circle data-policy values — the SINGLE vocabulary. Sourced
 * from `circlePolicy.CIRCLE_POLICY_ENUMS.pod` so this module can't drift from
 * the persisted policy shape.
 * @type {ReadonlyArray<'none'|'shared'|'personal'|'hybrid'>}
 */
export const CIRCLE_DATA_POLICIES = Object.freeze([...CIRCLE_POLICY_ENUMS.pod]);

/**
 * The Phase-2 `dataMove` branches the send path routes to (per
 * DESIGN-connectivity-phase2-deliver §2). `ref+blob` is chosen by PAYLOAD
 * SIZE, not by data-policy, so it is a valid branch but is not produced by
 * this posture mapping (a large payload overrides the posture branch at send
 * time). The other three are 1:1 with the data-policy.
 * @type {ReadonlyArray<'fan-out-full'|'pod-signal'|'pod-only'|'ref+blob'>}
 */
export const DATA_MOVE_BRANCHES = Object.freeze(['fan-out-full', 'pod-signal', 'pod-only', 'ref+blob']);

/**
 * The PseudoPod/store modes — re-exported from `@onderling/pseudo-pod` so the
 * store-adapter half of the vocabulary has one definition, not a copy.
 * @type {ReadonlyArray<'standalone'|'replication-ring'|'cache'>}
 */
export const STORE_MODES = PSEUDO_POD_MODES;

/**
 * The single mapping table: canonical data-policy → { dataMove, storeMode,
 * catchUp, hasPod }. This is the ONE place the pod posture is turned into a
 * concrete branch/mode. Each column is behaviour-identical to the derivation
 * it replaces (dataMove ← phase-2 design §2; catchUp ← the prior
 * `pickCatchUpStrategy` switch; storeMode ← the store-build reality where a
 * no-pod circle is `standalone` and a pod-backed circle write-through `cache`s).
 *
 *   policy   | dataMove      | storeMode        | catchUp | hasPod
 *   ---------|---------------|------------------|---------|-------
 *   none     | fan-out-full  | standalone       | peer    | false
 *   shared   | pod-signal    | cache            | pod     | true
 *   personal | pod-only      | cache            | peer    | true
 *   hybrid   | pod-signal    | cache            | hybrid  | true
 *
 * @type {Readonly<Record<'none'|'shared'|'personal'|'hybrid', {dataMove:string, storeMode:string, catchUp:string, hasPod:boolean}>>}
 */
export const DATA_POLICY_MAP = Object.freeze({
  // No shared pod: the envelope carries the data (fan-out), the store is a
  // plain single-device local mirror, catch-up can only ask peers.
  none:     Object.freeze({ dataMove: 'fan-out-full', storeMode: 'standalone', catchUp: 'peer',   hasPod: false }),
  // Circle-shared pod: write the pod + fan a ref (pod-signal); the store
  // write-through caches to that pod; catch-up range-queries the pod.
  shared:   Object.freeze({ dataMove: 'pod-signal',   storeMode: 'cache',      catchUp: 'pod',    hasPod: true  }),
  // Per-member personal pods, no fan-out: members read the pod (pod-only);
  // the store caches to the member's own pod; catch-up is peer-to-peer.
  personal: Object.freeze({ dataMove: 'pod-only',     storeMode: 'cache',      catchUp: 'peer',   hasPod: true  }),
  // Fan-out AND pod backing: pod-signal on the send path, cache-backed store,
  // catch-up uses the pod primary with peers as backfill.
  hybrid:   Object.freeze({ dataMove: 'pod-signal',   storeMode: 'cache',      catchUp: 'hybrid', hasPod: true  }),
});

/**
 * The forward-compatible fallback row for an unknown/missing data-policy: the
 * no-pod posture. Matches the prior consumers' defaults (catch-up fell back to
 * 'peer'; the store defaulted to a local 'standalone' mirror) — the safest
 * choice when the posture is unknown is to never assume a pod exists.
 */
const FALLBACK_ROW = DATA_POLICY_MAP.none;

/**
 * Legacy → canonical: fold a bare PseudoPod `mode` string into the canonical
 * data-policy vocabulary, so a caller that only had the store-mode half still
 * resolves. This inverse is LOSSY — `cache` covers three pod-backed policies
 * (shared/personal/hybrid); it maps to `shared`, the canonical pod-backed
 * default. `replication-ring` is peer fan-out with no pod → `none`. Callers
 * that hold the real `policy.pod` should pass THAT (it is already canonical
 * and never lossy); this exists only for legacy mode-only call sites.
 * @type {Readonly<Record<'standalone'|'replication-ring'|'cache', 'none'|'shared'>>}
 */
export const LEGACY_MODE_TO_POLICY = Object.freeze({
  standalone:         'none',
  'replication-ring': 'none',
  cache:              'shared',
});

/**
 * Coerce any input to a canonical data-policy value. Accepts:
 *   - a canonical value (`none|shared|personal|hybrid`) — returned as-is;
 *   - a legacy PseudoPod mode string — folded via LEGACY_MODE_TO_POLICY;
 *   - a policy object (`{ pod }`) — its `pod` field is read;
 *   - anything else / unknown — falls back to `'none'` (the no-pod posture).
 *
 * @param {string|{pod?:string}|null|undefined} input
 * @returns {'none'|'shared'|'personal'|'hybrid'}
 */
export function normalizeDataPolicy(input) {
  const raw = (input && typeof input === 'object') ? input.pod : input;
  if (CIRCLE_DATA_POLICIES.includes(raw)) return raw;
  if (Object.prototype.hasOwnProperty.call(LEGACY_MODE_TO_POLICY, raw)) return LEGACY_MODE_TO_POLICY[raw];
  return 'none';
}

/**
 * THE single resolver: given a circle policy (or a bare data-policy / legacy
 * mode value), return the full derived row `{ policy, dataMove, storeMode,
 * catchUp, hasPod }`. Every consumer (the send-path `dataMove` resolver, the
 * store adapter's mode, the catch-up router) reads from HERE instead of
 * re-deriving the posture itself.
 *
 * @param {string|{pod?:string}|null|undefined} policyOrPod
 * @returns {{policy:'none'|'shared'|'personal'|'hybrid', dataMove:string, storeMode:string, catchUp:string, hasPod:boolean}}
 */
export function resolveCircleDataPolicy(policyOrPod) {
  const policy = normalizeDataPolicy(policyOrPod);
  const row = DATA_POLICY_MAP[policy] ?? FALLBACK_ROW;
  return { policy, ...row };
}

/** The send-path `dataMove` branch for a circle policy. */
export function circleDataMove(policyOrPod) {
  return resolveCircleDataPolicy(policyOrPod).dataMove;
}

/** The PseudoPod/store `mode` for a circle policy (what a store-build passes to createPseudoPod). */
export function circleStoreMode(policyOrPod) {
  return resolveCircleDataPolicy(policyOrPod).storeMode;
}

/** The catch-up strategy for a circle policy (the router's branch). */
export function circleCatchUpStrategy(policyOrPod) {
  return resolveCircleDataPolicy(policyOrPod).catchUp;
}

/** Whether the circle's data-policy involves a real pod (shared/personal/hybrid). */
export function circleHasPod(policyOrPod) {
  return resolveCircleDataPolicy(policyOrPod).hasPod;
}
