// basis v2 — circle chat SEND primitives, shared by web (circleApp.js) and mobile
// (CircleLauncherScreen.js). The optimistic-append EVENT shape and the best-effort fan-out (with δ.2
// delivery-state transitions) were duplicated near-identically on both platforms; this is the one copy
// (web↔mobile consolidation Phase 2). Platform-neutral: the caller injects the RAW 3-arg callSkill, the
// δ.2 deliveryState map, and an `onChange` rerender hook (web `rerender()` / RN `setDeliveryTick`).
//
// Connectivity Phase 2 — the optimistic EventLog event is now a projection of
// the ONE canonical chat Envelope: `circleChatMessageEvent` delegates to
// `@onderling/item-store`'s `toEventLogItem` (the same projector the received
// + rehydrate append paths use), so the render event can't drift per-caller.

import { toEventLogItem } from '@onderling/item-store';

/**
 * Build the optimistic circle chat-message event for the local (append-only) EventLog. The same `msgId`
 * is later passed to `broadcastCircleFanOut`, so receiver-side dedup suppresses any mirrored echo.
 *
 * @param {{msgId:string, ts:number, circleId:string, actor:string, text:string, buttons?:Array, scope?:string, embeds?:Array, card?:object, provenance?:(string|{llmUsed?:boolean}), consent?:*}} a
 */
export function circleChatMessageEvent({ msgId, ts, circleId, actor, text, buttons, scope, embeds, card, review, provenance, consent }) {
  // Delegate to the ONE canonical Envelope→render-event projection
  // (connectivity Phase 2 collapse). This builder is now the optimistic-local
  // caller of `toEventLogItem`: it passes the LOCAL-ONLY presentation fields
  // and NO `senderDisplay`, so the render event is byte-identical to before.
  //
  //   `scope` ('self' | 'circle') — is this message private to you or shared with the
  //   whole circle (a data property; the badge is one presentation of it). See messageScope.js.
  //   `embeds` ([{type,ref,title?}]) — cross-object references this message carries (a bot
  //   reply pointing at the task/event it just acted on); rendered as "See also" chips.
  //   `card` — ONE embed card riding this message: a photo (`media-card`), an appointment
  //   (`time-card`), a shared item (`item-card`), a file (`file-card`). The bubble renders whichever
  //   variant it is through the same shared card renderer. It was called `media` while a photo was the
  //   only kind that could ride a message, and the name then did real damage: `mediaForCircleWire`
  //   returned null for every other variant, so a card put on it rendered locally and was SILENTLY
  //   dropped at the fan-out — the receiving device saw a message with no card and nothing said so.
  //   `review` — a structured Stage-1 feedback review ({intro, points, labels}); rendered as
  //   editable per-point cards. Private by construction (scope 'self'), never fans out.
  //   `provenance` / `consent` — bot-bubble presentation markers; local-only, never fanned out.
  return toEventLogItem({ msgId, ts, circleId, actor, text, buttons, scope, embeds, card, review, provenance, consent });
}

/**
 * The snapshot fields each card VARIANT may put on the wire. A whitelist per variant, not one union:
 * the point of the list is that a caller cannot widen it by accident, and a union would let a photo's
 * fields ride an appointment. Absent stays absent; anything not named here is dropped at the boundary
 * (the stoop Phase-39 lesson: local-only fields must never ride a fan-out).
 */
const CARD_SNAPSHOT_FIELDS = Object.freeze({
  // A photo: the canonical `media` item fields (@onderling/item-types) + the manifest line (below).
  'media-card': ['type', 'id', 'createdAt', 'createdBy', 'mime', 'width', 'height', 'caption'],
  // An appointment, as `createTimeEmbed` builds it from the calendar's own snapshot.
  'time-card':  ['type', 'id', 'title', 'startAt', 'endAt', 'timezone', 'location', 'fields'],
  // A shared existing item (a task, a post) — the card the receiver renders and can act on.
  'item-card':  ['type', 'id', 'title', 'status', 'assignee', 'dueAt', 'fields'],
  // A file, by reference. The bytes are not here; `source` carries the sealed manifest line.
  'file-card':  ['type', 'id', 'name', 'mime', 'size', 'createdAt', 'createdBy'],
});

/**
 * Project an embed card onto its WIRE shape — the explicit whitelist of what may leave this device on
 * the circle fan-out envelope. Everything the peer's chip needs is kept; sender-local bookkeeping
 * (`stored`), device paths, cached data-URLs, whatever a future caller straps on, is dropped HERE.
 *
 * The kept payload is circle-safe by construction: `pointer.ref`/`itemRef` are opaque URNs,
 * `snapshot.source` is blob-gateway's manifest line (opaque `blob://` bucket key + `enc` sealing
 * metadata whose `keyRef` POINTS at the circle key the peers already hold; the inline `thumb` is a
 * SEALED envelope, never plaintext).
 *
 * Returns `null` for an unknown variant — fail closed, and the fan-out then omits the field. That is
 * the right default and it had a cost worth remembering: while this function knew only `media-card`,
 * an appointment card rendered on the sender's screen and never reached anybody else, silently.
 */
export function cardForCircleWire(embed) {
  if (!embed || typeof embed !== 'object' || Array.isArray(embed)) return null;
  const fields = CARD_SNAPSHOT_FIELDS[embed.kind];
  if (!fields) return null;
  const out = { kind: embed.kind };
  if (typeof embed.appOrigin === 'string') out.appOrigin = embed.appOrigin;
  if (embed.itemRef && typeof embed.itemRef === 'object') {
    out.itemRef = pickFields(embed.itemRef, ['app', 'type', 'id']);
  }
  if (embed.pointer && typeof embed.pointer === 'object') {
    out.pointer = pickFields(embed.pointer, ['type', 'ref']);
  }
  if (embed.snapshot && typeof embed.snapshot === 'object') {
    const snap = pickFields(embed.snapshot, fields);
    if (embed.snapshot.source && typeof embed.snapshot.source === 'object') {
      snap.source = pickFields(embed.snapshot.source, ['type', 'ref', 'enc']);
    }
    out.snapshot = snap;
  }
  if (typeof embed.issuedBy === 'string') out.issuedBy = embed.issuedBy;
  return out;
}

/** Copy only the named fields that are PRESENT (absent stays absent — never null-filled). */
function pickFields(src, names) {
  const out = {};
  for (const n of names) {
    if (src[n] !== undefined) out[n] = src[n];
  }
  return out;
}

/**
 * Best-effort fan-out of a circle chat message to the circle's members via stoop's
 * `broadcastCircleMessage`, tracking δ.2 delivery state (pending → sent | failed). Uses the RAW 3-arg
 * callSkill (app-targeted at stoop) — the 2-arg *resolving* callSkill arg-shifts (op→'stoop') and never
 * delivers. Fire-and-forget for callers; returns the promise so tests can await it.
 *
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.rawCallSkill
 * @param {string} a.circleId
 * @param {string} a.msgId
 * @param {string} a.text
 * @param {number} a.ts
 * @param {object} [a.card]         optional embed card riding the message (photo · appointment · item ·
 *                                  file). The RAIL projects it through `cardForCircleWire` (the
 *                                  per-variant whitelist) when it signs the statement; this function
 *                                  only carries it so callers pass one thing, not two.
 * @param {{set:(id:string, state:string|null)=>void}} a.deliveryStateMap
 * @param {()=>void} [a.onChange]   rerender hook fired on each state transition
 * @returns {Promise<void>}
 */
// Per-recipient failure reasons that retrying can NEVER fix (vs a transient
// transport/offline error). A fan-out that ONLY hit these is `undeliverable`
// (the UI shows it, but offers no pointless retry); anything else is `failed`
// (retryable). `recipient-pubkey-unknown` = the member has no published key, so
// there's nobody to encrypt to until they publish one.
export const PERMANENT_FANOUT_REASONS = new Set(['recipient-pubkey-unknown']);

/**
 * Classify a `broadcastCircleMessage` result → a delivery state.
 *   'sent'          — no per-recipient errors.
 *   'failed'        — a whole-op error OR at least one TRANSIENT recipient error (retryable).
 *   'undeliverable' — every recipient error is permanent (retry can't help) — NOT retryable.
 * @returns {'sent'|'failed'|'undeliverable'}
 */
export function classifyFanOut(r) {
  if (r?.error) return 'failed';                 // chat-unavailable / members-unavailable → transient
  const errors = Array.isArray(r?.errors) ? r.errors : [];
  // A clean fan-out means the send left this device — not that it arrived. Decision 1 (2026-07-29): that
  // is `maybe-received`, because we asked for nothing we are willing to show and heard nothing back. The
  // retired `sent` said the same thing in a word that reads like success.
  if (errors.length === 0) return 'maybe-received';
  if (errors.some((e) => !PERMANENT_FANOUT_REASONS.has(e?.reason))) return 'failed';
  return 'undeliverable';                         // all permanent
}

export function broadcastCircleFanOut({ rawCallSkill, circleId, msgId, text, ts, card, deliveryStateMap, onChange, signStatement = null }) {
  if (typeof rawCallSkill !== 'function') return Promise.resolve();
  const mark = (state) => { deliveryStateMap.set(msgId, state); onChange?.(); };
  mark('pending');
  return Promise.resolve()
    // The chat lane: the fan carries a SIGNED statement, always — `signStatement(circleId, msgId)` is
    // the chat rail's sign-the-appended-entry hook, and receivers verify at their rail before anything
    // renders. What fans is signed; a bot bubble or self-scoped line never fans, so it never needs a
    // signature. No signature (no rail / no circle key resolvable) is a DELIVERY FAILURE, marked
    // honestly on the bubble — the unsigned envelope is gone.
    .then(async () => {
      const statement = typeof signStatement === 'function'
        ? await Promise.resolve(signStatement(circleId, msgId)).catch(() => null)
        : null;
      if (!statement) throw new Error('no circle signing available — message not fanned');
      return rawCallSkill('stoop', 'broadcastCircleChatStatement', {
        groupId: circleId, event: statement, msgId, ts,
      });
    })
    .then((r) => {
      const state = classifyFanOut(r);
      if (state !== 'maybe-received') console.info('[circle-chat] fan-out', state, '—', r?.error ?? r?.errors);
      mark(state);
    })
    .catch((err) => { console.warn('[circle-chat] fan-out failed:', err?.message ?? err); mark('failed'); });
}
