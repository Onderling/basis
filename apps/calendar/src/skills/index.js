/**
 * @onderling-app/calendar — skill registrations.
 *
 * `registerCalendarSkills(agent, store, opts)` registers every
 * manifest-declared op as an agent skill backed by `CalendarStore`.
 * Used by `createCalendarAgent` AND by basis (which composes
 * the same skills onto its in-process hostAgent for the v0.7.10
 * demo).
 *
 * Skill signature follows @onderling/core convention: handler receives
 * `{ parts }` with the first DataPart's `data` carrying the args
 * (the chat-shell's callSkill wraps args in a DataPart).
 */

import { DataPart } from '@onderling/core';

/**
 * @param {import('@onderling/core').Agent}     agent
 * @param {import('../CalendarStore.js').CalendarStore} store
 * @param {object}  [opts]
 * @param {() => object} [opts.simulateSync]   v0.6 sync hint shape
 * @param {(event: object) => void} [opts.publishEvent]
 *   v0.7.7 notifier event publisher (item-changed on add/cancel/rsvp).
 */
export function registerCalendarSkills(agent, store, opts = {}) {
  const simulateSync = typeof opts.simulateSync === 'function'
    ? opts.simulateSync : () => undefined;
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent : () => {};
  // v0.7.10 — optional prefix to disambiguate when multiple apps
  // share a hostAgent (e.g. briefSummary, searchEvents).  Caller
  // passes 'calendar_' to register as 'calendar_briefSummary' etc;
  // remaps live in basis's main.js callSkill.
  const prefix = typeof opts.skillPrefix === 'string' ? opts.skillPrefix : '';
  const reg = (name, fn) => agent.register(`${prefix}${name}`, fn);

  // v0.7.12 — multi-pod RSVP coordination.  Caller (basis
  // main.js) wires an inviteAttendee callback that posts an invite
  // embed to each attendee's thread (sim-peer in the demo; real
  // cross-pod chat-p2p in production).  Signature:
  //   inviteAttendee(webid, snapshot) → Promise<void>
  const inviteAttendee = typeof opts.inviteAttendee === 'function'
    ? opts.inviteAttendee : null;

  reg('addEvent', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    try {
      const event = await store.addEvent(a);
      // v0.7.-followup 2026-05-23: routed event message is DIFFERENT
      // from the dispatch reply.  Old code used the same text on both
      // ('✓ Added event: X') which caused visible duplication if a
      // thread filter mis-accepted item-changed events.  Now: routed
      // event says '📝 Calendar updated: <title>' (a feed-style note),
      // dispatch reply keeps '✓ Added event: ...' (a user-action ack).
      publishEvent({
        app: 'calendar', type: 'item-changed',
        actor: a.actor ?? 'webid:local-demo-user',
        itemRef: { app: 'calendar', type: 'calendar-event', id: event.id },
        payload: { message: `📝 Calendar updated: ${event.title}` },
      });

      // v0.7.12 — dispatch invites to attendees.  Each gets the
      // event card in their own thread; they RSVP via the embed's
      // [Accept]/[Decline]/[Tentative] buttons (manifest-driven
      // since v0.7.13).  Responses broadcast back via the
      // calendar's rsvp* skills (which already publishEvent + the
      // organiser's open record panels go stale per v0.6.3
      // reactive refresh).
      let invitedCount = 0;
      if (inviteAttendee && Array.isArray(event.attendees)) {
        const snapshot = buildInviteSnapshot(event);
        for (const webid of event.attendees) {
          try {
            await inviteAttendee(webid, snapshot);
            invitedCount += 1;
          } catch { /* per-attendee failures shouldn't block the event */ }
        }
      }

      return [DataPart({
        ok:      true,
        message: invitedCount > 0
          ? `✓ Added event: ${event.title}  (sent invitation to ${invitedCount} ${invitedCount === 1 ? 'attendee' : 'attendees'})`
          : `✓ Added event: ${event.title}`,
        itemId:  event.id,
        _sync:   simulateSync(),
      })];
    } catch (err) {
      return [DataPart({ ok: false, error: err.message })];
    }
  });

  reg('listEvents', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const days = typeof a.days === 'number' ? a.days : 90;
    const since = Date.now();
    const until = since + days * 86_400_000;
    const events = await store.listInRange({ since, until });
    // v0.7.P3c-followup 2026-05-23: include rsvp summary in each
    // row label so the user can see at a glance which events
    // they've accepted/declined/tentative-RSVP'd to.  Three
    // sources for 'me':
    //   1. webid:local-demo-user           (default actor)
    //   2. an explicit args.actor          (rare; future)
    //   3. ANY of the rsvp keys — if event has only one rsvp,
    //      assume it's the user's
    const meActor = a.actor ?? 'webid:local-demo-user';
    return [DataPart({
      items: events.map((e) => ({
        id:    e.id,
        label: formatEventLabel(e, meActor),
        type:  'calendar-event',
        state: e.state ?? 'open',
      })),
      _sync: simulateSync(),
    })];
  });

  reg('rsvpAccept',    async (args) => rsvpHandler(args, 'accepted',  store, simulateSync, publishEvent));
  reg('rsvpDecline',   async (args) => rsvpHandler(args, 'declined',  store, simulateSync, publishEvent));
  reg('rsvpTentative', async (args) => rsvpHandler(args, 'tentative', store, simulateSync, publishEvent));

  reg('cancelEvent', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    try {
      await store.cancel({ eventId: a.id, actor: a.actor });
      publishEvent({
        app: 'calendar', type: 'item-changed',
        actor: a.actor ?? 'webid:local-demo-user',
        itemRef: { app: 'calendar', type: 'calendar-event', id: a.id },
        payload: { message: `✓ Cancelled event ${a.id}` },
      });
      return [DataPart({ ok: true, message: `✓ Event cancelled.`, itemId: a.id, _sync: simulateSync() })];
    } catch (err) {
      return [DataPart({ ok: false, error: err.message })];
    }
  });

  reg('getEventSnapshot', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const event = await store.getById(a.id);
    if (!event) return [DataPart({ ok: false, error: `No event with id "${a.id}".` })];
    const rsvp = event.rsvp ?? {};
    const summary = Object.keys(rsvp).length === 0
      ? null
      : Object.entries(rsvp).map(([w, r]) => `${w}: ${r}`).join(', ');
    return [DataPart({
      id:    event.id,
      type:  'calendar-event',
      state: event.state ?? 'open',
      title: event.title,
      // Time-card renderer reads these:
      startAt:  event.startsAt,
      endAt:    event.endsAt,
      ...(event.location ? { location: event.location } : {}),
      fields: {
        state:     event.state ?? 'open',
        organiser: event.organiser ?? 'unknown',
        ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
        // attendees' peer addresses — used by the cross-peer cancel fan-out to
        // notify invitees when an event is cancelled (event is soft-deleted, so
        // the snapshot is still readable post-cancel).
        ...(event.attendeeAddrs?.length ? { attendeeAddrs: event.attendeeAddrs.join(', ') } : {}),
        ...(summary ? { rsvp: summary } : {}),
      },
    })];
  });

  reg('briefSummary', async () => {
    const since = Date.now();
    const until = since + 86_400_000;        // today + tomorrow window
    const events = await store.listInRange({ since, until });
    if (events.length === 0) return [DataPart({ ok: true })];   // skipped by /brief
    return [DataPart({
      items:   events.slice(0, 5).map((e) => ({ id: e.id, label: `${formatDate(e.startsAt)} ${e.title}` })),
      message: `${events.length} upcoming event${events.length === 1 ? '' : 's'}`,
    })];
  });

  reg('podStatus', async () => {
    const st = typeof store.getPodStatus === 'function' ? store.getPodStatus() : null;
    if (!st) {
      return [DataPart({ message: 'Pod status not available (store lacks getPodStatus).' })];
    }
    const lines = ['Pod-write status:'];
    lines.push(`  Writer wired: ${st.writerWired ? 'yes' : 'no'}`);
    if (st.writerWired) {
      lines.push(`  WebID:        ${st.writerWebid}`);
      lines.push(`  Pod root:     ${st.writerPodRoot}`);
      lines.push(`  Feed URL:     ${st.writerUrl}`);
    }
    lines.push(`  Attempts:     ${st.attempts}`);
    lines.push(`  Errors:       ${st.errorCount}`);
    if (st.lastResult) {
      lines.push(`  Last result:  HTTP ${st.lastResult.status}${st.lastResult.containerCreated ? ' (container created)' : ''} ${st.lastResult.ok ? '✓' : '✗'}`);
    }
    if (st.lastError) {
      lines.push(`  Last error:   ${st.lastError}`);
    }
    if (!st.writerWired) {
      lines.push('');
      lines.push('Hint: /signin first to wire the pod writer.');
    } else if (st.attempts === 0) {
      lines.push('');
      lines.push('Hint: /addappt to trigger the first write.');
    } else if (st.errorCount > 0 && st.errorCount === st.attempts) {
      lines.push('');
      lines.push('All writes have failed.  Likely causes:');
      lines.push('  - Pod ACL: the onderling/ path may not be writable for this WebID');
      lines.push('  - CORS: the pod may not allow cross-origin authenticated PUTs');
      lines.push('  - 404: parent container missing (v0.7.P2.1 tries to auto-create)');
    }
    return [DataPart({ message: lines.join('\n') })];
  });

  reg('getIcsFeed', async () => {
    const { ics, uri: localUri } = await store.getIcsFeed();
    const eventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    // v0.7. — when signed in + podWriter wired, surface the REAL
    // pod URL as the subscribable feed.  Local pseudo-pod URI is
    // shown as a fallback when not signed in.
    const podUri = store.getPodFeedUrl?.();
    const lines = [
      `iCal feed for your calendar (${eventCount} event${eventCount === 1 ? '' : 's'}):`,
    ];
    if (podUri) {
      lines.push(`  ${podUri}  ← subscribable URL (your pod)`);
      lines.push('');
      lines.push('Subscribe from Apple Calendar / Google Calendar / Proton.');
      lines.push('Updated automatically on every event change.');
    } else {
      lines.push(`  ${localUri}`);
      lines.push('');
      lines.push('Local pseudo-pod URL.  /signin to write through to your real pod.');
    }
    return [DataPart({ message: lines.join('\n') })];
  });

  reg('searchEvents', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '');
    const hits = await store.search(q);
    return [DataPart({
      items: hits.map((e) => ({
        id:    e.id,
        label: `${formatDate(e.startsAt)} · ${e.title}`,
        type:  'calendar-event',
      })),
    })];
  });
}

async function rsvpHandler({ parts }, response, store, simulateSync, publishEvent) {
  const a = parts?.[0]?.data ?? {};
  const actor = a.actor ?? 'webid:local-demo-user';
  try {
    const event = await store.rsvp({ eventId: a.id, actor, response });
    publishEvent({
      app: 'calendar', type: 'item-changed',
      actor,
      itemRef: { app: 'calendar', type: 'calendar-event', id: a.id },
      payload: { message: `${actor} ${response}: ${event.title}` },
    });
    return [DataPart({
      ok:      true,
      message: `✓ ${capitalize(response)}: ${event.title}`,
      itemId:  a.id,
      _sync:   simulateSync(),
    })];
  } catch (err) {
    return [DataPart({ ok: false, error: err.message })];
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * v0.7.12 — build the snapshot the inviteAttendee callback embeds
 * in each attendee's thread.  Same shape as getEventSnapshot's
 * output so the time-card renderer + appliesTo gating work
 * unchanged on the receiver side.
 */
function buildInviteSnapshot(event) {
  return {
    id:    event.id,
    type:  'calendar-event',
    state: 'open',
    title: event.title,
    startAt:  event.startsAt,
    endAt:    event.endsAt,
    ...(event.location ? { location: event.location } : {}),
    fields: {
      state:     'open',
      organiser: event.organiser ?? 'unknown',
      ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
    },
  };
}

/**
 * v0.7.P3c-followup — render a row label that surfaces the user's
 * RSVP status when known.  Examples:
 *   '5/24 13:00 · Beer'              (no RSVP)
 *   '5/24 13:00 · Beer (✓ accepted)' (you accepted)
 *   '5/24 13:00 · Beer (✗ declined)'
 *   '5/24 13:00 · Beer (? tentative)'
 *   '5/24 13:00 · Beer ✓anne ✗karl' (multi-attendee RSVPs visible)
 */
function formatEventLabel(event, meActor) {
  const base = `${formatDate(event.startsAt)} · ${event.title}`;
  const rsvp = event.rsvp ?? {};
  const entries = Object.entries(rsvp);
  if (entries.length === 0) return base;
  // Your own RSVP gets a prominent suffix; other attendees a smaller mark.
  const mine = rsvp[meActor];
  let suffix = '';
  if (mine) {
    const sym = mine === 'accepted' ? '✓' : mine === 'declined' ? '✗' : '?';
    suffix += ` (${sym} ${mine})`;
  }
  const others = entries.filter(([who]) => who !== meActor);
  if (others.length > 0) {
    const otherStr = others.map(([who, resp]) => {
      const s = resp === 'accepted' ? '✓' : resp === 'declined' ? '✗' : '?';
      const shortWho = who.length > 18 ? `${who.slice(0, 14)}…` : who;
      return `${s}${shortWho}`;
    }).join(' ');
    suffix += `  [${otherStr}]`;
  }
  return base + suffix;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  } catch {
    return String(iso);
  }
}
