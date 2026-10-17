/**
 * Substrate-stack builder for Pinboard bundles — THIN SHIM.
 *
 * The stack logic lives ONCE in `@onderling/substrate-stack` (it used to be
 * duplicated verbatim across pinboard / tasks-v0 / household — the exact
 * cross-app copy invariant #3 forbids; consolidated 2026-07-09). This shim
 * only preserves Pinboard's entry name + its literal deviceId fallback.
 *
 * Original context (Phase 52.9.2, Q-B groupMirror retirement): wires
 * `@onderling/pseudo-pod` + `@onderling/pod-routing` + `@onderling/notify-envelope`
 * per bundle, with per-recipient transport routing built from the agent.
 */

import { buildSubstrateStack as buildSharedSubstrateStack } from '@onderling/substrate-stack';

/**
 * @param {object} args — see `@onderling/substrate-stack`.
 * @param {import('@onderling/core').Agent} args.agent
 * @param {string} [args.deviceId] — defaults to `agent.address`.
 */
export function buildSubstrateStack(args = {}) {
  return buildSharedSubstrateStack({ fallbackDeviceId: 'pinboard-device', ...args });
}
