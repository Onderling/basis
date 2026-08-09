/**
 * basis v2 — ε.4: negotiated catch-up provider handler.
 *
 * Builds a `(fromPeerAddr, payload) => Promise<void>` handler that
 * registers in the peer-router under the `catch-up-request` subtype.
 *
 * Flow per inbound request:
 *
 *   1. Validate the envelope (silent drop on malformed — we don't
 *      want to leak protocol errors back to a possibly-malicious
 *      peer).
 *   2. Resolve the kring's policy via `getCirclePolicy(groupId)`.
 *      - `policy.catchUpAutoApprove === false` AND the requester
 *        isn't a known contact → fire `emitNotification` so the host
 *        UI can surface a [Send all / Last 50 / Last 7 days / Decline]
 *        card.  The host then calls `resolveCatchUpRequest({requestId,
 *        mode|null})` (returned alongside the handler) when the user
 *        decides.  Until then, the request is pending.
 *      - Otherwise → V1 auto-approve path: continue inline with
 *        mode='all'.
 *   3. Fetch via `callSkill('stoop', 'getMessagesSince', {groupId,
 *      sinceTs, max: 1000})`.
 *   4. Apply mode filter (defaults to 'all' for auto-approve).
 *   5. Compute offer; if `count === 0`, SILENT (no reply, same as
 *      decline) — the receiver times out and moves on.
 *   6. Send `catch-up-offer`; then `catch-up-chunk` × N; then
 *      `catch-up-end`.
 *
 * Failure semantics:
 *   - `callSkill` throws → log + silent (same as count=0).
 *   - `sendToPeer` throws on the offer → log + abort the stream.
 *   - `sendToPeer` throws on a chunk → log + still send `catch-up-end`
 *     with the partial totalSent so the receiver can settle its
 *     state (rather than waiting for `chunkTimeoutMs`).
 *
 * The provider is stateless across calls (every inbound request is
 * processed independently).  The ONLY state is the
 * `pendingDecisions` map — entries keyed by `requestId` that wait for
 * the host UI to call `resolveCatchUpRequest`.  Entries are evicted
 * after `decisionTimeoutMs` (default 60s) so a forgotten card
 * doesn't leak.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import {
  CATCH_UP_SUBTYPES,
  isValidRequest,
  isValidAccept,
  applyModeFilter,
  computeOfferFromItems,
  chunkItems,
  buildOffer,
  buildChunk,
  buildEnd,
  DEFAULT_CHUNK_SIZE,
} from './catchUpProtocol.js';

// Parameter register (#36) — catch-up provider protocol timing/limits. Per-install (scope:device) and
// kind:internal: safety bounds a user must not be able to poke (a settable fetch cap or timeout is how you
// wedge a provider). All are already caller-overridable via the args below; `param()` returns them unchanged.
const DEFAULT_DECISION_TIMEOUT_MS = param({ key: 'catchup.decisionTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
const DEFAULT_MAX_FETCH           = param({ key: 'catchup.maxFetch',          scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1000 });
const DEFAULT_ACCEPT_TIMEOUT_MS   = param({ key: 'catchup.acceptTimeoutMs',   scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 15_000 });

/**
 * Build the provider-side catch-up handler.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 *   Bound callSkill; we call `callSkill('stoop', 'getMessagesSince', …)`.
 * @param {(peerAddr: string, envelope: object) => Promise<*>} args.sendToPeer
 *   NKN send; thin wrapper over agent.sendPeerMessage.
 * @param {(groupId: string) => Promise<object|null>|object|null} [args.getCirclePolicy]
 *   When omitted, every request is auto-approved (V1 default).  When
 *   supplied, the handler reads `policy.catchUpAutoApprove` (default
 *   `true`).
 * @param {(fromPeerAddr: string) => boolean} [args.isKnownContact]
 *   Defaults to `() => true` — V1's permissive policy.  When false +
 *   `autoApprove` is false, the request waits for the host UI.
 * @param {(n: {requestId, fromPeerAddr, groupId, sinceTs, count, sizeBytes, lastTs, modeOptions}) => void} [args.emitNotification]
 *   Optional notification hook.  Fired when the host UI should
 *   surface the [Send all / Last 50 / Last 7 days / Decline] card.
 *   Carries the offer preview so the card shows "{{count}} messages
 *   · about {{kb}} KB".
 * @param {number} [args.chunkSize]            Default 50.
 * @param {number} [args.maxFetch]             Default 1000.
 * @param {number} [args.decisionTimeoutMs]    Default 60_000.
 * @param {{info?, warn?, error?, debug?}} [args.logger]
 *
 * @returns {{
 *   handler:                (fromPeerAddr: string, payload: object) => Promise<void>,
 *   resolveCatchUpRequest:  (decision: {requestId: string, mode: string|null}) => Promise<void>,
 *   _pending:               Map<string, object>,   // exposed for tests
 * }}
 */
export function makeCatchUpProviderHandler({
  callSkill,
  sendToPeer,
  getCirclePolicy   = null,
  isKnownContact    = () => true,
  emitNotification  = null,
  chunkSize         = DEFAULT_CHUNK_SIZE,
  maxFetch          = DEFAULT_MAX_FETCH,
  decisionTimeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
  acceptTimeoutMs   = DEFAULT_ACCEPT_TIMEOUT_MS,
  logger            = console,
} = {}) {
  if (typeof callSkill !== 'function')   throw new Error('makeCatchUpProviderHandler: callSkill required');
  if (typeof sendToPeer !== 'function')  throw new Error('makeCatchUpProviderHandler: sendToPeer required');

  // Pending host-UI decisions keyed by requestId.  Each entry holds
  // the deferred resolve + the timer that evicts the entry if the
  // user doesn't decide within `decisionTimeoutMs`.
  const pending = new Map();

  // Awaiting-accept registry: after we send `catch-up-offer`, we hold
  // the fetched items + sinceTs here keyed by requestId so the
  // `catch-up-accept` handler can filter + chunk + stream WITHOUT
  // re-fetching.  Entries expire after `acceptTimeoutMs` so a
  // disappeared receiver doesn't pin memory.
  const awaitingAccept = new Map();

  /**
   * Fetch + send offer.  Holds onto the items pending the receiver's
   * `catch-up-accept`.  If the receiver never accepts within
   * `acceptTimeoutMs`, the entry is evicted silently.
   *
   * V1 simplification: the auto-approve path also goes through this
   * (provider doesn't pre-pick the mode — it sends the offer with
   * `count` reflecting the FULL set, and lets the receiver's accept
   * choose the mode).  Future: an autoApprove path could pick a
   * default mode + stream straight through, but lockstep with the
   * receiver state machine is simpler to reason about.
   */
  async function sendOfferAndAwait({ fromPeerAddr, groupId, sinceTs, requestId }) {
    let items = [];
    try {
      const res = await callSkill('stoop', 'getMessagesSince', {
        groupId,
        sinceTs,
        max: maxFetch,
      });
      items = Array.isArray(res?.items) ? res.items : [];
    } catch (err) {
      logger.warn?.('[catch-up] getMessagesSince threw', err?.message ?? err);
      return;  // silent
    }

    // Offer reflects the FULL fetched set; the receiver's accept
    // picks a mode (which may downscale to last-50 / last-7-days).
    const offer = computeOfferFromItems(items, sinceTs);
    if (offer.count === 0) {
      logger.info?.('[catch-up] no items to send for', requestId);
      return;  // silent — same as decline
    }

    // Park the items so the accept handler can filter + chunk + stream.
    const expireTimer = setTimeout(() => {
      awaitingAccept.delete(requestId);
      logger.info?.('[catch-up] accept timed out for', requestId);
    }, acceptTimeoutMs);
    if (typeof expireTimer?.unref === 'function') expireTimer.unref();

    awaitingAccept.set(requestId, {
      fromPeerAddr, groupId, sinceTs, items, expireTimer,
    });

    try {
      await sendToPeer(fromPeerAddr, buildOffer({
        requestId,
        count:     offer.count,
        sizeBytes: offer.sizeBytes,
        lastTs:    offer.lastTs,
      }));
    } catch (err) {
      logger.warn?.('[catch-up] offer send failed', err?.message ?? err);
      clearTimeout(expireTimer);
      awaitingAccept.delete(requestId);
    }
  }

  /**
   * The receiver accepted: apply mode filter, chunk, stream, end.
   */
  async function streamChunks({ fromPeerAddr, items, requestId, mode }) {
    const filtered = applyModeFilter(items, mode);
    const chunks = chunkItems(filtered, chunkSize);
    let totalSent = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      try {
        await sendToPeer(fromPeerAddr, buildChunk({
          requestId,
          seq:      i,
          items:    chunks[i],
          finished: isLast,
        }));
        totalSent += chunks[i].length;
      } catch (err) {
        logger.warn?.('[catch-up] chunk send failed at seq=', i, err?.message ?? err);
        break;  // stop streaming but still send catch-up-end for accounting
      }
    }

    // catch-up-end (always, even on partial — receiver settles)
    try {
      await sendToPeer(fromPeerAddr, buildEnd({ requestId, totalSent }));
    } catch (err) {
      logger.warn?.('[catch-up] end send failed', err?.message ?? err);
    }
    logger.info?.(`[catch-up] sent ${totalSent}/${filtered.length} item(s) for ${requestId}`);
  }

  /** Inbound catch-up-accept handler. */
  async function onAccept(fromAddr, payload) {
    if (!isValidAccept(payload)) {
      logger.debug?.('[catch-up] dropping malformed accept');
      return;
    }
    const entry = awaitingAccept.get(payload.requestId);
    if (!entry) {
      logger.debug?.('[catch-up] accept for unknown / expired request', payload.requestId);
      return;
    }
    clearTimeout(entry.expireTimer);
    awaitingAccept.delete(payload.requestId);
    if (fromAddr && entry.fromPeerAddr && fromAddr !== entry.fromPeerAddr) {
      // Accept from someone other than the original requester — drop.
      logger.debug?.('[catch-up] accept from wrong peer; ignoring');
      return;
    }
    return streamChunks({
      fromPeerAddr: entry.fromPeerAddr,
      items:       entry.items,
      requestId:   payload.requestId,
      mode:        payload.mode,
    });
  }

  /**
   * Inbound `catch-up-request` handler.
   */
  async function handler(fromPeerAddr, payload) {
    if (!isValidRequest(payload)) {
      logger.debug?.('[catch-up] dropping malformed request', payload?.subtype);
      return;
    }
    const { groupId, sinceTs, requestId } = payload;
    const senderAddr = payload.fromPeerAddr || fromPeerAddr;

    // Decide: auto-approve OR wait for host UI?
    let autoApprove = true;
    if (typeof getCirclePolicy === 'function') {
      try {
        const policy = await getCirclePolicy(groupId);
        // policy.catchUpAutoApprove === false explicitly opts out.
        if (policy && policy.catchUpAutoApprove === false) {
          autoApprove = false;
        }
      } catch (err) {
        logger.warn?.('[catch-up] getCirclePolicy threw, defaulting to auto-approve', err?.message ?? err);
      }
    }
    // Known contacts always auto-approve regardless of policy: V1
    // assumes kring members are trusted.  The policy axis exists for
    // unknown / cross-kring requesters that haven't been onboarded.
    let known = true;
    try { known = !!isKnownContact(senderAddr); }
    catch { known = true; }

    if (!autoApprove && !known) {
      // Surface to host UI; wait for `resolveCatchUpRequest`.
      // Compute the preview so the card can show count + size.
      let previewItems = [];
      try {
        const res = await callSkill('stoop', 'getMessagesSince', { groupId, sinceTs, max: maxFetch });
        previewItems = Array.isArray(res?.items) ? res.items : [];
      } catch (err) {
        logger.warn?.('[catch-up] preview fetch failed', err?.message ?? err);
        return;
      }
      const preview = computeOfferFromItems(previewItems, sinceTs);
      if (preview.count === 0) {
        logger.info?.('[catch-up] notification skipped: 0 items for', requestId);
        return;
      }

      // Eviction timer so a forgotten card doesn't leak forever.
      const timer = setTimeout(() => {
        pending.delete(requestId);
        logger.info?.('[catch-up] decision timed out for', requestId);
      }, decisionTimeoutMs);
      if (typeof timer?.unref === 'function') timer.unref();

      pending.set(requestId, {
        fromPeerAddr: senderAddr,
        groupId, sinceTs, requestId,
        previewItems,
        timer,
      });

      if (typeof emitNotification === 'function') {
        try {
          emitNotification({
            requestId,
            fromPeerAddr: senderAddr,
            groupId, sinceTs,
            count:       preview.count,
            sizeBytes:   preview.sizeBytes,
            lastTs:      preview.lastTs,
            modeOptions: ['all', 'last-50', 'last-7-days', null],   // null = decline
          });
        } catch (err) {
          logger.warn?.('[catch-up] emitNotification threw', err?.message ?? err);
        }
      }
      return;
    }

    // Auto-approve path: send offer + await receiver's accept.
    return sendOfferAndAwait({
      fromPeerAddr: senderAddr,
      groupId, sinceTs, requestId,
    });
  }

  /**
   * Host UI callback: the user approved (the substrate already
   * forwarded the offer; the host's role is "yes/no, do continue").
   *
   * Decline = `mode: null`.  Silent — no envelope sent, just cleans
   * up the pending entry.
   *
   * For the host-UI path the V1 simplification is: we send the offer
   * NOW (we didn't pre-send it; we waited for the user to ok).  The
   * receiver then accepts, picking the mode itself.  The `mode`
   * argument is therefore advisory — it ISN'T used to pre-filter
   * here (the receiver's accept carries the authoritative mode).
   */
  async function resolveCatchUpRequest({ requestId, mode }) {
    const entry = pending.get(requestId);
    if (!entry) {
      logger.debug?.('[catch-up] resolveCatchUpRequest: no pending entry', requestId);
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(requestId);

    if (mode === null || mode === undefined) {
      logger.info?.('[catch-up] declined by host UI', requestId);
      return;
    }

    // V1 simplification: the host-UI path bypasses sendOfferAndAwait
    // and streams directly using the host-picked mode.  Re-fetches
    // the items (the preview fetched in the inbound handler is
    // discarded — keeps state lean + avoids stale reads).
    let items = [];
    try {
      const res = await callSkill('stoop', 'getMessagesSince', {
        groupId: entry.groupId,
        sinceTs: entry.sinceTs,
        max:     maxFetch,
      });
      items = Array.isArray(res?.items) ? res.items : [];
    } catch (err) {
      logger.warn?.('[catch-up] getMessagesSince threw on resolve', err?.message ?? err);
      return;
    }
    const filtered = applyModeFilter(items, mode);
    const offer    = computeOfferFromItems(filtered, entry.sinceTs);
    if (offer.count === 0) return;

    try {
      await sendToPeer(entry.fromPeerAddr, buildOffer({
        requestId,
        count:     offer.count,
        sizeBytes: offer.sizeBytes,
        lastTs:    offer.lastTs,
      }));
    } catch (err) {
      logger.warn?.('[catch-up] offer send failed (resolve path)', err?.message ?? err);
      return;
    }

    return streamChunks({
      fromPeerAddr: entry.fromPeerAddr,
      items:       filtered,   // already host-filtered
      requestId,
      mode:        'all',      // already filtered → don't re-filter
    });
  }

  return { handler, onAccept, resolveCatchUpRequest, _pending: pending, _awaitingAccept: awaitingAccept };
}

// Re-export the subtype constant so the peer-router registration site
// can `import { CATCH_UP_SUBTYPES } from './catchUpProvider.js'` if
// it prefers locality.  (Authoritative constant still lives in
// catchUpProtocol.js.)
export { CATCH_UP_SUBTYPES };
