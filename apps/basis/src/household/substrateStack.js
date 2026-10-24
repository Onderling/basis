/**
 * Substrate-stack builder for Household circle bundles — THIN SHIM.
 *
 * The stack logic lives ONCE in `@onderling/substrate-stack` (it used to be the
 * "Household twin of Tasks-v0's" copy — invariant-#3 drift; consolidated
 * 2026-07-09). This shim preserves Household's DELIBERATE layering: the
 * notify-envelope **transport adapter is INJECTED**, never built from a core
 * `Agent` — keeping `apps/household` free of any basis dependency and
 * of `@onderling/core`'s `Agent`. The host (basis) owns the secure-mesh
 * wire and passes it in; with no agent here, `deviceId` is a hard
 * requirement (no `agent.address` fallback). Refs: OBJ-2 / S1a.
 *
 * The shim therefore does NOT forward an `agent` arg — the injected
 * `transport` + explicit `deviceId` remain the only entry shape.
 *
 * @typedef {object} EnvelopeTransport
 * @property {(env: object) => Promise<void>} publishEnvelope
 * @property {(cb: (payload: object, raw?: object) => void) => (() => void)} subscribeEnvelopes
 */

import { buildSubstrateStack as buildSharedSubstrateStack } from '@onderling/substrate-stack';

/**
 * @param {object} args
 * @param {EnvelopeTransport} args.transport — INJECTED adapter (required).
 * @param {string} args.deviceId — required (no fallback).
 * @param {object} [args.existingPseudoPod] — reuse instead of constructing.
 */
export function buildHouseholdSubstrateStack({ transport, deviceId, existingPseudoPod } = {}) {
  return buildSharedSubstrateStack({ transport, deviceId, existingPseudoPod });
}
