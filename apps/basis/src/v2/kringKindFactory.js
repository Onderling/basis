/**
 * basis v2 — kring "kind" factory family (policy · rules · recipe).
 *
 * ── Why this file exists ────────────────────────────────────────────────
 * The three kring broadcast "kinds" — policy (γ-next.policy), rules
 * (γ-next.rules), recipe (γ-next.recipe) — each historically shipped their
 * own Receiver, Pending store, and Pending-storage (localStorage IO)
 * module.  Those nine files were ~pure identifier substitution
 * (policy ↔ rules ↔ recipe): the same substrate shape with a different
 * broadcast subtype, payload field, storage key-prefix, and log tag.
 * This module holds that shared shape ONCE; the per-kind modules become
 * thin instantiations driven by a small descriptor, so the triplet can't
 * silently re-diverge (CLAUDE.md invariant #3, "no duplication").
 *
 * Behaviour is preserved EXACTLY — same envelope validation, same msgId
 * LRU dedup, same on-disk key prefixes (`cc.kring<Kind>Pending.<id>`),
 * same wire subtypes.  This is a structural collapse, not a behaviour
 * change; the per-kind suites are the gate.
 *
 * ── What is NOT here ────────────────────────────────────────────────────
 * The *conflict* layer only partly collapses.  policy + rules share the
 * flat-doc shape (`makeKringFlatDocConflict`), but the RECIPE conflict
 * layer (`recipeConflict.js`) is genuinely different — it carries the
 * per-block merge regime (blocks-as-keyed-array, the 'both' keep-both
 * path with freshly-minted ids, a 'yours' default) and stays its own
 * module.  Correctness > maximal dedup.
 */

import { objectDiff } from '@onderling/sync-engine/objectDiff';

const DEFAULT_DEDUP_CAP = 256;

/* ─────────────────────────────────────────────────────────────────────── */
/* Receiver substrate — one shape for policy / rules / recipe             */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Build a kring-<kind>-broadcast peer-handler *factory* for one kind.
 *
 * The returned factory has the exact signature the three per-kind
 * receivers historically exposed (`makeKring<Kind>PeerHandler({ ... })`).
 * All that differs between kinds is the descriptor:
 *
 * @param {object} descriptor
 * @param {string} descriptor.subtype     wire subtype, e.g. 'kring-policy-broadcast'
 * @param {string} descriptor.payloadKey  envelope field holding the doc, e.g. 'policy'
 * @param {string} descriptor.logTag      log prefix, e.g. '[kring-policy]'
 * @returns {(args?: object) => (fromPeerAddr: string, payload: object) => Promise<void>}
 */
export function makeKringKindReceiver({ subtype, payloadKey, logTag }) {
  return function makeKringPeerHandler({
    pendingStore,
    dedup    = null,
    logger   = console,
    dedupCap = DEFAULT_DEDUP_CAP,
  } = {}) {
    if (!pendingStore || typeof pendingStore.set !== 'function') {
      throw new Error(`${logTag} makeKringPeerHandler: pendingStore.set required`);
    }
    const seen = dedup ?? new LruSet(dedupCap);

    return async function onKringBroadcast(fromPeerAddr, payload) {
      if (!isValidEnvelope(payload, subtype, payloadKey)) {
        logger.warn?.(`${logTag} dropping malformed envelope`, payload);
        return;
      }
      if (seen.has(payload.msgId)) {
        logger.debug?.(`${logTag} duplicate msgId, skipping`, payload.msgId);
        return;
      }
      seen.add(payload.msgId);

      try {
        await pendingStore.set(payload.circleId, payload[payloadKey]);
        logger.info?.(`${logTag} cached pending`, payload.msgId,
          'circle=' + payload.circleId);
      } catch (err) {
        logger.warn?.(`${logTag} pendingStore.set failed`, err?.message ?? err);
      }
    };
  };
}

function isValidEnvelope(p, subtype, payloadKey) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === subtype
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
    && p[payloadKey] && typeof p[payloadKey] === 'object'
  );
}

// Tiny LRU set — one shared copy for all kring kinds. Exported so any other
// per-circle broadcast receiver (e.g. the roster "pull-me" signal in
// `rosterUpdated.js`) reuses THIS dedup rather than growing a second copy.
export class LruSet {
  constructor(cap) { this.cap = cap; this.m = new Map(); }
  has(k) { return this.m.has(k); }
  add(k) {
    if (this.m.has(k)) { this.m.delete(k); this.m.set(k, 1); return; }
    this.m.set(k, 1);
    if (this.m.size > this.cap) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Pending store — one shape for policy / rules / recipe                  */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Build a per-kring pending-<kind> store from injected IO.  Stashes ONE
 * pending incoming doc per circle; the receiver writes on every valid
 * broadcast, the editor reads on mount and clears after apply/discard.
 * Identical for every kind (the doc is treated opaquely).
 *
 * @param {object} [io]
 * @param {(circleId: string) => Promise<object|null>} [io.load]
 * @param {(circleId: string, doc: object) => Promise<void>} [io.save]
 * @param {(circleId: string) => Promise<void>} [io.remove]
 * @returns {{ get: Function, set: Function, clear: Function }}
 */
export function createKringKindPendingStore({ load, save, remove } = {}) {
  return {
    async get(circleId) {
      if (typeof circleId !== 'string' || !circleId) return null;
      if (typeof load !== 'function') return null;
      try { return (await load(circleId)) ?? null; }
      catch { return null; }
    },
    async set(circleId, doc) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof save !== 'function') return;
      try { await save(circleId, doc); } catch { /* ignore */ }
    },
    async clear(circleId) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof remove !== 'function') return;
      try { await remove(circleId); } catch { /* ignore */ }
    },
  };
}

/**
 * Build localStorage IO (`load`/`save`/`remove`) for one kind's pending
 * cache, keyed `<keyPrefix><circleId>`.  `keyPrefix` is the ONLY thing
 * that differs between kinds — the on-disk key must not change.
 *
 * @param {string} keyPrefix  e.g. 'cc.kringPolicyPending.'
 * @param {Storage} [storage] window.localStorage or an injected shim
 * @returns {{ load: Function, save: Function, remove: Function }}
 */
export function makeKringKindPendingLocalIo(keyPrefix, storage = globalThis.localStorage) {
  return {
    load: async (circleId) => {
      try {
        const raw = storage?.getItem?.(keyPrefix + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, doc) => {
      try {
        storage?.setItem?.(keyPrefix + circleId, JSON.stringify(doc));
      } catch { /* quota / disabled */ }
    },
    remove: async (circleId) => {
      try {
        storage?.removeItem?.(keyPrefix + circleId);
      } catch { /* ignore */ }
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Flat-doc conflict layer — one shape for policy + rules (NOT recipe)    */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Build the detect/apply pair for a FLAT keyed conflict doc — the shared
 * shape behind `policyConflict.js` and `rulesConflict.js`.  Both are a
 * pure portable layer over `objectDiff` with NO `blocks` array, so every
 * divergence surfaces as a meta-conflict (`blockConflicts` always empty),
 * and both default missing decisions to 'theirs' (incoming wins).
 *
 * The ONE behavioural difference between the two kinds:
 *   - policy nests objects (`push:{...}`, `features:{...}`), so its apply
 *     deep-clones the incoming before overlaying picks → `deepIncoming:true`.
 *   - rules is flat, so a shallow spread suffices → `deepIncoming:false`.
 * Everything else is identical, so it lives here once.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.deepIncoming=false]  deep-clone incoming before merge
 * @returns {{ detect: Function, apply: Function }}
 */
/**
 * Decisions that resolve every AUTO-MERGEABLE difference to the side that actually changed.
 *
 * `toMerge` carries both directions — "I edited, they didn't" and "they edited, I didn't" — and they resolve
 * to OPPOSITE values. `apply()` defaults every unlisted path to `theirs`, so applying a toMerge set blindly
 * REVERTS the caller's own fresher edit whenever the divergence was local: exactly the stale-device overwrite
 * of story 6.2. Feed these decisions into `apply()` for the no-conflict fast path so each side keeps whatever
 * genuinely changed. Entries without a `side` (older diffs) fall through to the `theirs` default, unchanged.
 *
 * @param {Array<{path: string[], side?: 'local'|'incoming'}>} toMerge
 * @returns {Record<string, 'yours'|'theirs'>} decisions keyed by `path.join('.')`
 */
export function decisionsForMerges(toMerge = []) {
  const out = {};
  for (const m of Array.isArray(toMerge) ? toMerge : []) {
    if (!m || !Array.isArray(m.path) || m.path.length === 0) continue;
    if (m.side === 'local') out[m.path.join('.')] = 'yours';
    else if (m.side === 'incoming') out[m.path.join('.')] = 'theirs';
  }
  return out;
}

export function makeKringFlatDocConflict({ deepIncoming = false } = {}) {
  /**
   * Detect conflicts against `base` (3-way merge ancestor; may be null).
   * Output mirrors γ.3's `detectRecipeConflicts` with an always-empty
   * `blockConflicts`, so the shared resolver UI is reusable as-is.
   */
  function detect(local, incoming, base) {
    const { toMerge, conflicts, identical } =
      objectDiff(local || {}, incoming || {}, base ?? null);
    return {
      blockConflicts: [],
      metaConflicts:  conflicts,
      identical,
      toMerge,
    };
  }

  /**
   * Apply user-picked resolutions.  Decisions are keyed by `path.join('.')`
   * and take 'yours' | 'theirs'; missing keys default to 'theirs'.  Local
   * top-level keys absent from incoming are preserved (lossless).
   */
  function apply(local, incoming, decisions = {}) {
    const safeLocal    = local    && typeof local    === 'object' ? local    : {};
    const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};

    // Default = take incoming wholesale, then overlay locally-picked
    // 'yours' fields.  policy deep-clones so setAtPath never mutates the
    // caller's nested incoming objects; rules is flat so a shallow spread
    // is equivalent and cheaper.
    const merged = deepIncoming ? deepClone(safeIncoming) : { ...safeIncoming };

    for (const [pathKey, pick] of Object.entries(decisions || {})) {
      if (typeof pathKey !== 'string' || pathKey === '') continue;
      if (pick !== 'yours' && pick !== 'theirs') continue;
      const path = pathKey.split('.');
      if (pick === 'yours') {
        setAtPath(merged, path, getAtPath(safeLocal, path));
      } else if (pick === 'theirs') {
        setAtPath(merged, path, getAtPath(safeIncoming, path));
      }
    }

    // Preserve top-level local keys the incoming doesn't carry at all.
    for (const k of Object.keys(safeLocal)) {
      if (!(k in safeIncoming) && !(k in merged)) {
        merged[k] = safeLocal[k];
      }
    }

    return merged;
  }

  return { detect, apply };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* internals (shared by the flat-doc conflict layer)                      */
/* ─────────────────────────────────────────────────────────────────────── */

function getAtPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setAtPath(obj, path, value) {
  if (!Array.isArray(path) || path.length === 0) return;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur[seg] == null || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}

function deepClone(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
  return out;
}
