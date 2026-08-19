/**
 * The buurt-POST catch-up (a stoop noticeboard concern) — reconnect-time peer poll:
 *
 *   - `makeRequestCatchUpFromKnownPeers` — sender-side.  After the peer transport (re)connects, fire
 *     'catch-up-request' to each known peer in each buurt asking for posts added after our last-seen
 *     high-water mark (`makeRequestCatchUpForGroup` is the per-circle body).
 *
 *   - `makeHandleCatchUpRequest` — receiver-side.  Looks up missing posts via
 *     stoop.listCirclePostsSince + sends each back via the existing 'buurt-post' envelope (which the
 *     receiver's normal ingest path already handles + deduplicates).
 *
 * POSTS ONLY. The chat/tasks/governance/membership catch-ups all ride their device-log lanes now
 * (frontier replay with the consent rung · pull-all · the pod read-back); the per-kring strategy
 * routing and the negotiated chat transfer that used to live here retired with the chat re-root.
 *
 * Same dep pattern as meshIntros.js: callSkill + sendPeer + logger.
 */


/**
 * @typedef {object} CatchUpDeps
 * @property {(appOrigin: string, opId: string, args: object) => Promise<*>} callSkill
 * @property {(addr: string, payload: object) => Promise<*>}                  sendPeer
 * @property {() => string|null}                                              [getMyPubKey]
 * @property {{info?: Function, warn?: Function, error?: Function}}           [logger]
 */

/**
 * ε.3 — per-group peer catch-up handler.  Lifts the inner body of
 * `makeRequestCatchUpFromKnownPeers`'s for-of loop into a reusable
 * unit so the strategy router can call it ONE KRING AT A TIME (the
 * `peerCatchUp` handler shape that `scheduleCatchUp` expects).
 *
 * Roster-empty short-circuit + sinceMs lookup preserved — when a
 * kring has no known peers OR no posts yet, the function logs the
 * "skipped" status and returns without sending anything.  The
 * returned shape is informational; the dispatcher's `result` field
 * keeps the trace for diagnostics.
 *
 * Note: catch-up's `sinceTs` in the strategy contract is per-message
 * timestamp; here the peer envelope uses `sinceMs` keyed off
 * `getLatestPostAddedAt`'s `latestAt` (the buurt-post hi-water mark).
 * For ε.3 we honour the caller's `sinceTs` when supplied, and fall
 * back to the hi-water mark when not — keeps the existing default
 * for callers that haven't migrated to negotiated cursors yet.
 *
 * @param {CatchUpDeps} deps
 */
export function makeRequestCatchUpForGroup({ callSkill, sendPeer, logger = console }) {
  return async function requestCatchUpForGroup({ circleId, sinceTs } = {}) {
    if (!circleId) return { skipped: true, reason: 'no-circleId' };
    const groupId = circleId;
    let roster = [];
    try {
      const r = await callSkill('stoop', 'listGroupRoster', { groupId });
      roster = r?.members ?? [];
    } catch { /* swallow */ }
    const peers = roster.filter((m) => m?.addr);
    if (peers.length === 0) {
      logger.info?.(`[catch-up] skipped groupId=${groupId} (0 peers)`);
      return { skipped: true, reason: 'no-peers', peerCount: 0 };
    }
    // Caller may pass an explicit sinceTs > 0 (negotiated cursor — ε.4
    // territory).  Anything else (undefined / null / 0) means "use the
    // hi-water mark" — the legacy behaviour the buurt-post receiver
    // filter expects.  Treating 0 as "no cursor" matches the strategy
    // router's default (it normalises missing sinceTs to 0) without
    // requiring the dispatcher to leak that detail.
    let sinceMs;
    if (Number.isFinite(sinceTs) && sinceTs > 0) {
      sinceMs = sinceTs;
    } else {
      sinceMs = 0;
      try {
        const hi = await callSkill('stoop', 'getLatestPostAddedAt', { groupId });
        sinceMs = hi?.latestAt ?? 0;
      } catch { /* swallow */ }
    }
    let sent = 0;
    const errors = [];
    for (const m of peers) {
      try {
        await sendPeer(m.addr, {
          type:    'p2p-chat',
          subtype: 'catch-up-request',
          groupId,
          sinceMs,
          sentAt:  Date.now(),
        });
        sent += 1;
      } catch (err) {
        errors.push({ addr: m.addr, reason: String(err?.message ?? err) });
        logger.warn?.('[catch-up] send failed for', m.addr, err);
      }
    }
    logger.info?.(`[catch-up] requested posts since ${new Date(sinceMs).toISOString()}`
      + ` for groupId=${groupId} from ${peers.length} peer(s)`);
    return { sent, peerCount: peers.length, sinceMs, errors };
  };
}

/**
 * @param {CatchUpDeps & {
 *   inbox?: {ingestChatMessage: Function},
 *   getCirclePolicy?: (circleId: string) => Promise<object|null>|object|null,
 *   peerCatchUpNegotiated?: ({circleId, sinceTs}) => Promise<*>,
 * }} deps
 *
 * ε.3 — when `getCirclePolicy` is supplied, each kring's catch-up
 * routes through `scheduleCatchUp(policy.pod)` so pod-shared kringen
 * use the pod range-query and personal/none kringen keep the peer
 * path.  Without `getCirclePolicy` we default the policy to
 * `{pod: 'personal'}` (= 'peer' strategy = today's behaviour),
 * preserving bit-for-bit semantics for callers that haven't migrated.
 *
 * `inbox` is required for the pod path; when omitted, the pod handler
 * isn't wired and `scheduleCatchUp` returns `deferred` for shared
 * kringen — same forward-compat contract as catchUpStrategy.js
 * documents.
 *
 * ε.4 — when `peerCatchUpNegotiated` is supplied, the strategy
 * router's `peerCatchUp` handler is REPLACED with it for
 * personal/none kringen.  The legacy single-message peer-poll path
 * (`makeRequestCatchUpForGroup`) is kept as a fallback so callers
 * that haven't migrated keep working, AND so personal-pod kringen
 * with no negotiated coordinator wired (e.g. a half-migrated boot)
 * still cover the basic catch-up case.  Both paths produce results
 * the inbox can dedupe through.
 */
export function makeRequestCatchUpFromKnownPeers({
  callSkill,
  sendPeer,
  logger = console,
}) {
  // POSTS only (the stoop noticeboard's hi-water peer poll). The chat/tasks/governance/membership
  // catch-ups all ride their device-log lanes now (frontier replay / pull-all / the pod read-back) —
  // the per-kring strategy routing that used to live here went with them.
  const perGroup = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger });

  return async function requestCatchUpFromKnownPeers() {
    let buurts = [];
    try {
      const r = await callSkill('stoop', 'listMyCircles', {});
      buurts = r?.buurts ?? [];
    } catch (err) {
      logger.warn?.('[catch-up] listMyCircles failed', err);
      return;
    }
    for (const groupId of buurts) {
      try {
        const r = await perGroup({ circleId: groupId });
        logger.info?.('[catch-up]', groupId, r);
      } catch (err) {
        logger.warn?.('[catch-up] posts poll failed for', groupId, err?.message ?? err);
      }
    }
  };
}

/**
 * @param {CatchUpDeps} deps
 */
export function makeHandleCatchUpRequest({ callSkill, sendPeer, getMyPubKey, logger = console }) {
  return async function handleCatchUpRequest(fromAddr, payload) {
    const { groupId, sinceMs } = payload ?? {};
    if (!groupId) return;
    let posts = [];
    try {
      const r = await callSkill('stoop', 'listCirclePostsSince', { groupId, sinceMs: sinceMs ?? 0 });
      posts = r?.posts ?? [];
    } catch (err) {
      logger.warn?.('[catch-up] listCirclePostsSince failed', err);
      return;
    }
    if (posts.length === 0) {
      logger.info?.(`[catch-up] no new posts to send to ${fromAddr.slice(0, 16)}…`);
      return;
    }
    for (const post of posts) {
      const { _addedAt, ...payloadCore } = post;
      try {
        await sendPeer(fromAddr, {
          type:       'p2p-chat',
          subtype:    'buurt-post',
          groupId,
          fromPubKey: payloadCore.fromPubKey ?? (typeof getMyPubKey === 'function' ? getMyPubKey() : null),
          payload:    payloadCore,
          catchUp:    true,
          sentAt:     Date.now(),
        });
      } catch (err) {
        logger.warn?.('[catch-up] send post failed', err);
      }
    }
    logger.info?.(`[catch-up] sent ${posts.length} post(s) to ${fromAddr.slice(0, 16)}…`);
  };
}
