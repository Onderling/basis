/**
 * basis v2 — ε.4: negotiated peer catch-up protocol (substrate).
 *
 * The legacy peer-poll path (ε.3's `peerCatchUp` handler in
 * `core/handlers/catchUp.js`) is "I'm online, catch me up" → the
 * provider blindly streams every post since the receiver's hi-water
 * mark.  After a week of activity that's a lot of bytes moved
 * without any size signal, provider notification, or receiver choice.
 *
 * This module is the message-shape + helper substrate for the new
 * NEGOTIATED protocol:
 *
 *     receiver  ──catch-up-request──▶  provider
 *               ◀──catch-up-offer───
 *     receiver  ──catch-up-accept──▶  provider
 *               ◀──catch-up-chunk───   (× N, with seq)
 *               ◀──catch-up-end─────
 *
 * V1 simplifications baked into these helpers:
 *
 *   - One request per (groupId, sinceTs) at a time per receiver
 *     (de-dupe is the coordinator's job; the protocol just gives
 *     each request a stable `requestId`).
 *   - Receiver auto-accepts the FIRST offer in a window (no
 *     multi-offer chooser yet).
 *   - Decline is SILENT — provider doesn't reply; receiver times out.
 *   - Provider notifications are in-app only (no OS push).
 *
 * Modes (selectable by the receiver in `catch-up-accept`):
 *
 *   - `all`         — no further filter; provider serves everything
 *                     since `sinceTs` up to `maxBytes` (optional).
 *   - `last-50`     — tail 50 items.
 *   - `last-7-days` — items with `ts >= now - 7d` (within the
 *                     `sinceTs` ceiling).
 *
 * The provider applies the mode filter BEFORE chunking, so chunk
 * `seq` counts only the filtered items.
 *
 * Pure JS — no I/O, no module-level state, no DOM/RN — both surfaces
 * import the same helpers.  `makeRequestId` is the one source of
 * non-determinism (Math.random); callers in tests can pass their own
 * generator if they need a deterministic id (`requestId` is plumbed
 * through as a string, not produced here, by the coordinator).
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * Subtype constants for the five negotiated catch-up envelopes.
 * Exported so the peer-router registration in main.js / ChatScreen.js
 * doesn't sprinkle bare strings across the host code.
 */
export const CATCH_UP_SUBTYPES = Object.freeze({
  REQUEST: 'catch-up-request',
  OFFER:   'catch-up-offer',
  ACCEPT:  'catch-up-accept',
  CHUNK:   'catch-up-chunk',
  END:     'catch-up-end',
});

/**
 * The three modes a receiver can pick in `catch-up-accept`.
 * `last-7-days` uses ms-since-epoch semantics; the cutoff is computed
 * provider-side as `Date.now() - 7 * 24 * 3600 * 1000`.
 */
export const CATCH_UP_MODES = Object.freeze(['all', 'last-50', 'last-7-days']);

/**
 * Default chunk size for `catch-up-chunk`.  50 is a sweet spot: small
 * enough that one chunk fits in any NKN frame (NKN's max is ~32KB and
 * typical kring messages are < 200 bytes), big enough that a kring
 * with a week of activity (~200 msgs) ships in 4 frames.
 */
// Parameter register (#36) — per-install (scope:device), kind:internal: a wire/protocol tuning bound (NKN
// frame fit), not a user preference. `param()` returns 50 unchanged; still caller-overridable via chunkItems.
export const DEFAULT_CHUNK_SIZE = param({ key: 'catchup.chunkSize', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });

/**
 * Generate a stable request id for one catch-up exchange.  Not a
 * security token — uniqueness is local to the receiver's in-flight
 * map.  Hex string so it serializes cleanly through NKN.
 */
export function makeRequestId() {
  const r1 = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const r2 = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `cu-${Date.now().toString(16)}-${r1}${r2}`;
}

/**
 * Validate a `catch-up-request` envelope.  Returns `true` only when
 * all required fields are present and well-shaped.
 */
export function isValidRequest(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === CATCH_UP_SUBTYPES.REQUEST
    && typeof p.groupId     === 'string' && p.groupId
    && typeof p.requestId   === 'string' && p.requestId
    && typeof p.sinceTs     === 'number' && Number.isFinite(p.sinceTs)
    && typeof p.fromPeerAddr === 'string' && p.fromPeerAddr
  );
}

/**
 * Validate a `catch-up-offer` envelope.  `count` is the number of
 * items the provider would send; `sizeBytes` is the JSON byte size
 * of the items array; `lastTs` is the newest item's ts (or null if
 * count === 0 — but providers shouldn't send empty offers).
 */
export function isValidOffer(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === CATCH_UP_SUBTYPES.OFFER
    && typeof p.requestId === 'string' && p.requestId
    && typeof p.count     === 'number' && Number.isFinite(p.count) && p.count >= 0
    && typeof p.sizeBytes === 'number' && Number.isFinite(p.sizeBytes) && p.sizeBytes >= 0
    && (p.lastTs === null || (typeof p.lastTs === 'number' && Number.isFinite(p.lastTs)))
  );
}

/**
 * Validate a `catch-up-accept` envelope.  `maxBytes` is optional.
 */
export function isValidAccept(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === CATCH_UP_SUBTYPES.ACCEPT
    && typeof p.requestId === 'string' && p.requestId
    && typeof p.mode      === 'string' && CATCH_UP_MODES.includes(p.mode)
    && (p.maxBytes === undefined
        || (typeof p.maxBytes === 'number' && Number.isFinite(p.maxBytes) && p.maxBytes > 0))
  );
}

/**
 * Validate a `catch-up-chunk` envelope.  `items` must be an array;
 * each item is a chat envelope but the validator doesn't recurse
 * into it (that's the inbox's job).  `seq` is the 0-based chunk
 * index; `finished` is true on the last data-bearing chunk (the
 * `catch-up-end` envelope still follows for accounting).
 */
export function isValidChunk(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === CATCH_UP_SUBTYPES.CHUNK
    && typeof p.requestId === 'string' && p.requestId
    && typeof p.seq       === 'number' && Number.isFinite(p.seq) && p.seq >= 0
    && Array.isArray(p.items)
    && typeof p.finished  === 'boolean'
  );
}

/**
 * Validate a `catch-up-end` envelope.  `totalSent` is the cumulative
 * item count across all chunks for this requestId.
 */
export function isValidEnd(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === CATCH_UP_SUBTYPES.END
    && typeof p.requestId === 'string' && p.requestId
    && typeof p.totalSent === 'number' && Number.isFinite(p.totalSent) && p.totalSent >= 0
  );
}

/**
 * Compute the UTF-8 byte length of `JSON.stringify(items)`.  Used
 * for the `sizeBytes` field in offers so the receiver can make an
 * informed accept/decline.
 *
 * Browser-safe: TextEncoder is part of the Web API.  Node has it
 * globally since v11 too.  Falls back to `Buffer.byteLength` when
 * neither is available (extremely defensive).
 */
export function jsonByteLength(items) {
  const s = JSON.stringify(items ?? []);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(s, 'utf-8');
  }
  // Last-resort approximation: char count.  Should never hit this in
  // practice (every supported runtime has TextEncoder).
  return s.length;
}

/**
 * Compute an offer preview from a list of items.  Cheap O(N) scan;
 * the provider calls this AFTER applying the mode filter (or on the
 * full set if it's offering 'all').
 *
 * @param {Array<{ts?: number}>} items
 * @param {number} sinceTs — only used to widen the offer when items
 *   is empty (the lastTs falls back to sinceTs so the receiver can
 *   still advance its high-water mark).  When items is non-empty it
 *   doesn't affect the result.
 * @returns {{count: number, sizeBytes: number, lastTs: number|null}}
 */
export function computeOfferFromItems(items, sinceTs) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) {
    return { count: 0, sizeBytes: 0, lastTs: null };
  }
  let lastTs = -Infinity;
  for (const it of arr) {
    const t = it?.ts;
    if (typeof t === 'number' && Number.isFinite(t) && t > lastTs) lastTs = t;
  }
  // sinceTs unused here when items have ts — but the parameter is
  // kept on the signature so callers can pass it through uniformly
  // (some providers compute the offer from a synthesized count
  // without per-item timestamps).
  if (lastTs === -Infinity) lastTs = Number.isFinite(sinceTs) ? sinceTs : null;
  return {
    count:     arr.length,
    sizeBytes: jsonByteLength(arr),
    lastTs,
  };
}

/**
 * Apply the receiver's mode choice to the provider's full item set.
 * Pure: doesn't mutate the input array.
 *
 *   - `all`         → returns the input as-is.
 *   - `last-50`     → tail 50 (uses `opts.tailSize` if supplied).
 *   - `last-7-days` → filter by ts >= now - 7d (uses `opts.now` for
 *                     determinism in tests).
 *
 * Unknown modes fall through to `all` (forward-compat — better to
 * over-send than to silently drop).
 *
 * @param {Array<{ts?: number}>} items
 * @param {'all'|'last-50'|'last-7-days'|string} mode
 * @param {{now?: number, tailSize?: number, sevenDaysMs?: number}} [opts]
 */
export function applyModeFilter(items, mode, opts = {}) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return arr.slice();
  switch (mode) {
    case 'last-50': {
      const n = Number.isFinite(opts.tailSize) ? opts.tailSize : 50;
      return arr.length > n ? arr.slice(arr.length - n) : arr.slice();
    }
    case 'last-7-days': {
      const now = Number.isFinite(opts.now) ? opts.now : Date.now();
      const window = Number.isFinite(opts.sevenDaysMs) ? opts.sevenDaysMs : 7 * 24 * 3600 * 1000;
      const cutoff = now - window;
      return arr.filter((it) => {
        const t = it?.ts;
        return typeof t === 'number' && Number.isFinite(t) && t >= cutoff;
      });
    }
    case 'all':
    default:
      return arr.slice();
  }
}

/**
 * Split a flat items array into chunks of `chunkSize` (default 50).
 * Returns `[]` for an empty input — callers can `if (chunks.length
 * === 0)` to decide whether to send a `catch-up-end` with
 * totalSent: 0 (yes — keeps the protocol explicit).
 */
export function chunkItems(items, chunkSize = DEFAULT_CHUNK_SIZE) {
  const arr = Array.isArray(items) ? items : [];
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_CHUNK_SIZE;
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Build a `catch-up-request` envelope.  Convenience helper so
 * callers don't have to spell the subtype string.
 */
export function buildRequest({ groupId, sinceTs, requestId, fromPeerAddr, msgId, ts }) {
  return {
    subtype:   CATCH_UP_SUBTYPES.REQUEST,
    msgId:     msgId ?? requestId,
    ts:        Number.isFinite(ts) ? ts : Date.now(),
    groupId,
    sinceTs:   Number.isFinite(sinceTs) ? sinceTs : 0,
    requestId,
    fromPeerAddr,
  };
}

/** Build a `catch-up-offer` envelope. */
export function buildOffer({ requestId, count, sizeBytes, lastTs, msgId, ts }) {
  return {
    subtype:   CATCH_UP_SUBTYPES.OFFER,
    msgId:     msgId ?? `${requestId}-offer`,
    ts:        Number.isFinite(ts) ? ts : Date.now(),
    requestId,
    count,
    sizeBytes,
    lastTs:    lastTs ?? null,
  };
}

/** Build a `catch-up-accept` envelope. */
export function buildAccept({ requestId, mode, maxBytes, msgId, ts }) {
  const e = {
    subtype:   CATCH_UP_SUBTYPES.ACCEPT,
    msgId:     msgId ?? `${requestId}-accept`,
    ts:        Number.isFinite(ts) ? ts : Date.now(),
    requestId,
    mode,
  };
  if (Number.isFinite(maxBytes) && maxBytes > 0) e.maxBytes = maxBytes;
  return e;
}

/** Build a `catch-up-chunk` envelope. */
export function buildChunk({ requestId, seq, items, finished, msgId, ts }) {
  return {
    subtype:   CATCH_UP_SUBTYPES.CHUNK,
    msgId:     msgId ?? `${requestId}-chunk-${seq}`,
    ts:        Number.isFinite(ts) ? ts : Date.now(),
    requestId,
    seq,
    items:     Array.isArray(items) ? items : [],
    finished:  !!finished,
  };
}

/** Build a `catch-up-end` envelope. */
export function buildEnd({ requestId, totalSent, msgId, ts }) {
  return {
    subtype:   CATCH_UP_SUBTYPES.END,
    msgId:     msgId ?? `${requestId}-end`,
    ts:        Number.isFinite(ts) ? ts : Date.now(),
    requestId,
    totalSent,
  };
}
