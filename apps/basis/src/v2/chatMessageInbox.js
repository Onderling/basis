/**
 * basis v2 — single normalization gate for kring chat-message
 * inserts (ε.1, Phase 9 foundation).
 *
 * Today's eventLog is fed kring chats from MULTIPLE paths, each with
 * their own dedup state + envelope validation + payload shape:
 *
 *   • NKN-inbound peer handler  (`kringChatReceiver.js`)
 *   • boot rehydrator           (`kringChatRehydrate.js`)
 *   • catch-up replies          (future ε.3/ε.4)
 *   • pod range-query           (future ε.3/ε.4)
 *
 * As more paths land, two failure modes grow:
 *
 *   1. Double-insert — the same msgId arrives via two paths (e.g.
 *      live NKN AND in the next catch-up batch), each with their
 *      own LRU, so the bubble renders twice.
 *   2. Drop — path-B silently inserts something path-A would have
 *      rejected (malformed envelope, mute, eviction).
 *
 * The inbox is the ONE place that:
 *
 *   • validates the envelope (`isValidChatEnvelope`)
 *   • dedupes on `msgId` (single shared LRU, cap 256)
 *   • mirrors into stoop's itemStore via `ingest` (honours mute /
 *     eviction / deduped / error verdicts — same contract as today's
 *     `ingestCircleMessage` skill)
 *   • appends to `eventLog` in the byte-for-byte same shape
 *     `kringChatReceiver` used to produce
 *
 * All caller-side paths route through `ingestChatMessage` with a
 * `source` tag so future telemetry / strategy routing can see where
 * the insert came from.  Local sends are NOT routed through the
 * inbox — they're single-source and deterministic (their msgId
 * generation is monotonic and they fire the broadcast).
 *
 * Portable: no DOM, no RN, no module-level state — both surfaces
 * construct one inbox per agent boot, sibling of the eventLog.
 */

import { toEventLogItem, isRefEnvelope, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — bounded dedup-map cap (scope:device, kind:internal). Caller-overridable via arg.
const DEFAULT_DEDUP_CAP = param({ key: 'chatInbox.dedupCap', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 256 });

/**
 * Build a chat-message inbox.
 *
 * @param {object} args
 * @param {{append: Function}} args.eventLog
 * @param {Function} [args.ingest]                 async (payload, fromPeerAddr) →
 *                                                 { ok | deduped | evicted | muted | error }
 * @param {(payload, fromPeerAddr) => string|null} [args.resolveActor]
 *                                                 default actor projector (per-call
 *                                                 override available on `ingestChatMessage`)
 * @param {(refEnvelope) => Promise<object|null>} [args.resolveRef]
 *                                                 Connectivity Phase 3 — resolve a `pod-signal`
 *                                                 REF envelope (a pod-row pointer, no body) into
 *                                                 the full chat envelope by reading the shared pod
 *                                                 (StorageBackend.get + unseal). Absent → ref
 *                                                 envelopes are skipped (never crash the loop).
 * @param {(envelope) => Promise<boolean>|boolean} [args.isSelfAuthored]
 *                                                 "did I write this?" — see `chatSelfAuthor.js`.
 *                                                 Applied on the RESTORE paths only (below).
 * @param {string} [args.localActor]               the actor stamp a self-authored message gets
 *                                                 back (default `'me'`, what both shells' bubbles
 *                                                 compare against).
 * @param {number} [args.dedupCap]                 LRU cap (default 256)
 * @param {{warn?, info?, debug?}} [args.logger]
 * @returns {{ ingestChatMessage: Function, _seen: object }}  `_seen` exposed for tests.
 */
export function createChatMessageInbox({
  eventLog,
  ingest        = null,
  resolveActor  = null,
  resolveRef    = null,
  isSelfAuthored = null,
  localActor    = 'me',
  dedupCap      = DEFAULT_DEDUP_CAP,
  logger        = console,
  // Delivery honesty (2026-07-28): called AFTER a genuine insert with `{ msgId, fromPeerAddr, source }`.
  // This is the "their app stored it" moment — the inbox is the one gate every inbound path goes through,
  // so a receipt hooked anywhere else either misses a path or fires twice. The hook only OBSERVES; whether
  // a receipt actually goes back is the host's policy (`makeReceiptSender`), not the inbox's business.
  onStored      = null,
} = {}) {
  if (!eventLog || typeof eventLog.append !== 'function') {
    throw new Error('createChatMessageInbox: eventLog.append required');
  }
  const seen = new LruSet(dedupCap);

  /**
   * Normalize + dedupe + ingest + append a kring chat message.
   *
   * @param {object} envelope  same shape `kringChatReceiver` accepts.
   * @param {object} opts
   * @param {string} opts.source         required: 'receiver' | 'rehydrator' | 'catchUp' | 'pod' | ...
   * @param {string} [opts.fromPeerAddr]  required for the `receiver` source.
   * @param {Function} [opts.resolveActor] per-call override (receiver passes the host's resolver).
   * @returns {Promise<{ result: 'inserted' | 'deduped' | 'rejected' | 'muted' | 'evicted', reason?: string }>}
   */
  async function ingestChatMessage(envelope, opts = {}) {
    const source       = opts.source ?? 'unknown';
    const fromPeerAddr  = opts.fromPeerAddr ?? null;
    const resolveActorFn = opts.resolveActor ?? resolveActor ?? null;
    const resolveRefFn   = opts.resolveRef ?? resolveRef ?? null;

    // Connectivity Phase 3 (receiver side) — a `pod-signal` fan carries a REF
    // envelope: a pod-row pointer with NO `text` body, so it would fail
    // `isValidChatEnvelope`. Resolve it against the shared pod FIRST (read the
    // row + unseal → the full envelope), then fall through to the normal
    // validate/dedup/ingest path. Dedupe on msgId up front so a duplicate ref
    // never triggers a pod read. Any resolution failure logs + SKIPS — it must
    // never throw out of the receive loop.
    if (isRefEnvelope(envelope)) {
      if (typeof envelope.msgId === 'string' && seen.has(envelope.msgId)) {
        logger.debug?.('[kring-chat] duplicate ref msgId, skipping', envelope.msgId, source);
        return { result: 'deduped' };
      }
      if (typeof resolveRefFn !== 'function') {
        logger.warn?.('[kring-chat] ref envelope but no pod resolver wired — skipping', envelope.msgId, source);
        return { result: 'deferred', reason: 'no-ref-resolver' };
      }
      let resolved = null;
      try {
        resolved = await resolveRefFn(envelope);
      } catch (err) {
        logger.warn?.('[kring-chat] pod ref resolution threw — skipping', err?.message ?? err, source);
        return { result: 'deferred', reason: 'ref-error' };
      }
      if (!isValidChatEnvelope(resolved)) {
        logger.warn?.('[kring-chat] pod ref resolved to nothing usable — skipping', envelope.msgId, source);
        return { result: 'deferred', reason: 'ref-unresolved' };
      }
      // The pod row is authoritative for the body; carry the wire ref's `media`
      // through when the row omitted it (media rides the wire envelope too).
      envelope = (resolved.media || !envelope.media) ? resolved : { ...resolved, media: envelope.media };
    }

    if (!isValidChatEnvelope(envelope)) {
      logger.warn?.('[kring-chat] dropping malformed envelope', { source, envelope });
      return { result: 'rejected', reason: 'malformed' };
    }
    if (seen.has(envelope.msgId)) {
      logger.debug?.('[kring-chat] duplicate msgId, skipping', envelope.msgId, source);
      return { result: 'deduped' };
    }
    // Reserve the slot BEFORE the ingest call so a concurrent second
    // arrival sees the same msgId in the set.  If ingest rejects we
    // still keep the slot — re-trying the exact same envelope would
    // produce the same verdict anyway.
    seen.add(envelope.msgId);

    if (typeof ingest === 'function') {
      try {
        const r = await ingest(envelope, fromPeerAddr);
        if (r?.evicted) {
          logger.info?.('[kring-chat] dropped (evicted)', envelope.msgId, source);
          return { result: 'evicted' };
        }
        if (r?.muted) {
          logger.info?.('[kring-chat] dropped (muted)', envelope.msgId, source);
          return { result: 'muted' };
        }
        if (r?.error) {
          logger.warn?.('[kring-chat] ingest error', r.error, source);
          return { result: 'rejected', reason: 'ingest-error' };
        }
        // r?.deduped: itemStore already had this msgId — skip the
        // live append so the bubble doesn't render twice.
        if (r?.deduped) {
          return { result: 'deduped' };
        }
      } catch (err) {
        logger.warn?.('[kring-chat] ingest threw — falling back to eventLog only', err?.message ?? err);
        // fall through — local append still keeps the live render coherent
      }
    }

    // Is this a message *I* wrote, coming back out of storage? Then it must land with the SAME
    // actor stamp the optimistic append gave it, or a relaunch turns your own history into
    // strangers' — left-aligned, sender-labelled, reportable. `chatSelfAuthor.js` explains the
    // per-circle test; the rule about WHICH paths may ask it lives here:
    //
    //   • restore paths ('rehydrator' / 'pod' / 'catchUp') read messages BACK, which is the only
    //     way one of your own can legitimately reappear — they may ask.
    //   • the live 'receiver' path may NOT. The author rides the envelope, so a peer can put your
    //     identifier in it; honouring that live would render THEIR sentence as YOURS, which is a
    //     worse lie than the one this fixes. Nothing is lost: your own fan-out never loops back,
    //     so a live message claiming to be from you is an echo (already deduped) or a forgery.
    //
    // A check that fails (missing seam, unreachable identity, a synchronous throw) answers "not
    // mine": the message still lands, attributed exactly as it was before this existed.
    const selfAuthored = source !== 'receiver'
      && typeof isSelfAuthored === 'function'
      && await Promise.resolve().then(() => isSelfAuthored(envelope)).catch(() => false);

    const actor = selfAuthored ? localActor : ((typeof resolveActorFn === 'function'
      ? resolveActorFn(envelope, fromPeerAddr)
      : envelope.fromActor) ?? fromPeerAddr ?? null);

    // media — optional media-card embed riding the envelope (forward
    // additive; the sender's wire whitelist already stripped local-only
    // fields). Shape-guarded: anything that isn't a media-card object is
    // dropped, the MESSAGE still lands (text renders as before). Absent →
    // the appended event is byte-identical to the pre-media shape.
    const media = (envelope.media && typeof envelope.media === 'object'
      && !Array.isArray(envelope.media) && envelope.media.kind === 'media-card')
      ? envelope.media : null;

    // Connectivity Phase 2 — the received append is a projection of the ONE
    // canonical chat Envelope. `toEventLogItem` (kring-host's optimistic append
    // uses the same projector) reproduces this exact shape: the received path
    // passes `senderDisplay` + the already-guarded `media`, so the event is
    // byte-identical to what this inbox emitted by hand before.
    eventLog.append(toEventLogItem({
      msgId:    envelope.msgId,
      ts:       envelope.ts,
      circleId: envelope.circleId,
      actor,
      text:     envelope.text,
      // `senderDisplay` is the name printed ABOVE a bubble, and my own messages never print one
      // (the shells suppress it for `isMine`). Omitting the key — rather than passing `'me'` —
      // makes the restored event byte-identical to the optimistic one the live send appended, so
      // restored history renders exactly like live history instead of merely looking like it.
      ...(selfAuthored ? {} : { senderDisplay: actor }),
      // A message that ARRIVED here arrived over the circle fan-out, so its reach IS the whole kring.
      // Both shells render the scope badge as `scope === 'kring' ? "whole kring" : "only you"`
      // (`circleKring.js` / the mobile bubble), so leaving it unset made every received message — every
      // fanned message anyone ever sees — claim it was private to the reader. Untrue, and the most
      // visible kind of untrue.
      //
      // Derived from ARRIVAL, not read off the wire, and that is the point: `scope` is a local-only
      // presentation field that never rides the envelope (`chatEnvelope.js`), a `scope:'self'` message is
      // never fanned out at all, and a wire field would be the sender asserting its own reach — which the
      // enforceability test says is worth nothing. Arrival is the evidence; the badge states exactly it.
      scope: 'kring',
      ...(media ? { media } : {}),
    }));
    logger.info?.('[kring-chat] received', envelope.msgId, 'circle=' + envelope.circleId, 'source=' + source);
    if (typeof onStored === 'function') {
      // `circleId` rides along so a shell can decide whether this insert affects what is ON SCREEN.
      // Without it the only honest options are "repaint on every stored message" or "never" — and web
      // took the second, so a received message sat in the log with nothing telling the open kring to
      // show it (2026-08-03).
      try { onStored({ msgId: envelope.msgId, circleId: envelope.circleId, fromPeerAddr, source }); }
      catch (err) { logger.warn?.('[kring-chat] onStored hook threw', err?.message ?? err); }
    }
    return { result: 'inserted' };
  }

  return { ingestChatMessage, _seen: seen };
}

/**
 * Lifted from kringChatReceiver's `isValidEnvelope`.  Same rules:
 * `subtype === 'kring-chat-message'`, non-empty circleId / msgId /
 * text, finite numeric ts.  Exported for tests + future strategy
 * routers that want to peek at validity without inserting.
 */
export function isValidChatEnvelope(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === 'kring-chat-message'
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.text     === 'string' && p.text
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
  );
}

/**
 * Tiny LRU set: drops the oldest entry once `cap` is exceeded.
 * Map preserves insertion order, so the first key on iteration is
 * the oldest — exactly what we want for FIFO eviction.
 *
 * Internal — exported for the receiver shim only.
 */
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
