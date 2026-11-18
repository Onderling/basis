/**
 * Outbound calendar cross-peer hook.  Bundle calendar cross-peer
 * (2026-05-27) — lifted from `apps/basis/web/main.js:1497`
 * (the v0.7.P3c block inside the calendar branch of the web
 * `callSkill` wrapper).
 *
 * Web's calendar branch in callSkill does two things AFTER the
 * substrate write:
 *   (a) addEvent with `attendees-addr` arg → fans out `calendar-invite`
 *       envelopes to each peer address (via `sendPeer`).
 *   (b) rsvp* (Accept / Decline / Tentative) on an event whose
 *       organiser is an peer address → sends a `calendar-rsvp` envelope
 *       back to the organiser.
 *
 *   (c) cancelEvent → fans a `calendar-cancel` envelope to the event's
 *       persisted attendee peer addresses (recovered from the post-cancel
 *       snapshot, since cancel is a soft delete).
 *
 * The factory returns `afterCallSkill(appOrigin, opId, args, result)`
 * — a thin hook the platform calls after each successful dispatch.
 * Returns a promise that resolves when all cross-peer effects have
 * settled (or rejected, individually swallowed).  Non-calendar ops
 * pass through as no-ops.
 *
 * Deps:
 *   - `callSkill(appOrigin, opId, args)` — for the `getEventSnapshot`
 *     lookup (we need the snapshot to construct the invite payload +
 *     to find the organiser NKN for the RSVP path).
 *   - `sendPeer(addr, payload)` — fire the envelope (agent.sendPeerMessage
 *     on both platforms).
 *   - `isPeerConnected() → boolean` — gate so we don't try to send
 *     when NKN isn't up.  Cheap; both platforms have it.
 *   - `publishEvent(event)` — optional; emits a /logs notification
 *     for "📤 invite sent" / "❌ invite failed" diagnostics.
 *
 * NOTE: the snapshot read uses the `calendar` appOrigin (not
 * 'household'/'calendar_X' as web's call-skill does internally) —
 * because we call BACK through the SAME `callSkill` dependency we
 * received.  Each platform's callSkill knows how to route 'calendar'.
 */

const RSVP_OP_TO_RESPONSE = Object.freeze({
  rsvpAccept:    'accepted',
  rsvpDecline:   'declined',
  rsvpTentative: 'tentative',
});

/**
 * Wrap a platform `callSkill` so a SUCCESSFUL calendar dispatch fans its
 * invite/RSVP envelopes out over the peer transport — the shared seam the v2
 * web launcher AND mobile use (the classic web shell wires the same hook inline
 * around its own callSkill wrapper). Non-calendar ops pass straight through.
 *
 * The hook's own `getEventSnapshot` lookups use the RAW (unwrapped) `callSkill`
 * passed here, so there's no re-entrancy. Fan-out is gated on `isPeerConnected`
 * — when the transport is down it's a logged no-op (you can still create events
 * locally), exactly like the classic shell.
 *
 * @param {(appOrigin:string, opId:string, args?:object)=>Promise<*>} callSkill  the platform callSkill (raw)
 * @param {object} deps  forwarded to makeCalendarOutboundHook (sendPeer, isPeerConnected, publishEvent, logger)
 * @returns {(appOrigin:string, opId:string, args?:object)=>Promise<*>} a drop-in callSkill
 */
export function withCalendarOutbound(callSkill, deps = {}) {
  if (typeof callSkill !== 'function') throw new Error('withCalendarOutbound: callSkill required');
  const logger = deps.logger ?? console;
  const hook = makeCalendarOutboundHook({ callSkill, ...deps, logger });
  // the call's context (a self it is made as, the selves it reads for) is passed on, never dropped
  return async function callSkillWithCalendarOutbound(appOrigin, opId, args, ctx) {
    const result = await (ctx === undefined ? callSkill(appOrigin, opId, args) : callSkill(appOrigin, opId, args, ctx));
    if (appOrigin === 'calendar') {
      try { await hook(appOrigin, opId, args ?? {}, result); }
      catch (err) { logger.warn?.('[calendar-outbound] hook failed', err); }
    }
    return result;
  };
}

/**
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args?: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                   args.sendPeer
 * @param {() => boolean}                                                    [args.isPeerConnected]
 * @param {(event: object) => void}                                          [args.publishEvent]
 * @param {{info?, warn?, error?}}                                           [args.logger]
 * @returns {(appOrigin: string, opId: string, args: object, result: object) => Promise<void>}
 */
export function makeCalendarOutboundHook({
  callSkill, sendPeer, isPeerConnected, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeCalendarOutboundHook: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeCalendarOutboundHook: sendPeer required');

  const peerUp = () =>
    typeof isPeerConnected !== 'function' ? true : !!isPeerConnected();

  return async function afterCallSkill(appOrigin, opId, dispatchArgs, result) {
    if (appOrigin !== 'calendar') return;
    if (!result?.ok) return;

    // (a) addEvent with attendees-addr → send calendar-invite envelopes.
    if (opId === 'addEvent' && dispatchArgs?.['attendees-addr']) {
      const targets = String(dispatchArgs['attendees-addr']).split(/[,\s]+/)
        .map((s) => s.trim()).filter(Boolean);
      if (targets.length === 0)  return;
      if (!peerUp()) {
        logger.warn?.('[calendar-outbound] skipped invite fan-out — peer transport not connected');
        return;
      }
      let snapshot = null;
      try {
        snapshot = await callSkill('calendar', 'getEventSnapshot', { id: result.itemId });
      } catch (err) {
        logger.error?.('[calendar-outbound] getEventSnapshot for invite-fan-out failed', err);
        return;
      }
      if (!snapshot?.id) return;
      const eventPayload = {
        id:        snapshot.id,
        title:     snapshot.title,
        startsAt:  snapshot.startAt,
        endsAt:    snapshot.endAt,
        location:  snapshot.location,
        attendees: snapshot.fields?.attendees
          ? String(snapshot.fields.attendees).split(/,\s*/)
          : [],
        organiser: snapshot.fields?.organiser,
      };
      for (const target of targets) {
        try {
          await sendPeer(target, {
            type:    'p2p-chat',
            subtype: 'calendar-invite',
            event:   eventPayload,
            sentAt:  Date.now(),
          });
          publishEvent?.({
            app: 'calendar', type: 'notification',
            payload: { message: `📤 invite sent to ${String(target).slice(0, 16)}…` },
          });
        } catch (err) {
          logger.error?.('[calendar-outbound] invite send failed', target, err);
          publishEvent?.({
            app: 'calendar', type: 'notification',
            payload: { message: `❌ invite send failed: ${err?.message ?? err}` },
          });
        }
      }
      return;
    }

    // (b) rsvp* with success on an event whose organiser is an NKN
    //     address → send calendar-rsvp envelope back.  The organiser
    //     NKN is stashed in snapshot.fields.organiser by the receiver's
    //     `calendar-invite` ingest (handleCalendarInvite sets
    //     `organiser: event.organiser ?? fromPeerAddr`).
    const rsvpResponse = RSVP_OP_TO_RESPONSE[opId];
    if (rsvpResponse && dispatchArgs?.id) {
      if (!peerUp()) {
        logger.warn?.('[calendar-outbound] skipped RSVP fan-out — peer transport not connected');
        return;
      }
      let snapshot = null;
      try {
        snapshot = await callSkill('calendar', 'getEventSnapshot', { id: dispatchArgs.id });
      } catch (err) {
        logger.error?.('[calendar-outbound] getEventSnapshot for RSVP fan-out failed', err);
        return;
      }
      const organiser = snapshot?.fields?.organiser;
      // Only send when organiser looks like an peer address (not a webid).
      if (!organiser || typeof organiser !== 'string' || organiser.startsWith('webid:')) return;
      try {
        await sendPeer(organiser, {
          type:    'p2p-chat',
          subtype: 'calendar-rsvp',
          eventId: dispatchArgs.id,
          response: rsvpResponse,
          sentAt:  Date.now(),
        });
        publishEvent?.({
          app: 'calendar', type: 'notification',
          payload: { message: `📤 RSVP ${rsvpResponse} sent to ${organiser.slice(0, 16)}…` },
        });
      } catch (err) {
        logger.error?.('[calendar-outbound] RSVP send failed', err);
      }
      return;
    }

    // (c) cancelEvent — fan a `calendar-cancel` envelope out to the event's
    //     invitees so the cancellation propagates.  cancel is a SOFT delete
    //     (state → 'cancelled', record kept), so the snapshot is still
    //     readable post-cancel; the attendees' peer addresses were persisted at
    //     addEvent time (CalendarStore `attendeeAddrs`) and surface in
    //     snapshot.fields.attendeeAddrs.  No attendeeAddrs (e.g. a solo event, or
    //     one created before this shipped) → nothing to notify.
    if (opId === 'cancelEvent' && dispatchArgs?.id) {
      let snapshot = null;
      try {
        snapshot = await callSkill('calendar', 'getEventSnapshot', { id: dispatchArgs.id });
      } catch (err) {
        logger.error?.('[calendar-outbound] getEventSnapshot for cancel fan-out failed', err);
        return;
      }
      const targets = snapshot?.fields?.attendeeAddrs
        ? String(snapshot.fields.attendeeAddrs).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : [];
      if (targets.length === 0) {
        publishEvent?.({
          app: 'calendar', type: 'notification',
          payload: { message: `🗑 event cancelled (no invitees to notify): ${dispatchArgs.id}` },
        });
        return;
      }
      if (!peerUp()) {
        logger.warn?.('[calendar-outbound] skipped cancel fan-out — peer transport not connected');
        return;
      }
      for (const target of targets) {
        try {
          await sendPeer(target, {
            type:    'p2p-chat',
            subtype: 'calendar-cancel',
            eventId: dispatchArgs.id,
            title:   snapshot.title,
            sentAt:  Date.now(),
          });
          publishEvent?.({
            app: 'calendar', type: 'notification',
            payload: { message: `📤 cancellation sent to ${String(target).slice(0, 16)}…` },
          });
        } catch (err) {
          logger.error?.('[calendar-outbound] cancel send failed', target, err);
        }
      }
    }
  };
}
