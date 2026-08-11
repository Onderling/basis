/**
 * @onderling/item-store — the ONE canonical kring chat Envelope + its
 * declared projections (the "one canonical envelope" collapse).
 *
 * A single kring chat message used to exist in THREE hand-maintained shapes
 * kept in sync by copy-paste reshapers — and that drift was the bug:
 *
 *   1. the in-memory EventLog render event
 *        `{ id, ts, app:'kring', type:'chat-message', actor, payload:{ circleId, text, kind, … } }`
 *      — built by hand in `kring-host/kringChatMessageEvent` (optimistic local append),
 *        `basis chatMessageInbox` (received append), and `basis kringChatRehydrate` (legacy insert).
 *   2. the peer fan-out WIRE envelope
 *        `{ type:'p2p-chat', subtype:'kring-chat-message', circleId, msgId, ts, text, fromActor, fromWebid, media? }`
 *      — built by hand in `stoop broadcastKringMessage`.
 *   3. the durable itemStore item's `source` (persisted by `stoop broadcastKringMessage`/`ingestKringMessage`),
 *      later RESHAPED back to the wire/inbox shape by hand in `stoop getMessagesSince`
 *      and `basis kringChatRehydrate.itemToEnvelope`.
 *
 * This module makes those shapes PROJECTIONS of one canonical Envelope so a
 * change lands in one place. Every projector is pure (no store, no I/O) and
 * is proven byte-identical to what its producer emitted before (see the
 * round-trip tests in `test/chatEnvelope.test.js`).
 *
 * Canonical Envelope:
 *   { id, circleId, author, kind, ts, hashPrev?, body?, ref?, extras? }
 *     id       = msgId
 *     author   = the sender ("fromActor" / "fromWebid")
 *     kind     = the message subtype (kring chat → 'kring-chat-message')
 *     body     = the text
 *     extras   = everything else a projection may carry (media, senderDisplay,
 *                fromWebid/fromPubKey/fromPeerAddr, and the LOCAL-ONLY
 *                presentation fields buttons/scope/embeds/review/provenance/
 *                consent that must NEVER ride the wire).
 *
 * Placement (CLAUDE.md invariant 5): this lives in `@onderling/item-store`
 * — the ONE substrate every producer/consumer of these shapes already
 * depends on (stoop, basis, basis-mobile via basis, kring-host). The
 * projections are the item-store's own concern: `chatEnvelopeFromStoreItem`
 * is a `fromItem`, `toEventLogItem` is an item projection, and `toWireEnvelope`
 * is a pure function with no other dep. No new package, no Metro/EAS
 * node_modules plumbing.
 */

/** The kring chat message subtype/kind. */
export const KRING_CHAT_KIND = 'kring-chat-message';

/**
 * `fromItem` — project a durable itemStore `kring-chat-message` item onto the
 * WIRE/inbox chat envelope shape that `chatMessageInbox.ingestChatMessage`
 * consumes:  `{ subtype, circleId, msgId, ts, text, fromActor, media? }`.
 *
 * This replaces the two hand-maintained reshapers that read a stored item's
 * `source` and re-emit the envelope — `stoop getMessagesSince`'s `.map(...)`
 * and `basis kringChatRehydrate.itemToEnvelope`. They differ only in their
 * leniency toward malformed items, expressed here as one explicit flag rather
 * than as two silently-drifting copies:
 *
 *   - `lenient: true`  (getMessagesSince) — the caller has already filtered by
 *     `source.circleId === groupId` and finite `ts`, so missing `msgId`/`text`
 *     fall back (`msgId → item.id`, `text → ''`, `circleId → groupId`) and the
 *     projector never returns null.
 *   - `lenient: false` (rehydrator, default) — a strict projector: an item
 *     missing `msgId` / `circleId` / `text` yields `null` so the caller counts
 *     it as skipped.
 *
 * @param {{id?:string, text?:string, source?:object}} item
 * @param {{groupId?:string|null, lenient?:boolean}} [opts]
 * @returns {{subtype:string, circleId:string, msgId:string, ts:number, text:string, fromActor:(string|null), media?:object} | null}
 */
export function chatEnvelopeFromStoreItem(item, { groupId = null, lenient = false } = {}) {
  const src = item?.source && typeof item.source === 'object' ? item.source : null;
  if (!src) return null;

  if (lenient) {
    const circleId = src.circleId ?? groupId;
    const msgId    = src.msgId ?? item?.id;
    const ts       = src.ts;
    const text     = item?.text ?? '';
    const fromActor = src.fromActor ?? src.fromWebid ?? null;
    const media = isMediaObject(src.media) ? src.media : null;
    return {
      subtype: KRING_CHAT_KIND,
      circleId,
      msgId,
      ts,
      text,
      fromActor,
      ...(media ? { media } : {}),
    };
  }

  // Strict: the rehydrator contract — skip items that can't form a valid envelope.
  const msgId    = src.msgId;
  const circleId = src.circleId;
  const text     = item?.text;
  const ts       = typeof src.ts === 'number' && Number.isFinite(src.ts) ? src.ts : Date.now();
  if (typeof msgId    !== 'string' || !msgId)    return null;
  if (typeof circleId !== 'string' || !circleId) return null;
  if (typeof text     !== 'string' || !text)     return null;
  const media = isMediaObject(src.media) ? src.media : null;
  return {
    subtype: KRING_CHAT_KIND,
    circleId,
    msgId,
    ts,
    text,
    fromActor: src.fromActor ?? src.fromWebid ?? null,
    ...(media ? { media } : {}),
  };
}

/**
 * `toItem` (render item) — project the canonical fields onto the in-memory
 * EventLog render event. This is the ONE builder behind all three former
 * hand-copies:
 *
 *   - the optimistic local append (`kring-host kringChatMessageEvent`) — passes
 *     the LOCAL-ONLY presentation fields (buttons/scope/embeds/review/
 *     provenance/consent) and NO `senderDisplay`;
 *   - the received append (`basis chatMessageInbox`) — passes `senderDisplay`
 *     + an already-guarded `media`;
 *   - the rehydrate legacy append (`basis kringChatRehydrate`) — passes only
 *     `senderDisplay`.
 *
 * The optional keys are appended in the SAME order and under the SAME
 * presence conditions the originals used, so every caller's event is
 * byte-identical to before. `senderDisplay` sits right after `kind`
 * (matching the received/legacy layout); the presentation fields follow
 * (matching the optimistic layout). A caller that passes neither set gets
 * `{ circleId, text, kind }` — the minimal legacy payload.
 *
 * @param {object} a
 * @param {string} a.msgId
 * @param {number} a.ts
 * @param {string} a.circleId
 * @param {string} a.actor
 * @param {string} a.text
 * @param {string} [a.senderDisplay]  received/rehydrate paths only
 * @param {Array}  [a.buttons]
 * @param {string} [a.scope]
 * @param {Array}  [a.embeds]
 * @param {object} [a.media]
 * @param {object} [a.review]
 * @param {(string|object)} [a.provenance]
 * @param {*}      [a.consent]
 */
export function toEventLogItem({
  msgId, ts, circleId, actor, text,
  senderDisplay, buttons, scope, embeds, media, review, provenance, consent,
}) {
  return {
    id: msgId, ts, app: 'kring', type: 'chat-message', actor,
    payload: {
      circleId, text, kind: 'chat-message',
      // `senderDisplay` distinguishes "not provided" (optimistic-local caller
      // — key omitted) from "provided, possibly null" (received/rehydrate
      // callers, which always carried `senderDisplay: actor` even when actor
      // was null). Hence the `undefined` sentinel, NOT a null check.
      ...(senderDisplay !== undefined ? { senderDisplay } : {}),
      ...(buttons?.length ? { buttons } : {}),
      ...(scope ? { scope } : {}),
      ...(embeds?.length ? { embeds } : {}),
      ...(media ? { media } : {}),
      ...(review ? { review } : {}),
      ...(provenance != null ? { provenance } : {}),
      ...(consent != null ? { consent } : {}),
    },
  };
}

/**
 * `fromItem` (render item) — the inverse of `toEventLogItem` for the core
 * transferable fields, so the round-trip identity is testable. Local-only
 * presentation fields are carried back verbatim; `senderDisplay` is dropped
 * (it's a render echo of `actor`, not an envelope field).
 */
export function fromEventLogItem(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const p = evt.payload && typeof evt.payload === 'object' ? evt.payload : {};
  const out = {
    msgId: evt.id,
    ts: evt.ts,
    circleId: p.circleId,
    actor: evt.actor,
    text: p.text,
  };
  if (p.buttons?.length) out.buttons = p.buttons;
  if (p.scope) out.scope = p.scope;
  if (p.embeds?.length) out.embeds = p.embeds;
  if (p.media) out.media = p.media;
  if (p.review) out.review = p.review;
  if (p.provenance != null) out.provenance = p.provenance;
  if (p.consent != null) out.consent = p.consent;
  return out;
}

/**
 * `toWire` — project the canonical fields onto the peer fan-out WIRE
 * envelope that `stoop broadcastKringMessage` sends over the reliable
 * transport:
 *   `{ type:'p2p-chat', subtype:'kring-chat-message', circleId, msgId, ts, text, fromActor, fromWebid, media? }`
 *
 * The media wire-allowlist (`kring-host mediaForKringWire`) runs UPSTREAM
 * inside `broadcastKringFanOut` before the pointer reaches this projection,
 * so `media` here is already the whitelisted, circle-safe shape (sender-local
 * fields such as `stored` / device paths already dropped). This projector
 * only re-emits it; it never re-admits a raw embed. Absent → byte-identical
 * to the pre-media wire shape (legacy receivers ignore an unknown field
 * either way).
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {string} a.msgId
 * @param {number} a.ts
 * @param {string} a.text
 * @param {(string|null)} a.fromActor
 * @param {(string|null)} a.fromWebid
 * @param {object} [a.media]  already wire-whitelisted
 */
export function toWireEnvelope({ circleId, msgId, ts, text, fromActor, fromWebid, media }) {
  return {
    type: 'p2p-chat', subtype: KRING_CHAT_KIND,
    circleId, msgId, ts, text, fromActor, fromWebid,
    ...(media && typeof media === 'object' && !Array.isArray(media) ? { media } : {}),
  };
}

/**
 * `toWire` (REF variant) — the pod-signal projection of the canonical
 * Envelope. The canonical
 * Envelope carries EITHER a `body` (the full text — `toWireEnvelope` above)
 * OR a `ref` (an opaque pointer at the row a shared pod already holds). A
 * circle whose data-policy resolves to `pod-signal` (shared/hybrid) writes
 * the message to the pod and fans THIS shape — the same envelope minus the
 * body, plus a `ref` — so peers pull the content from the pod instead of
 * receiving it inline.
 *
 * It is the byte-for-byte sibling of `toWireEnvelope` with `text` replaced by
 * `ref`: same `{ type, subtype, circleId, msgId, ts, fromActor, fromWebid,
 * media? }` frame, no `text` field. `ref` is an opaque string (a pod row
 * pointer); this projector neither interprets nor resolves it.
 *
 * NOTE (honest degrade): the live send path degrades pod-signal to a
 * full-body `toWireEnvelope` fan until the real shared-pod write is wired,
 * so this shape is defined + unit-tested now but not yet fanned on the
 * live path. It plugs in at the stoop `broadcastToCircle` pod seam.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {string} a.msgId
 * @param {number} a.ts
 * @param {string} a.ref                  opaque pod-row pointer (replaces the body)
 * @param {(string|null)} a.fromActor
 * @param {(string|null)} a.fromWebid
 * @param {object} [a.media]              already wire-whitelisted (unchanged from toWireEnvelope)
 */
export function toWireRefEnvelope({ circleId, msgId, ts, ref, fromActor, fromWebid, media, subtype }) {
  return {
    // `subtype` rides through so a ref points its RESOLVER at the right receive path: a signed-statement
    // row's ref routes to the chat rail (verify-then-render), the legacy kind to the legacy inbox.
    type: 'p2p-chat', subtype: subtype ?? KRING_CHAT_KIND,
    circleId, msgId, ts, ref, fromActor, fromWebid,
    ...(media && typeof media === 'object' && !Array.isArray(media) ? { media } : {}),
  };
}

/**
 * The inverse of `toWireRefEnvelope` — recover the canonical ref fields from a
 * pod-signal wire envelope, so the projection round-trip is testable and a
 * receiver can read the pointer back. Returns `null` for anything that isn't a
 * ref-shaped wire envelope (missing `ref`).
 *
 * @param {object} env
 * @returns {{circleId:string, msgId:string, ts:number, ref:string, fromActor:(string|null), fromWebid:(string|null), media?:object} | null}
 */
export function fromWireRefEnvelope(env) {
  if (!env || typeof env !== 'object') return null;
  if (typeof env.ref !== 'string' || !env.ref) return null;
  const out = {
    circleId:  env.circleId,
    msgId:     env.msgId,
    ts:        env.ts,
    ref:       env.ref,
    fromActor: env.fromActor ?? null,
    fromWebid: env.fromWebid ?? null,
  };
  if (isMediaObject(env.media)) out.media = env.media;
  return out;
}

/**
 * Discriminate the two wire variants of the ONE canonical Envelope: a
 * `pod-signal` fan carries a `ref` (and no body), a `fan-out-full` fan carries
 * the `text` body (and no ref). `body`/`ref` are mutually exclusive by
 * construction, so the presence of `ref` alone identifies the ref variant.
 */
export function isRefEnvelope(env) {
  return !!env && typeof env === 'object' && typeof env.ref === 'string' && env.ref.length > 0;
}

/** A media-card-shaped object (never an array, never a primitive). */
function isMediaObject(m) {
  return !!m && typeof m === 'object' && !Array.isArray(m);
}
