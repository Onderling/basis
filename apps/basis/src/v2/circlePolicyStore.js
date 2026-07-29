/**
 * basis v2 — circle policy persistence (shared, F2).
 *
 * Injectable `load`/`save` so the host wires the backend: web uses
 * localStorage today; pod `shared.json` (cross-app-settings convention)
 * swaps in later without touching callers. Normalises on read, deep-
 * merges edits onto the current value before saving.
 *
 * γ.2 (Phase 9) — optional `versions` adapter snapshots each save into
 * a per-circle history slot ABOVE the storage tier (so capture happens
 * whether the eventual write lands in localStorage, AsyncStorage, or
 * the pod).  The adapter is purely additive: callers that don't pass
 * one keep the pre-γ.2 behaviour bit-for-bit.
 *
 *   versions = {
 *     capture(circleId, value) → Promise<void>   // snapshot before save
 *     list(circleId)           → Promise<entries[]>
 *     restore(circleId, ts)    → Promise<value|null>  // optional (@onderling/versioning consolidation)
 *   }
 */
import {
  normalizeCirclePolicy, mergeCirclePolicy,
  normalizeMemberOverride, mergeMemberOverride,
} from './circlePolicy.js';
import { withDerivedChatFeature } from './conversationKinds.js';

export function createCirclePolicyStore({ load, save, versions } = {}) {
  return {
    async get(circleId) {
      let raw = null;
      try { raw = load ? await load(circleId) : null; } catch { raw = null; }
      // Decision 3 (2026-07-29) — `features.chat` is a VIEW of `conversationKinds`, not a second place to
      // store the same fact. Derived on read rather than rewritten on save, so there is one place that
      // decides it; `update` still merges the raw patch, so nothing is lost.
      return withDerivedChatFeature(normalizeCirclePolicy(raw));
    },
    async update(circleId, patch) {
      const current = await this.get(circleId);
      const next = mergeCirclePolicy(current, patch);
      // γ.2 — capture BEFORE save.  Capture failures must not break the
      // write; the adapter swallows internally but defensive try here
      // in case of a malformed external adapter.
      if (versions && typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* capture is best-effort */ }
      }
      if (save) await save(circleId, next);
      return next;
    },
    /** γ.2 — newest-first history; `[]` when no adapter or no history. */
    async listVersions(circleId) {
      if (!versions || typeof versions.list !== 'function') return [];
      try { return await versions.list(circleId); } catch { return []; }
    },
    /**
     * Restore the policy snapshotted at `ts` (a `ts` from `listVersions`).
     * The adapter only READS history; this store persists the restored
     * value through its normal capture+save path, so the restore both
     * lands in live storage and appears in history (undoable — the
     * pre-restore newest entry stays listed). Returns the persisted
     * (normalised, wholesale-replaced — not merged) policy, or `null`
     * when no adapter / no such snapshot.
     */
    async restoreVersion(circleId, ts) {
      if (!versions || typeof versions.restore !== 'function') return null;
      let restored = null;
      try { restored = await versions.restore(circleId, ts); } catch { restored = null; }
      if (restored == null) return null;
      const next = normalizeCirclePolicy(restored);
      if (typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* capture is best-effort */ }
      }
      if (save) await save(circleId, next);
      return next;
    },
  };
}

/** localStorage-backed load/save (web). Key: `cc.circlePolicy.<circleId>`. */
export function localStoragePolicyIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circlePolicy.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, policy) => {
      try { storage?.setItem(key(id), JSON.stringify(policy)); } catch { /* ignore */ }
    },
  };
}

/**
 * The calling member's personal override for a circle. Same
 * injectable shape as the policy store; keyed by circleId since the store
 * holds the local user's own override. (Cross-member overrides live in
 * each member's space; this is the local-user slice.)
 */
export function createMemberOverrideStore({ load, save } = {}) {
  return {
    async get(circleId) {
      let raw = null;
      try { raw = load ? await load(circleId) : null; } catch { raw = null; }
      return normalizeMemberOverride(raw);
    },
    async update(circleId, patch) {
      const current = await this.get(circleId);
      const next = mergeMemberOverride(current, patch);
      if (save) await save(circleId, next);
      return next;
    },
  };
}

/** localStorage-backed load/save for member overrides. Key: `cc.circleOverride.<circleId>`. */
export function localStorageOverrideIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circleOverride.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, override) => {
      try { storage?.setItem(key(id), JSON.stringify(override)); } catch { /* ignore */ }
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Phase 5.4a — pod-backed circle config
 *
 * Drop-in IO that round-trips JSON through `createPodWriter`'s
 * `read(app, resource)` / `write(app, resource, body, contentType)`.
 * Both the policy and override stores accept any `{load, save}`, so
 * the pod side composes via `tieredPolicyIo` without touching callers.
 * ──────────────────────────────────────────────────────────────────── */

/** Per-circle pod resource path: `circle.<circleId>.json`. */
const podResource = (id) => `circle.${id}.json`;

/**
 * JSON IO over a `createPodWriter`-shaped writer.  `getWriter` is a
 * thunk so the host can wire the store at module-top before the Solid
 * session has restored (returns `null` while no writer is configured →
 * load/save are no-ops, the composite falls through to the local side).
 *
 * @param {object} opts
 * @param {() => object|null} opts.getWriter — thunk returning a podWriter or null
 * @param {string} [opts.app='cc-circle']    — podWriter `app` segment
 * @returns {{load: (id: string) => Promise<object|null>, save: (id: string, value: object) => Promise<void>}}
 */
export function podPolicyIo({ getWriter, app = 'cc-circle' } = {}) {
  if (typeof getWriter !== 'function') {
    throw new TypeError('podPolicyIo: getWriter thunk required');
  }
  return {
    load: async (id) => {
      const w = getWriter();
      if (!w || typeof w.read !== 'function') return null;
      try {
        const res = await w.read(app, podResource(id));
        if (!res?.ok || typeof res.body !== 'string') return null;
        return JSON.parse(res.body);
      } catch {
        return null;
      }
    },
    save: async (id, value) => {
      const w = getWriter();
      if (!w || typeof w.write !== 'function') return;
      try {
        await w.write(app, podResource(id), JSON.stringify(value), 'application/json');
      } catch {
        /* a pod-write failure must not break the local-canonical write */
      }
    },
  };
}

/**
 * Compose a local (canonical) IO with a pod (mirror) IO and enforce the
 * `pod` axis on writes.
 *
 * Reads return the local value when present; if local is empty, falls
 * through to pod and seeds local with whatever pod returns (so a member
 * joining a `pod: 'shared'` circle picks up the policy on first read).
 *
 * Writes ALWAYS persist to local (canonical).  They ADDITIONALLY mirror
 * to pod only when `shouldMirror(value)` returns truthy — the default
 * mirrors any non-`'none'` `value.pod`, so a circle whose policy says
 * "share" actually publishes, and a private circle stays local.
 *
 * Failures on either side are swallowed: local is best-effort
 * (storage may be unavailable), pod is best-effort (offline, unauth,
 * 4xx), and the caller never sees a half-written state.
 *
 * @param {{load, save}}    localIo
 * @param {{load, save}}    podIo
 * @param {object}          [opts]
 * @param {(value: object) => boolean} [opts.shouldMirror] — default: value.pod !== 'none'
 * @returns {{load, save}}
 */
export function tieredPolicyIo(localIo, podIo, opts = {}) {
  const shouldMirror = typeof opts.shouldMirror === 'function'
    ? opts.shouldMirror
    : (value) => !!(value && value.pod && value.pod !== 'none');
  return {
    load: async (id) => {
      const localValue = await localIo.load(id);
      if (localValue != null) return localValue;
      const podValue = await podIo.load(id);
      if (podValue != null) {
        try { await localIo.save(id, podValue); } catch { /* mirror-down best-effort */ }
        return podValue;
      }
      return null;
    },
    save: async (id, value) => {
      await localIo.save(id, value);
      if (shouldMirror(value)) {
        await podIo.save(id, value);
      }
    },
  };
}
