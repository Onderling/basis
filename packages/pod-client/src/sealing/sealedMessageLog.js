// sealedMessageLog.js — a per-message, range-queryable, SEALED circle log over the blind
// `StorageBackend` port (@onderling/core). The connectivity Phase-3 shared-pod primitive: it is the ONE
// place that owns the message-row KEY CONVENTION so the WRITE side (stoop `broadcastToCircle`'s podWrite
// seam) and the READ side (the shells' pod chat catch-up + the receiver's ref resolution)
// can never drift on how a circle's chat history is laid out at rest.
//
// It invents NO crypto and NO new sealing scheme. Sealing is applied ABOVE the store exactly as the port
// documents: the caller passes a `{ seal, open }` string↔string strategy (the one `resolveCircleStorage`
// already returns — group-key for p2, recipient-wrap for p3, or `null` for a plaintext p0/p1 store), and
// this module seals the canonical message JSON with it before `put` and opens it after `get`. The store
// only ever moves opaque ciphertext; the seal — not the store — is the access gate.
//
// KEY CONVENTION (the range-queryable row layout, per DESIGN-connectivity-phase2-deliver §2 "circleId + ts
// + msgId"):
//
//     <circleId>/<paddedTs>-<msgId>
//
// `paddedTs` is the message ts zero-padded to a fixed width so a lexicographic `list(prefix)` walk is also
// chronological — a range query "messages since ts" is `list('<circleId>/')` then a numeric ts filter, with
// no store-side query language needed (the port only offers put/get/list). The `<circleId>/` prefix scopes
// the walk to one circle; the `-<msgId>` suffix keeps two messages minted in the same millisecond distinct.

/**
 * Fixed width for the zero-padded ms-epoch timestamp in a row key. 16 digits covers every valid ECMAScript
 * time value (max ±8.64e15 ms → 16 digits), so lexicographic key order == chronological order for all real
 * timestamps.
 */
const TS_PAD = 16;

/** The canonical message fields carried at rest (a projection of the wire/inbox chat envelope). */
function canonicalMessage(env) {
  const out = {
    subtype:   env.subtype ?? 'circle-chat-message',
    circleId:  env.circleId,
    msgId:     env.msgId,
    ts:        env.ts,
    text:      env.text,
    fromActor: env.fromActor ?? null,
  };
  if (env.fromWebid != null) out.fromWebid = env.fromWebid;
  if (env.media && typeof env.media === 'object' && !Array.isArray(env.media)) out.media = env.media;
  // The chat re-root: a pod row may carry the SIGNED STATEMENT (`event` = the chained, per-circle-key
  // signed message) — the pod stays transport, never authority: the reader verifies the statement at its
  // rail exactly like a fanned one, so a pod cannot inject what a peer could not.
  if (env.event && typeof env.event === 'object' && !Array.isArray(env.event)) out.event = env.event;
  return out;
}

/**
 * The range-queryable row key for one message. Pure — the ONE definition of the layout both sides read.
 * @param {string} circleId
 * @param {number} ts        ms epoch
 * @param {string} msgId
 * @returns {string} `<circleId>/<paddedTs>-<msgId>`
 */
export function messageRef(circleId, ts, msgId) {
  const t = Number.isFinite(ts) ? Math.max(0, Math.floor(ts)) : 0;
  return `${circleId}/${String(t).padStart(TS_PAD, '0')}-${msgId}`;
}

/** Recover the ts a `messageRef` encodes (for the range filter on `list`). NaN when the key isn't ours. */
export function tsFromRef(ref) {
  const slash = String(ref).indexOf('/');
  if (slash < 0) return NaN;
  const tail = String(ref).slice(slash + 1);
  const dash = tail.indexOf('-');
  const tsStr = dash < 0 ? tail : tail.slice(0, dash);
  const n = Number(tsStr);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * SEAL + PUT one message row. `seal` is a `(plaintext:string)=>ciphertext:string` closure (the
 * `resolveCircleStorage` strategy's `seal`), or `null`/absent for a plaintext (p0/p1) store. Returns the
 * row `ref` — the opaque pointer a `pod-signal` fan carries in its `toWireRefEnvelope`.
 *
 * @param {import('@onderling/core').StorageBackend} backend
 * @param {((text:string)=>string)|null} seal
 * @param {{circleId:string, msgId:string, ts:number}} envelope  the wire/inbox chat envelope
 * @returns {Promise<string>} the stored ref
 */
export async function writeSealedMessage(backend, seal, envelope) {
  if (!backend || typeof backend.put !== 'function') throw new Error('writeSealedMessage: a StorageBackend is required');
  const { circleId, msgId, ts } = envelope || {};
  if (typeof circleId !== 'string' || !circleId) throw new Error('writeSealedMessage: circleId required');
  if (typeof msgId    !== 'string' || !msgId)    throw new Error('writeSealedMessage: msgId required');
  if (!Number.isFinite(ts))                      throw new Error('writeSealedMessage: finite ts required');
  const ref  = messageRef(circleId, ts, msgId);
  const body = JSON.stringify(canonicalMessage(envelope));
  const stored = typeof seal === 'function' ? seal(body) : body;
  await backend.put(ref, String(stored));
  return ref;
}

/**
 * GET + OPEN one message row by its `ref`. `open` is the `resolveCircleStorage` strategy's `open`
 * (`(ciphertext:string)=>plaintext:string`; plaintext passes through unchanged), or `null` for a plaintext
 * store. Returns the canonical message envelope, or `null` when the ref is absent. Throws only on a
 * corrupt/unopenable body (a caller in a receive loop should catch + skip).
 *
 * @param {import('@onderling/core').StorageBackend} backend
 * @param {((text:string)=>string)|null} open
 * @param {string} ref
 * @returns {Promise<object|null>}
 */
export async function readSealedMessage(backend, open, ref) {
  if (!backend || typeof backend.get !== 'function') throw new Error('readSealedMessage: a StorageBackend is required');
  const stored = await backend.get(ref);
  if (stored == null) return null;
  const body = typeof open === 'function' ? open(String(stored)) : String(stored);
  return JSON.parse(body);
}

/**
 * Range-query a circle's rows for every message with `ts >= sinceTs`, opened + returned oldest→newest and
 * capped to `max`. This is the read half of the KEY CONVENTION: a single `list('<circleId>/')` prefix walk
 * + a numeric ts filter, no store query language. A row that fails to open (wrong-key / corrupt) is SKIPPED,
 * not thrown — one bad row must not sink a whole catch-up batch.
 *
 * @param {import('@onderling/core').StorageBackend} backend
 * @param {((text:string)=>string)|null} open
 * @param {{circleId:string, sinceTs?:number, max?:number}} q
 * @returns {Promise<{items:object[], truncated:boolean}>}
 */
export async function readSealedMessagesSince(backend, open, { circleId, sinceTs = 0, max = 200 } = {}) {
  if (!backend || typeof backend.list !== 'function') throw new Error('readSealedMessagesSince: a StorageBackend is required');
  if (typeof circleId !== 'string' || !circleId) return { items: [], truncated: false };
  const cap = Math.max(1, Math.min(Number.isFinite(max) ? max : 200, 1000));
  const since = Number.isFinite(sinceTs) ? sinceTs : 0;

  const refs = await backend.list(`${circleId}/`);
  const rows = [];
  for (const ref of refs) {
    const ts = tsFromRef(ref);
    if (Number.isFinite(ts) && ts < since) continue;   // cheap key-only prune before the get/open
    try {
      const msg = await readSealedMessage(backend, open, ref);
      if (msg && Number.isFinite(msg.ts) && msg.ts >= since) rows.push(msg);
    } catch {
      // a wrong-key / corrupt row — skip it, keep the batch coherent
    }
  }
  rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const truncated = rows.length > cap;
  const items = truncated ? rows.slice(rows.length - cap) : rows;   // keep the freshest N
  return { items, truncated };
}
