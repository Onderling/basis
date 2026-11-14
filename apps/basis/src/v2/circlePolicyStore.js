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
import { localStorageObjectVersions } from '@onderling/kring-host/objectVersionsStorage';
import { sealedKeyValue } from './localStoreSeal.js';
import {
  normalizeCirclePolicy, mergeCirclePolicy,
  normalizeMemberOverride, mergeMemberOverride,
} from './circlePolicy.js';
import { withDerivedChatFeature } from './conversationKinds.js';
import { processRefusalLog } from './refusalLog.js';
import { isSealedPosture } from './circlePodProducer.js';

const inMemoryByMarks = new WeakMap();   // marks backend → its in-memory marks (one per device storage)

export function createCirclePolicyStore({ load, save, versions, marks = null, onMarkNotWritten = null } = {}) {
  // THE POLICY OF A JOINED CIRCLE IS NOT KNOWN UNTIL IT ARRIVED. A read with no record answers the defaults (p0, a
  // plaintext circle), which is right for a circle this device created and wrong for one it JOINED: until the founder's
  // policy reached it, a joiner held a sealed circle as p0 and its first noticeboard post went out in the clear
  // (2026-11-14). `marks` (device-local, never the pod) holds a PENDING mark from the join until the policy arrives;
  // while it stands `get` says so (`policyPending: true`), and every posture reader treats that as not known.
  // FAILS CLOSED: a mark that cannot be READ counts as pending (a storage error never makes a joined circle plaintext),
  // and what this run marked or cleared is held in memory as well, so a mark that could not be WRITTEN still holds.
  // A pending mark may carry a SEALED posture from the join's reply (`hintSealedPosture`): a hint in the safe direction
  // only. While it stands the posture reads as known (sealed), every other field as before, and the lane's signed
  // policy still clears the mark and overrides it.
  // circleId → the mark this run: { pending, sealedPosture? }; SHARED by every store over the same marks backend
  const inMemory = marks ? (inMemoryByMarks.get(marks) ?? inMemoryByMarks.set(marks, new Map()).get(marks)) : new Map();
  const markOf = async (circleId) => {
    if (!marks) return { pending: false };
    if (inMemory.has(circleId)) return inMemory.get(circleId);
    try {
      const m = await marks.load(circleId);
      return m?.pending === true ? { pending: true, ...(isSealedPosture(m.sealedPosture) ? { sealedPosture: m.sealedPosture } : {}) } : { pending: false };
    } catch { return { pending: true }; }
  };
  const said = typeof onMarkNotWritten === 'function'
    ? onMarkNotWritten
    : () => processRefusalLog().note({ tag: 'policy', lane: 'policy', check: 'pending-mark', reason: 'policy-mark-not-written' });
  return {
    async get(circleId) {
      let raw = null;
      try { raw = load ? await load(circleId) : null; } catch { raw = null; }
      // Decision 3 (2026-07-29) — `features.chat` is a VIEW of `conversationKinds`, not a second place to
      // store the same fact. Derived on read rather than rewritten on save, so there is one place that
      // decides it; `update` still merges the raw patch, so nothing is lost.
      const policy = withDerivedChatFeature(normalizeCirclePolicy(raw));
      const mark = await markOf(circleId);
      if (!mark.pending) return policy;
      // the join's reply said the circle seals: known sealed (only the posture; nothing else is taken from the reply)
      if (mark.sealedPosture) return { ...policy, storagePosture: mark.sealedPosture, postureFromJoinReply: true };
      return { ...policy, policyPending: true };
    },
    /**
     * The join's reply named the circle's storage posture. It is an unsigned hint from one admin's device, so it is
     * taken ONLY when it seals (p2/p3), ONLY for a circle pending here (never over a policy this device has seen), and
     * ONLY the posture. Anything else (unsealed, unknown, absent) adopts nothing: the circle stays pending, refused,
     * until the signed policy arrives. Returns whether the hint was taken.
     */
    async hintSealedPosture(circleId, posture) {
      if (!marks || !circleId || !isSealedPosture(posture)) return false;
      const mark = await markOf(circleId);
      if (!mark.pending) return false;
      const next = { pending: true, sealedPosture: posture };
      inMemory.set(circleId, next);
      try { await marks.save(circleId, next); } catch (err) { try { said(err?.message ?? String(err)); } catch { /* a report never breaks the join */ } }
      return true;
    },
    /**
     * A circle that has just ARRIVED here (a join, an own device's carry, an enrolment, a restore): its policy is not
     * known until it arrives (`update(…, { seen: true })`). The arrival step runs again for circles a device already
     * holds, so a circle whose policy this device has SEEN is never marked again (it would refuse every sealed write
     * until a statement happened to arrive again). Seen rests on: this run's knowledge; else the stored mark
     * (`pending: false`); else, when there is no mark at all (the marks store gone), the policy RECORD carrying a
     * posture: a record is written with one only when the circle was not pending (its creator's, or the arrived policy),
     * never by a write made while it was pending. A mark that cannot be read: marked (fails closed).
     */
    async markPending(circleId) {
      if (!marks || !circleId) return;
      if (inMemory.get(circleId)?.pending === false) return;
      let stored; let unreadable = false;
      try { stored = await marks.load(circleId); } catch { unreadable = true; }
      if (!unreadable && stored?.pending === false) { inMemory.set(circleId, { pending: false }); return; }
      // already pending (a hint it carries is kept: marking again never loosens, never unseals)
      if (!unreadable && stored?.pending === true) { if (!inMemory.has(circleId)) inMemory.set(circleId, await markOf(circleId)); return; }
      if (!unreadable && stored == null) {
        let raw = null;
        try { raw = load ? await load(circleId) : null; } catch { raw = null; }
        if (raw && typeof raw === 'object' && typeof raw.storagePosture === 'string') {
          inMemory.set(circleId, { pending: false });
          try { await marks.save(circleId, { pending: false }); } catch { /* the record still says it on the next start */ }
          return;
        }
      }
      inMemory.set(circleId, { pending: true });
      // not written: said, and the circle stays not-known for this run (the mark in memory)
      try { await marks.save(circleId, { pending: true }); } catch (err) { try { said(err?.message ?? String(err)); } catch { /* a report never breaks the join */ } }
    },
    async update(circleId, patch, { seen = false } = {}) {
      const { policyPending: _pending, postureFromJoinReply: _hinted, ...current } = await this.get(circleId);
      const pendingNow = (await markOf(circleId)).pending === true;
      const next = mergeCirclePolicy(current, patch);
      // a write made while the circle's policy is NOT KNOWN (a joiner's own toggle; a reply's posture hint is not the
      // policy either) stores no posture of its own unless it names one: the record must never pass for the arrived
      // policy (see `markPending`); a read still answers the hint or the defaults, and the pending mark stands
      const toSave = (pendingNow && !seen && !Object.prototype.hasOwnProperty.call(patch ?? {}, 'storagePosture'))
        ? (({ storagePosture: _sp, ...rest }) => rest)(next)
        : next;
      // γ.2 — capture BEFORE save.  Capture failures must not break the
      // write; the adapter swallows internally but defensive try here
      // in case of a malformed external adapter.
      if (versions && typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* capture is best-effort */ }
      }
      if (save) await save(circleId, toSave);
      // the circle's own policy arrived (the policy lane, the join's reply): its posture is known from here on
      if (seen && marks) {
        inMemory.set(circleId, { pending: false });
        try { await marks.save(circleId, { pending: false }); } catch { /* the run knows it; the next start reads the store */ }
      }
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

/**
 * A device's own circle-policy store, SEALED at rest (the policy and its version snapshots) over a localStorage-shaped
 * storage — what the web shell composes. The box seals its copy too (`boxStorage.js`), mobile in `circleStoresRN.js`.
 */
export function localCirclePolicyStore(storage = globalThis.localStorage) {
  const sealed = sealedKeyValue(storage, { name: 'the circle policy' });
  return createCirclePolicyStore({ ...localStoragePolicyIo(sealed), versions: localStorageObjectVersions('policy', sealed), marks: localPolicyPendingMarks(storage) });
}

/**
 * The device-local 'policy pending' marks (key `cc.circlePolicyPending.<circleId>`): never the pod. Errors are NOT
 * swallowed here: the store fails closed on them (an unreadable mark is pending; an unwritten one is said and held).
 * @param {{getItem: Function, setItem: Function}} storage  localStorage, AsyncStorage or the box's file store
 */
// one marks backend per storage: every policy store over the same storage (the phone builds several) then shares the
// in-memory hold below, so a mark that could not be written still binds every reader on this device for the run
const marksByStorage = new WeakMap();
export function localPolicyPendingMarks(storage = globalThis.localStorage) {
  if (storage && typeof storage === 'object' && marksByStorage.has(storage)) return marksByStorage.get(storage);
  const key = (id) => `cc.circlePolicyPending.${id}`;
  const marks = {
    load: async (id) => { if (!storage) throw new Error('no storage'); const s = await storage.getItem(key(id)); return s ? JSON.parse(s) : null; },
    save: async (id, value) => { if (!storage) throw new Error('no storage'); await storage.setItem(key(id), JSON.stringify(value)); },
  };
  if (storage && typeof storage === 'object') marksByStorage.set(storage, marks);
  return marks;
}

/** localStorage-backed load/save (web). Key: `cc.circlePolicy.<circleId>`. */
export function localStoragePolicyIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circlePolicy.${id}`;
  return {
    load: async (id) => {
      try {
        const s = await storage?.getItem(key(id));   // awaited: a file-backed store (the box) answers async
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, policy) => {
      try { await storage?.setItem(key(id), JSON.stringify(policy)); } catch { /* ignore: quota, or no content key yet */ }
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
