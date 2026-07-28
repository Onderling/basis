/**
 * @onderling-app/calendar — CalendarStore.
 *
 * v0.7.10 implementation note (2026-05-23): originally scoped to
 * compose `@onderling/item-store/ItemStore` over `@onderling/pseudo-pod`.
 * In practice ItemStore.#materialise whitelists only the canonical
 * task/post/claim fields it knows about — calendar-event's custom
 * fields (`startsAt`, `endsAt`, `attendees`, `rsvp`, `location`)
 * get stripped on persist.  The architectural mismatch: ItemStore
 * is for items with the household/tasks/stoop shape, not arbitrary
 * typed items.
 *
 * For v0.7.10 we use `@onderling/pseudo-pod` DIRECTLY: each event is
 * a JSON record at `pseudo-pod://<deviceId>/calendar/events/<id>.json`.
 * Same Solid-shape API; same forward-compat with the v0.7.11 pod
 * swap.  Audit + role-policy + per-field-merge that ItemStore would
 * have provided land later via either:
 *   (a) extending ItemStore's #materialise to honour per-type
 *       allow-lists OR
 *   (b) keeping pseudo-pod direct + adding audit + role layers in
 *       calendar-app-specific code (simpler if calendar's needs
 *       diverge from tasks/household).
 *
 * Substrate-reuse gate noted this gap; v0.7.11 design call.
 *
 * Item shape:
 *   {
 *     id, type: 'calendar-event', title, startsAt, endsAt,
 *     location?, attendees: [webid...], organiser,
 *     rsvp: { '<webid>': 'accepted' | 'declined' | 'tentative' },
 *     state: 'open' | 'cancelled',
 *     addedAt, addedBy,
 *     cancelledAt?, cancelledBy?,
 *   }
 */

import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { buildIcsForEvents }                    from '@onderling/calendar-emission';
import * as chrono                              from 'chrono-node';

const TYPE      = 'calendar-event';
const DEVICE_ID    = 'calendar-demo';
const ROOT         = `pseudo-pod://${DEVICE_ID}/calendar/events/`;
// v0.7.11 — iCal feed lives next to the events container so a
// real-pod attach (cache mode) makes the same URI fetchable as
// `<pod>/calendar/feed.ics` via the @onderling/calendar-emission
// convention.
const ICS_FEED_URI = `pseudo-pod://${DEVICE_ID}/calendar/feed.ics`;

/**
 * @typedef {object} CalendarEvent
 * @property {string}        id
 * @property {'calendar-event'} type
 * @property {string}        title
 * @property {string}        startsAt           ISO-8601 datetime
 * @property {string}        endsAt             ISO-8601 datetime
 * @property {string}        [location]
 * @property {string[]}      attendees          webids
 * @property {string}        organiser          webid
 * @property {Object<string, 'accepted'|'declined'|'tentative'>} rsvp
 * @property {'open'|'cancelled'} state
 * @property {number}        addedAt
 * @property {string}        addedBy
 * @property {number}        [cancelledAt]
 * @property {string}        [cancelledBy]
 */

export class CalendarStore {
  /** @type {import('@onderling/pseudo-pod').PseudoPod} */
  #pod;
  /** @type {string} */
  #actorDefault;
  /** @type {object|null} v0.7. — pod write-through target */
  #podWriter;
  /** v0.7. — last write outcome + recorded errors, for diagnostics. */
  #podStatus = { lastResult: null, errorCount: 0, lastError: null, attempts: 0 };
  /** v0.7. — optional sink for pod-write events (basis router). */
  #podEventSink;

  /**
   * @param {object}  [opts]
   * @param {object}  [opts.pseudoPod]   pre-wired pseudo-pod; otherwise we build one in-memory
   * @param {string}  [opts.actor='webid:local-demo-user']
   * @param {string}  [opts.deviceId=DEVICE_ID]
   * @param {object} [opts.podWriter] v0.7. podStorage.createPodWriter result
   */
  constructor(opts = {}) {
    this.#pod = opts.pseudoPod ?? createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId: opts.deviceId ?? DEVICE_ID,
    });
    this.#actorDefault = opts.actor ?? 'webid:local-demo-user';
    this.#podWriter    = opts.podWriter ?? null;
  }

  /**
   * v0.7. — wire/unwire the pod-write target at runtime. The shell
   * chat calls this on sign-in / sign-out so calendar's .ics feed
   * writes-through to `<pod>/onderling/calendar/feed.ics`.
   *
   * @param {object|null} writer  result of podStorage.createPodWriter,
   *                                or null to disable write-through.
   */
  setPodWriter(writer) {
    this.#podWriter = writer ?? null;
    // Reset diagnostics on writer change so the user sees fresh status.
    this.#podStatus = { lastResult: null, errorCount: 0, lastError: null, attempts: 0 };
  }

  /**
   * v0.7. — optional event sink for pod-write events. When set,
   * each pod-write attempt fires a notification event (success or
   * failure) so the chat shell can route it to /logs + Main thread.
   *
   * Signature: (event: {kind, url, status, error?}) => void
   */
  setPodEventSink(sink) {
    this.#podEventSink = typeof sink === 'function' ? sink : null;
  }

  /** v0.7. — diagnostics for /pod-status. */
  getPodStatus() {
    return {
      writerWired:   !!this.#podWriter,
      writerUrl:     this.getPodFeedUrl(),
      writerWebid:   this.#podWriter?.webid ?? null,
      writerPodRoot: this.#podWriter?.podRoot ?? null,
      attempts:      this.#podStatus.attempts,
      errorCount:    this.#podStatus.errorCount,
      lastResult:    this.#podStatus.lastResult,
      lastError:     this.#podStatus.lastError,
    };
  }

  /** @returns {string|null} pod URL the feed write-throughs to (when wired). */
  getPodFeedUrl() {
    if (!this.#podWriter || typeof this.#podWriter.urlFor !== 'function') return null;
    return this.#podWriter.urlFor('calendar', 'feed.ics');
  }

  /**
   * v0.7.11 — return the current iCal feed string + the URI it
   * lives at on the pseudo-pod.  Subscribers (calendar apps) can
   * point at this URI; pod-attach makes it externally fetchable.
   *
   * @returns {Promise<{ ics: string, uri: string }>}
   */
  async getIcsFeed() {
    const events = await this.#readAll();
    const ics = buildIcsForEvents({
      events,
      calendarName: 'Onderling Calendar',
      prodId:       '-//onderling-app/calendar//EN',
    });
    return { ics, uri: ICS_FEED_URI };
  }

  /**
   * Create an event.  Returns the persisted item.
   *
   * @param {object} args
   * @returns {Promise<CalendarEvent>}
   */
  async addEvent(args = {}) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('CalendarStore.addEvent: title required');
    // v0.7.-followup (3rd pass): accept `when` (canonical 2026-05-23+)
    // OR `startsAt` (legacy alias).  Same for `until` / `endsAt`.
    const startsAt = parseDateInput(args.when ?? args.startsAt);
    if (!startsAt) throw new Error('CalendarStore.addEvent: when (or startsAt) required (ISO-8601)');
    // v0.7.-followup: duration as a string ('1h' / '30m' / '2h30m').
    // CalendarStore now also accepts an explicit until/endsAt + a
    // duration override.  Default: 1 hour.
    let endsAt = parseDateInput(args.until ?? args.endsAt);
    if (!endsAt && typeof args.duration === 'string') {
      const ms = parseDurationMs(args.duration);
      if (ms != null) {
        endsAt = new Date(new Date(startsAt).getTime() + ms).toISOString();
      }
    }
    if (!endsAt) {
      endsAt = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
    }
    const attendees = normaliseAttendees(args.attendees);
    const actor     = args.actor ?? this.#actorDefault;
    const organiser = args.organiser ?? actor;
    // Persist the attendees' peer addresses (the cross-peer fan-out routing
    // arg) so a later cancelEvent can recover whom to notify — the event is
    // soft-deleted on cancel, but `attendees-addr` is otherwise never stored.
    // Mirrors the `_organiserAddr` stash above it.
    const attendeeAddrs = String(args['attendees-addr'] ?? '')
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

    // v0.7.P3c — accept an explicit id (used by receiver-side when
    // ingesting an invite envelope; same id as organiser keeps the
    // RSVP round-trip referentially consistent).  Also accept
    // _organiserAddr so the receiver knows where to send the RSVP
    // back via NKN.
    const event = {
      id:        typeof args.id === 'string' && args.id ? args.id : generateId(),
      type:      TYPE,
      title,
      startsAt,
      endsAt,
      ...(args.location ? { location: String(args.location) } : {}),
      attendees,
      organiser,
      rsvp:    {},
      state:   'open',
      addedAt: Date.now(),
      addedBy: actor,
      ...(args._organiserAddr ? { _organiserAddr: String(args._organiserAddr) } : {}),
      ...(attendeeAddrs.length ? { attendeeAddrs } : {}),
    };

    await this.#write(event);
    await this.#refreshIcsFeed();
    return event;
  }

  /**
   * List events whose startsAt is in [since, until).
   *
   * @param {object} [opts]
   * @returns {Promise<CalendarEvent[]>}
   */
  async listInRange(opts = {}) {
    const since = toEpoch(opts.since) ?? Date.now();
    const until = toEpoch(opts.until) ?? (since + 7 * 86_400_000);
    const all = await this.#readAll();
    return all
      .filter((e) => e.state === 'open')
      .filter((e) => {
        const t = new Date(e.startsAt).getTime();
        return t >= since && t < until;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  /**
   * RSVP — record an attendee's response on the event.
   *
   * @param {{eventId: string, actor: string, response: 'accepted'|'declined'|'tentative'}} args
   * @returns {Promise<CalendarEvent>}
   */
  async rsvp({ eventId, actor, response }) {
    if (!['accepted', 'declined', 'tentative'].includes(response)) {
      throw new Error(`CalendarStore.rsvp: bad response "${response}"`);
    }
    const event = await this.getById(eventId);
    if (!event) throw new Error(`CalendarStore.rsvp: no event with id "${eventId}"`);
    const next = { ...event, rsvp: { ...(event.rsvp ?? {}), [actor]: response } };
    await this.#write(next);
    await this.#refreshIcsFeed();
    return next;
  }

  /**
   * Cancel an event.
   *
   * @param {{eventId: string, actor?: string}} args
   * @returns {Promise<{ id: string }>}
   */
  async cancel({ eventId, actor }) {
    const event = await this.getById(eventId);
    if (!event) throw new Error(`CalendarStore.cancel: no event with id "${eventId}"`);
    const next = {
      ...event,
      state:        'cancelled',
      cancelledAt:  Date.now(),
      cancelledBy:  actor ?? this.#actorDefault,
    };
    await this.#write(next);
    await this.#refreshIcsFeed();
    return { id: eventId };
  }

  /**
   * Search events by title / location substring.  Case-insensitive.
   *
   * @param {string} query
   * @returns {Promise<CalendarEvent[]>}
   */
  async search(query) {
    const q = String(query ?? '').toLowerCase().trim();
    if (!q) return [];
    const all = await this.#readAll();
    return all
      .filter((e) => e.state === 'open')
      .filter((e) =>
        e.title.toLowerCase().includes(q)
        || (e.location ?? '').toLowerCase().includes(q),
      );
  }

  /** Direct get by id. */
  async getById(id) {
    if (!id) return null;
    try {
      const raw = await this.#pod.read(`${ROOT}${id}.json`);
      return parseEvent(raw);
    } catch {
      return null;
    }
  }

  /* ─── internals ─────────────────────────────────────── */

  async #write(event) {
    await this.#pod.write(`${ROOT}${event.id}.json`, JSON.stringify(event), {
      contentType: 'application/json',
    });
  }

  /**
   * v0.7.11 — rebuild + persist the `.ics` feed on every mutation.
   * Subscribers (Apple Calendar etc) consume this single file.
   * Path matches the existing `<pod>/calendar/<source>.ics`
   * convention from `@onderling/calendar-emission`.
   */
  async #refreshIcsFeed() {
    let ics;
    try {
      ({ ics } = await this.getIcsFeed());
      await this.#pod.write(ICS_FEED_URI, ics, { contentType: 'text/calendar' });
    } catch {
      // Local pseudo-pod failure shouldn't block; in-memory state
      // is canonical.
      return;
    }
    // v0.7. — write-through to real pod when signed in.
    if (this.#podWriter && typeof this.#podWriter.write === 'function') {
      this.#podStatus.attempts += 1;
      let result;
      try {
        result = await this.#podWriter.write('calendar', 'feed.ics', ics, 'text/calendar');
        this.#podStatus.lastResult = result;
      } catch (err) {
        const msg = err?.message ?? String(err);
        this.#podStatus.errorCount += 1;
        this.#podStatus.lastError   = msg;
        this.#podStatus.lastResult  = null;
        if (typeof console !== 'undefined') {
          console.warn('[calendar.podWrite] threw', msg);
        }
        if (this.#podEventSink) {
          try { this.#podEventSink({ kind: 'pod-write-error', url: this.getPodFeedUrl(), error: msg }); } catch { /* defensive */ }
        }
        return;
      }
      if (result && !result.ok) {
        this.#podStatus.errorCount += 1;
        this.#podStatus.lastError   = `HTTP ${result.status}${result.errorBody ? ' — ' + result.errorBody : ''}`;
        if (typeof console !== 'undefined') {
          console.warn('[calendar.podWrite] HTTP', result.status, result.errorBody ?? '(no body)');
        }
        if (this.#podEventSink) {
          try { this.#podEventSink({ kind: 'pod-write-error', url: result.url, status: result.status, error: this.#podStatus.lastError }); } catch { /* defensive */ }
        }
        return;
      }
      // Success.
      if (this.#podEventSink) {
        try { this.#podEventSink({ kind: 'pod-write-ok', url: result.url, status: result.status }); } catch { /* defensive */ }
      }
    }
  }

  async #readAll() {
    const keys = await this.#pod.list(ROOT);
    const out = [];
    for (const key of (keys ?? [])) {
      const raw = await this.#pod.read(key);
      const event = parseEvent(raw);
      if (event) out.push(event);
    }
    return out;
  }
}

/* ─── helpers ─────────────────────────────────────────── */

function parseEvent(raw) {
  if (raw === null || raw === undefined) return null;
  // Already a calendar-event object?
  if (typeof raw === 'object' && raw.type === TYPE) return raw;
  // pseudo-pod's read returns { uri, bytes, etag, _v } — the JSON
  // payload lives in `bytes` (string).  Older shapes used `text`
  // or `body`; we accept all three for defensive forward-compat.
  const str = typeof raw === 'string'
    ? raw
    : (raw?.bytes ?? raw?.text ?? raw?.body ?? null);
  if (typeof str !== 'string') return null;
  try {
    const parsed = JSON.parse(str);
    return parsed?.type === TYPE ? parsed : null;
  } catch { return null; }
}

function parseDateInput(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString();
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Fast path 1: ISO + datetime-local + similar machine formats.
  // (datetime-local emits 'YYYY-MM-DDTHH:mm' without timezone; native
  // Date treats that as LOCAL time — that's what the user picked.)
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  // v0.7.-followup 2026-05-23 (4th pass) — natural-language fallback
  // via chrono-node.  Slash-arg path bypassed buildFormSpec's
  // validateAndCoerce so /addappt --when='tomorrow 3pm' reached the
  // store as raw text + failed `new Date(input)`.  This in-store
  // fallback covers ALL entry points (slash, programmatic, form).
  try {
    const parsed = chrono.parseDate(trimmed, new Date(), { forwardDate: true });
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
    // chrono throws on pathological inputs; fall through to null.
  }
  return null;
}

function toEpoch(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return input;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * v0.7.-followup — parse '1h' / '30m' / '2h30m' / '1d' / '90m' → ms.
 * Returns null on parse-fail.
 */
function parseDurationMs(text) {
  if (typeof text !== 'string') return null;
  const re = /(\d+)\s*([dhm])/gi;
  let total = 0, matched = false, m;
  while ((m = re.exec(text)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (u === 'd') total += n * 86_400_000;
    if (u === 'h') total += n *  3_600_000;
    if (u === 'm') total += n *     60_000;
  }
  return matched ? total : null;
}

function normaliseAttendees(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input === 'string') {
    return input.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function generateId() {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${time}-${rand}`;
}
