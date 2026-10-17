/**
 * @onderling/substrate-stack — the shared per-bundle substrate composition.
 *
 * Wires `@onderling/pseudo-pod` + `@onderling/pod-routing` + `@onderling/notify-envelope`
 * (+ optional `@onderling/versioning`) into one stack. Consolidates the three
 * near-identical app-local builders (pinboard / tasks-v0 / household
 * `substrateStack.js` — self-described mirrors, the exact cross-app
 * duplication invariant #3 forbids); the app files stay as THIN SHIMS over
 * this factory so no importer changes.
 *
 * Two entry shapes (both preserved from the originals):
 *   - **agent-derived** (pinboard/tasks): pass `agent` — the notify-envelope
 *     transport adapter is built from it (`createAgentTransportAdapter`,
 *     per-recipient routing via `agent.transportFor`, subscribing every
 *     named transport).
 *   - **transport-injected** (household): pass `transport`
 *     (`{publishEnvelope, subscribeEnvelopes}`) + `deviceId`. This keeps the
 *     app free of `@onderling/core`'s `Agent` — the host owns the wire and
 *     injects it (household's deliberate layering; see its shim header).
 *     `transport` wins when both are given.
 *
 * **Versioning (the composition seam).** Pass `versioning` to give the
 * stack's pseudo-pod a version history (PLAN-pod-versioning-history-recovery):
 *   - a prebuilt store (duck-typed `{capture}`) — injected as-is; or
 *   - `{ hash, retention?, versionsRoot? }` — the factory builds a
 *     `createVersionStore` sharing the pod's OWN backend (version keys under
 *     `versions/`, disjoint from live `pseudo-pod://` keys) with
 *     `writerId = deviceId` (multi-writer-safe keys). `hash` is caller-
 *     supplied (async sha256) — this package stays runtime-agnostic, no
 *     `node:` imports (same invariant as pseudo-pod).
 * The built store is returned as `versionStore` so surfaces (restore) can
 * list/read/restore. Incompatible with `existingPseudoPod` (versioning is an
 * injection-time seam; a pre-built pod can't gain it) — that combination throws.
 */

import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting }                     from '@onderling/pod-routing';
import { createNotifyEnvelope }                 from '@onderling/notify-envelope';
import { createVersionStore }                   from '@onderling/versioning';

/**
 * @param {object} args
 * @param {object} [args.agent]      — a core `Agent` (duck-typed: `address`,
 *   `transportFor`, `transportNames`, `getTransport`). Used to build the
 *   transport adapter when `transport` is not injected, and as the
 *   `deviceId` fallback (`agent.address`).
 * @param {{publishEnvelope: Function, subscribeEnvelopes: Function}} [args.transport]
 *   — injected notify-envelope transport adapter; wins over `agent`.
 * @param {string} [args.deviceId]   — required when no `agent`.
 * @param {string} [args.fallbackDeviceId] — app-shim literal fallback
 *   (e.g. 'pinboard-device'), used only when neither deviceId nor
 *   agent.address resolve.
 * @param {object} [args.existingPseudoPod] — reuse instead of constructing.
 * @param {object} [args.backend]    — StorageBackend (default MemoryBackend).
 * @param {'standalone'|'replication-ring'|'cache'} [args.mode]
 * @param {string|null} [args.anchorPodUri]
 * @param {object} [args.versioning] — prebuilt version store (`{capture}`)
 *   or `{ hash, retention?, versionsRoot? }` build opts (see header).
 * @returns {{ pseudoPod, podRouting, notifyEnvelope, transport, deviceId,
 *   versionStore: object|null, stop: () => void }}
 */
export function buildSubstrateStack({
  agent,
  transport,
  deviceId,
  fallbackDeviceId,
  existingPseudoPod,
  backend,
  mode = 'standalone',
  anchorPodUri = null,
  versioning,
} = {}) {
  const effectiveTransport = transport ?? (agent ? createAgentTransportAdapter(agent) : null);
  if (!effectiveTransport?.publishEnvelope || !effectiveTransport?.subscribeEnvelopes) {
    throw Object.assign(
      new Error('buildSubstrateStack: an `agent` or a transport adapter ({publishEnvelope, subscribeEnvelopes}) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const effectiveDeviceId = deviceId ?? agent?.address ?? fallbackDeviceId;
  if (typeof effectiveDeviceId !== 'string' || effectiveDeviceId.length === 0) {
    throw Object.assign(
      new Error('buildSubstrateStack: deviceId is required (no agent.address to fall back on)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (versioning && existingPseudoPod) {
    throw Object.assign(
      new Error('buildSubstrateStack: `versioning` cannot be applied to an `existingPseudoPod` — versioning is injected at pseudo-pod construction; version the pod where it is built'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // Resolve the versioning seam: prebuilt store, or build one on the pod's backend.
  const effectiveBackend = existingPseudoPod ? null : (backend ?? createMemoryBackend());
  let versionStore = null;
  if (versioning) {
    if (typeof versioning.capture === 'function') {
      versionStore = versioning;
    } else if (typeof versioning.hash === 'function') {
      versionStore = createVersionStore({
        backend:      effectiveBackend,
        hash:         versioning.hash,
        writerId:     effectiveDeviceId,
        retention:    versioning.retention,
        versionsRoot: versioning.versionsRoot,
      });
    } else {
      throw Object.assign(
        new Error('buildSubstrateStack: `versioning` must be a store ({capture}) or build opts ({hash, …})'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }

  const pseudoPod = existingPseudoPod ?? createPseudoPod({
    backend:  effectiveBackend,
    mode,
    deviceId: effectiveDeviceId,
    ...(versionStore ? { versioning: versionStore } : {}),
  });
  const podRouting = createPodRouting({
    pseudoPod,
    deviceId: effectiveDeviceId,
    anchorPodUri,
  });
  const notifyEnvelope = createNotifyEnvelope({
    transport: effectiveTransport, pseudoPod, podRouting,
  });
  notifyEnvelope.start();

  const stop = () => {
    try { notifyEnvelope.stop(); } catch { /* swallow */ }
  };

  return {
    pseudoPod,
    podRouting,
    notifyEnvelope,
    transport: effectiveTransport,
    deviceId: effectiveDeviceId,
    versionStore,
    stop,
  };
}

/**
 * Build the `{publishEnvelope, subscribeEnvelopes}` shape notify-envelope
 * expects, routing per-recipient over the agent's attached transports
 * (`agent.transportFor(addr)`) and subscribing envelope receivers on EVERY
 * named transport (relay, mdns, internal, ble, …), not just the primary.
 * (Lifted verbatim from the pinboard/tasks-v0 duplicates.)
 *
 * @param {object} agent — duck-typed core Agent.
 */
export function createAgentTransportAdapter(agent) {
  return {
    async publishEnvelope({ recipients, ...env } = {}) {
      if (!Array.isArray(recipients) || recipients.length === 0) return;
      if (typeof env.kind !== 'string' || env.kind.length === 0) {
        throw Object.assign(
          new Error('publishEnvelope: `kind` is required'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      const wire = {
        v: 1,
        kind: env.kind,
        timestamp: env.timestamp ?? new Date().toISOString(),
        ...(env.ref          !== undefined ? { ref: env.ref } : {}),
        ...(env.etag         !== undefined ? { etag: env.etag } : {}),
        ...(typeof env._v === 'number'    ? { _v: env._v } : {}),
        ...(env.fromActor    !== undefined ? { fromActor: env.fromActor } : {}),
        ...(env.payload      !== undefined ? { payload: env.payload } : {}),
      };
      const topic = `envelope:${env.kind}`;
      await Promise.all(recipients.map(async (to) => {
        try {
          const t = await agent.transportFor(to);
          await t.publishOneWay(to, topic, wire);
        } catch (_err) {
          // best-effort fan-out (parity with offeringMatch.broadcast)
        }
      }));
    },
    subscribeEnvelopes(callback) {
      const offs = [];
      const names = (typeof agent.transportNames === 'object' && agent.transportNames)
        ? agent.transportNames
        : [];
      for (const name of names) {
        const t = agent.getTransport?.(name);
        if (typeof t?.subscribeEnvelopes === 'function') {
          try { offs.push(t.subscribeEnvelopes(callback)); }
          catch { /* swallow */ }
        }
      }
      return () => {
        for (const off of offs) {
          try { off(); } catch { /* swallow */ }
        }
      };
    },
  };
}
