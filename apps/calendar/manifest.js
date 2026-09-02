/**
 * @onderling-app/calendar — manifest.
 *
 * Declarative slash + chat surface for the calendar app.  v0.7.10
 * is in-process + in-memory; the same manifest works unchanged when
 * v0.7.11 swaps the storage to a real Solid pod (per the substrate
 * convention).
 *
 * Item type: 'calendar-event' (canonical, from @onderling/item-types).
 * RSVP states: an event's lifecycle uses ItemStore's state field +
 * a per-attendee response map (open / claimed = accepted / declined
 * / tentative).  Cancelling an event uses ItemStore.markComplete
 * with state 'cancelled' (mapped onto removal in v0.7.11 RDF).
 *
 * Phase v0.7 per `/Project Files/basis/coding-plan.md`.
 */

export const calendarManifest = {
  app:        'calendar',
  itemTypes:  ['calendar-event'],

  // B · Layer 1 — every op maps to an SDK atom (no domain-specific verbs).
  domainVerbs: [],

  // B · Layer 1 — DECLARED-AUTHORITATIVE (verb × noun) capability surface (docs/decisions.md 2026-07-02;
  // PLAN-capability-arc §1a). This declaration IS the member-facing capability set. Equals the current derived
  // set (inert), now explicit + owned here.
  nouns: {
    'calendar-event': { atoms: ['add', 'list', 'remove', 'claim', 'submit', 'reject'] },
  },

  operations: [
    /**
     * `/addappt` — create an event.  Required: title, startsAt.
     * Optional: endsAt (default startsAt + 1h), location, attendees
     * (comma-separated webids), notes.
     */
    {
      id:    'addEvent', group: 'compose',
      verb:  'add',
      appliesTo: { type: 'calendar-event' },
      // v0.7.-followup 2026-05-23 (3rd pass): renamed startsAt →
      // 'when' for slash-arg ergonomics.  User-typed
      // `/addappt --when='tomorrow 3pm'` now matches the param name.
      // CalendarStore accepts both internally for back-compat.
      // Aliased: 'startsAt' still works for any existing callers.
      params: [
        { name: 'title',         kind: 'string', required: true  },
        { name: 'when',          kind: 'date',   required: true  },
        { name: 'duration',      kind: 'string', required: false },
        { name: 'location',      kind: 'string', required: false },
        { name: 'attendees',     kind: 'string', required: false },
        // v0.7.P3c — comma-separated NKN addresses to invite via
        // chat-p2p envelopes.  Each gets a 'calendar-invite'
        // envelope; their basis surfaces a time-card embed
        // with [Accept]/[Decline]/[Tentative] that RSVPs back.
        { name: 'attendees-addr', kind: 'string', required: false },
      ],
      surfaces: {
        // Part C gate — "schedule X" / "afspraak X" → addEvent{title}. PARTIAL: binds title; the
        // required `when` (a date) is form-elicited.
        slash: { command: '/addappt', body: 'flags',
          match: { verbs: ['schedule', ['add', 'event'], ['new', 'event'], ['add', 'appointment'], ['new', 'appointment'], 'afspraak', 'plan', ['zet', 'afspraak'], ['nieuwe', 'afspraak']], body: 'text-only', arg: 'title', dropTrailing: ['to', 'with', 'op', 'met'] } },
        chat:  { reply: 'text', hint: 'create an appointment' },
      },
    },

    /**
     * `/upcoming` — list events with startsAt in [now, now + window).
     * Optional `days` flag (default 7).
     */
    {
      id:    'listEvents', group: 'data',
      verb:  'list',
      appliesTo: { type: 'calendar-event' },
      params: [
        { name: 'days', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/upcoming', body: 'flags' },
        chat:  {
          reply: 'list',
          hint:  'list upcoming events',
          // calendar's slot in the morning brief.
          brief: { summarySkill: 'briefSummary', order: 15, label: 'Calendar' },
          // searchable from /find.
          search: { searchSkill: 'searchEvents' },
        },
      },
    },

    /* ──── RSVP receiver actions (appliesTo-gated buttons) ──── */
    /**
     * `[Accept]` button on the time-card / mini-page when the
     * viewing user is in the event's attendees list AND their
     * response isn't already 'accepted'.
     */
    {
      id:    'rsvpAccept',
      verb:  'claim',
      // Receiver-only: appears on open events the viewer is invited to.
      appliesTo: { type: 'calendar-event', state: ['open'] },
      params: [
        { name: 'id', kind: 'string', required: true,
          // v0.7. — bare /accept / /decline / /tentative /
          // /cancelappt → form with event picker.
          pickerSource: { listOp: 'listEvents' } },
      ],
      surfaces: {
        // Part C gate — owns 'accept' (collision vs tasks.approveTask, which keeps approve/goedkeuren).
        slash: { command: '/accept',
          // 'ik kom' dropped — it's a prefix of rsvpDecline's 'ik kom niet' (would eat the decline).
          match: { verbs: ['accept', ['accept', 'invite'], 'yes', 'accepteer', 'ja'], body: 'match', arg: 'id' } },
        ui:    { control: 'button', label: 'Accept' },
        chat:  { hint: 'accept an invitation' },
      },
    },
    {
      id:    'rsvpDecline',
      verb:  'reject',
      appliesTo: { type: 'calendar-event', state: ['open'] },
      params: [
        { name: 'id', kind: 'string', required: true,
          // v0.7. — bare /accept / /decline / /tentative /
          // /cancelappt → form with event picker.
          pickerSource: { listOp: 'listEvents' } },
      ],
      surfaces: {
        // Part C gate — keeps 'decline' (bare 'reject'/'afwijzen' belong to tasks.rejectTask).
        slash: { command: '/decline',
          match: { verbs: ['decline', ['decline', 'invite'], 'no', ['wijs', 'af'], 'nee', ['ik', 'kom', 'niet']], body: 'match', arg: 'id' } },
        ui:    { control: 'button', label: 'Decline' },
        chat:  { hint: 'decline an invitation' },
      },
    },
    {
      id:    'rsvpTentative',
      verb:  'submit',     // approximate; ItemStore.submit is the closest contract
      appliesTo: { type: 'calendar-event', state: ['open'] },
      params: [
        { name: 'id', kind: 'string', required: true,
          // v0.7. — bare /accept / /decline / /tentative /
          // /cancelappt → form with event picker.
          pickerSource: { listOp: 'listEvents' } },
      ],
      surfaces: {
        // Part C gate — "tentative/maybe X" → rsvpTentative{id}.
        slash: { command: '/tentative',
          match: { verbs: ['tentative', 'maybe', 'misschien', ['onder', 'voorbehoud']], body: 'match', arg: 'id' } },
        ui:    { control: 'button', label: 'Tentative' },
        chat:  { hint: 'mark as tentative' },
      },
    },
    {
      id:    'cancelEvent',
      verb:  'remove',
      appliesTo: { type: 'calendar-event', state: ['open'] },
      params: [
        { name: 'id', kind: 'string', required: true,
          // v0.7. — bare /accept / /decline / /tentative /
          // /cancelappt → form with event picker.
          pickerSource: { listOp: 'listEvents' } },
      ],
      surfaces: {
        // Part C gate — owns 'cancel' (multiword 'cancel event' before bare 'cancel'; vs household.removeChore).
        slash: { command: '/cancelappt',
          match: { verbs: [['cancel', 'event'], ['cancel', 'appointment'], 'cancel', ['annuleer', 'afspraak'], 'annuleer', ['zeg', 'af']], body: 'match', arg: 'id' } },
        ui:    {
          control: 'button',
          label:   'Cancel event',
          confirm: { severity: 'warn', message: 'Cancel this event?' },
        },
        chat: { hint: 'cancel an event (organiser only)' },
      },
    },

    /* ──── Snapshot + search ──── */
    /**
     * `getEventSnapshot(id)` — cardSnapshotSkill for /embed-time.
     */
    {
      id:    'getEventSnapshot',
      verb:  'list',
      appliesTo: { type: 'calendar-event' },
      params: [
        { name: 'id', kind: 'string', required: true,
          // v0.7. — bare /accept / /decline / /tentative /
          // /cancelappt → form with event picker.
          pickerSource: { listOp: 'listEvents' } },
      ],
      // Substrate, not a door: the card machinery reads this back (`cardSnapshotSkill`) whenever a
      // composer embeds one — no person ever taps "snapshot". `internal` takes it out of coverage and
      // out of the Advanced drawer. Internal ≠ unused; it is called on every embed.
      surfaces: { internal: true },
    },

    /**
     * `briefSummary` — contributor.
     */
    {
      id:    'briefSummary', group: 'data',
      verb:  'list',
      params: [],
      surfaces: {
        chat: { hint: 'calendar slot of the morning brief' },
      },
    },

    /**
     * `searchEvents` — contributor. Text match on title +
     * location.
     */
    {
      id:    'searchEvents', group: 'data',
      verb:  'list',
      params: [
        { name: 'query', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { hint: 'text search across calendar events' },
      },
    },

    /**
     * `/pod-status` — v0.7.. Returns the current pod-write
     * diagnostic state (writer wired? last write OK? errors?).
     * Critical for troubleshooting why a pod might not have
     * received writes.
     */
    {
      id:    'podStatus', group: 'data',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/pod-status' },
        chat:  { reply: 'text', hint: 'show calendar pod-write diagnostics' },
      },
    },

    /**
     * `getIcsFeed` — v0.7.11.  Returns the calendar's iCal feed URI
     * (and on request, the body) so users can paste it into Apple
     * Calendar / Google Calendar / Proton as a subscription URL.
     * v0.7.11 ships the local pseudo-pod URI; a real pod attach
     * makes the same feed externally reachable.
     */
    {
      id:    'getIcsFeed', group: 'data',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/icalfeed' },
        chat:  { reply: 'text', hint: 'get the iCal subscription URL' },
      },
    },
  ],

  views: [
    {
      id:     'upcoming',
      title:  'Upcoming events',
      type:   'calendar-event',
      shape:  'list',
    },
  ],
};

// declaration: addEvent surfaces as embeddable via getEventSnapshot.
// /embed-time → calendar.addEvent → returns event → /embed renders card.
calendarManifest.operations.find((o) => o.id === 'addEvent')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getEventSnapshot' };

export default calendarManifest;
