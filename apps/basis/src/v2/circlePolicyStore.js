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
import { storageName } from './storageRegister.js';   // every storage name from the one register
import { localStorageObjectVersions } from '@onderling/kring-host/objectVersionsStorage';
import { sealedKeyValue, jsonKv } from './localStoreSeal.js';
import {
  normalizeCirclePolicy, mergeCirclePolicy,
  normalizeMemberOverride, mergeMemberOverride,
} from './circlePolicy.js';
import { withDerivedChatFeature, noteCirclePolicy } from './conversationKinds.js';
import { processRefusalLog } from './refusalLog.js';

const inMemoryByMarks = new WeakMap();   // marks backend → its in-memory marks (one per device storage)
/**
 * WHAT WAS BUILT FROM A CIRCLE'S POLICY GOES WHEN ITS POD OR POSTURE CHANGES. A circle's pod producer and its seal
 * strategy are built from the policy (where the data lives, whether it is sealed) and kept per circle; a policy write
 * that changes either must drop them, or a producer built on half a policy (a `pod` still at its default) outlives the
 * real one. Every policy store announces such a change here (whichever path wrote it: the lane, a settings save, a
 * restore), once per process; each shell's producer cache subscribes once (`onPolicyPostureChange`).
 */
const postureListeners = new Set();
export function onPolicyPostureChange(fn) {
  if (typeof fn !== 'function') return () => {};
  postureListeners.add(fn);
  return () => { postureListeners.delete(fn); };
}
const postureOf = (p) => `${p?.pod ?? 'none'}|${p?.storagePosture ?? 'p0'}`;
function announcePostureChange(circleId, before, after, force = false) {
  if (!force && postureOf(before) === postureOf(after)) return;
  for (const fn of postureListeners) { try { fn(circleId); } catch { /* a listener's fault is its own */ } }
}

export function createCirclePolicyStore({ load, save, versions, marks = null, onMarkNotWritten = null } = {}) {
  // THE POLICY OF A JOINED CIRCLE IS NOT KNOWN UNTIL IT ARRIVED. A read with no record answers the defaults (p0, a
  // plaintext circle), which is right for a circle this device created and wrong for one it JOINED: until the founder's
  // policy reached it, a joiner held a sealed circle as p0 and its first noticeboard post went out in the clear
  // (2026-11-14). `marks` (device-local, never the pod) holds a PENDING mark from the join until the policy arrives;
  // while it stands `get` says so (`policyPending: true`), and every posture reader treats that as not known.
  // FAILS CLOSED: a mark that cannot be READ counts as pending (a storage error never makes a joined circle plaintext),
  // and what this run marked or cleared is held in memory as well, so a mark that could not be WRITTEN still holds.
  // circleId → pending (true/false), this run; SHARED by every store over the same marks backend: the phone builds
  // several policy stores (the lane's, the mark's, the launcher's), and a mark held only by the store that set it was
  // missed by the others when its write failed
  const inMemory = marks ? (inMemoryByMarks.get(marks) ?? inMemoryByMarks.set(marks, new Map()).get(marks)) : new Map();
  const pendingOf = async (circleId) => {
    if (!marks) return false;
    if (inMemory.has(circleId)) return inMemory.get(circleId);
    try { return (await marks.load(circleId))?.pending === true; } catch { return true; }
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
      const out = (await pendingOf(circleId)) ? { ...policy, policyPending: true } : policy;
      noteCirclePolicy(circleId, out);   // what the conversation shows, for every reader of an arrived line
      return out;
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
      if (inMemory.get(circleId) === false) return;
      let stored; let unreadable = false;
      try { stored = await marks.load(circleId); } catch { unreadable = true; }
      if (!unreadable && stored?.pending === false) { inMemory.set(circleId, false); return; }
      if (!unreadable && stored == null) {
        let raw = null;
        try { raw = load ? await load(circleId) : null; } catch { raw = null; }
        if (raw && typeof raw === 'object' && typeof raw.storagePosture === 'string') {
          inMemory.set(circleId, false);
          try { await marks.save(circleId, { pending: false }); } catch { /* the record still says it on the next start */ }
          return;
        }
      }
      inMemory.set(circleId, true);
      // not written: said, and the circle stays not-known for this run (the mark in memory)
      try { await marks.save(circleId, { pending: true }); } catch (err) { try { said(err?.message ?? String(err)); } catch { /* a report never breaks the join */ } }
    },
    async update(circleId, patch, { seen = false } = {}) {
      const { policyPending: pendingNow, ...current } = await this.get(circleId);
      const next = mergeCirclePolicy(current, patch);
      // a write made while the circle's policy is NOT KNOWN (a joiner's own toggle) stores no posture of its own unless
      // it names one: the record must never pass for the arrived policy (see `markPending`); a read still answers the
      // defaults' posture, and the pending mark says it is not known
      const toSave = (pendingNow === true && !seen && !Object.prototype.hasOwnProperty.call(patch ?? {}, 'storagePosture'))
        ? (({ storagePosture: _sp, ...rest }) => rest)(next)
        : next;
      // γ.2 — capture BEFORE save.  Capture failures must not break the
      // write; the adapter swallows internally but defensive try here
      // in case of a malformed external adapter.
      if (versions && typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* capture is best-effort */ }
      }
      if (save) await save(circleId, toSave);
      noteCirclePolicy(circleId, (pendingNow === true && !seen) ? { ...next, policyPending: true } : next);
      // the circle's own policy arrived (the policy lane, the join's reply): its posture is known from here on
      if (seen && marks) {
        inMemory.set(circleId, false);
        try { await marks.save(circleId, { pending: false }); } catch { /* the run knows it; the next start reads the store */ }
      }
      // where or how the circle keeps its data changed (or a pending policy became known): what was built goes
      announcePostureChange(circleId, current, next, seen && pendingNow === true);
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
      let before = null;
      try { before = load ? normalizeCirclePolicy(await load(circleId)) : null; } catch { before = null; }
      const next = normalizeCirclePolicy(restored);
      if (typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* capture is best-effort */ }
      }
      if (save) await save(circleId, next);
      announcePostureChange(circleId, before, next);
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
  return createCirclePolicyStore({ ...localStoragePolicyIo(sealed), versions: localStorageObjectVersions('policy', sealed, undefined, { versionsPrefix: storageName('objectVersionKeys') }), marks: localPolicyPendingMarks(storage) });
}

/**
 * The device-local 'policy pending' marks (key `basis.circlePolicyPending.<circleId>`): never the pod. Errors are NOT
 * swallowed here: the store fails closed on them (an unreadable mark is pending; an unwritten one is said and held).
 * @param {{getItem: Function, setItem: Function}} storage  localStorage, AsyncStorage or the box's file store
 */
// one marks backend per storage, so every policy store over the same storage shares the in-memory hold above
const marksByStorage = new WeakMap();
export function localPolicyPendingMarks(storage = globalThis.localStorage) {
  if (storage && typeof storage === 'object' && marksByStorage.has(storage)) return marksByStorage.get(storage);
  const key = (id) => `${storageName('circlePolicyPending')}${id}`;
  const kv = storage ? jsonKv(storage, { name: 'the policy pending marks', kind: 'settings' }) : null;
  const marks = {
    load: async (id) => { if (!storage) throw new Error('no storage'); return kv.getJson(key(id)); },   // not JSON = kept + refused + said
    save: async (id, value) => { if (!storage) throw new Error('no storage'); await kv.setItem(key(id), JSON.stringify(value)); },
  };
  if (storage && typeof storage === 'object') marksByStorage.set(storage, marks);
  return marks;
}

/** localStorage-backed load/save (web). Key: `basis.circlePolicy.<circleId>`. */
export function localStoragePolicyIo(storage) {   // no default: a raw localStorage would write the policy plain
  const key = (id) => `${storageName('circlePolicy')}${id}`;
  const kv = storage ? jsonKv(storage, { name: 'the circle policy', kind: 'settings' }) : null;
  return {
    load: async (id) => {
      // awaited: a file-backed store (the box) answers async; not JSON = kept + refused + said
      try { return kv ? await kv.getJson(key(id)) : null; } catch { return null; }
    },
    save: async (id, policy) => {
      try { await kv?.setItem(key(id), JSON.stringify(policy)); } catch { /* ignore: quota, no content key yet, or a kept value */ }
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

/** localStorage-backed load/save for member overrides. Key: `basis.circleOverride.<circleId>`. */
export function localStorageOverrideIo(storage = globalThis.localStorage) {
  // SEALED at rest (ledger L1083: per-member overrides), on web and phone alike
  const kv = sealedKeyValue(storage, { name: 'the member overrides', kind: 'settings', strict: true, said: true, resealAtStart: [storageName('circleOverride')] });
  const key = (id) => `${storageName('circleOverride')}${id}`;
  return {
    load: async (id) => {
      try { return await kv.getJson(key(id)); } catch { return null; }   // not JSON = kept + refused + said
    },
    save: async (id, override) => {
      try { await kv.setItem(key(id), JSON.stringify(override)); } catch { /* ignore: quota, or no content key yet */ }
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
