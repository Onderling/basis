/**
 * basis — network-events log (D.1, v0.7.1).
 *
 * Append-only chronological feed of every event that flowed through
 * the chat shell's EventRouter — INCLUDING events that no thread's
 * filter matched.  The chat shows you what's relevant to THIS
 * conversation; the log page shows the firehose so you can find
 * "what happened in my household yesterday?".
 *
 * Retention: 14 days (per OQ-7.B user resolution 2026-05-22).
 * Older events get pruned on every append + on explicit `prune()`.
 *
 * Storage: events persist via IndexedDB in a new `events` object
 * store keyed by `id` with an index on `ts` for fast prune-by-age.
 * The substrate stays platform-neutral; the caller (web/main.js)
 * supplies the `idb` helper.
 *
 * Platform: neutral.
 *
 * Phase v0.7 per `/Project Files/basis/coding-plan.md`.
 */

import { matchesFilter } from './filter.js';
import { ENTRY_KINDS, isSystemKind, kindWakes } from '@onderling/item-store';

/** 14 days in ms — OQ-7.B retention default. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} LoggedEvent
 * @property {string} id
 * @property {number} ts
 * @property {string} app
 * @property {string} type
 * @property {string} [actor]
 * @property {string} [circleId]   first-class circle scope (C15) — see below
 * @property {boolean} [silent]    silent system-entry marker (C15) — see below
 * @property {{app: string, type: string, id: string}} [itemRef]
 * @property {*}      [payload]
 * @property {string} [correlationId]
 */

/* ─── C15 "one stream" substrate (Phase-4 Wave B) ─────────────────
 *
 * North star: the EventLog is THE canonical per-circle log. Chat / Stream /
 * LEDEN are projections of it. Two primitives land here — additive, so every
 * existing entry, projection, and consumer keeps working byte-for-byte:
 *
 *   1. First-class `circleId` — a logged entry MAY carry a top-level
 *      `circleId`, so a projection reads the circle scope DIRECTLY instead of
 *      digging it out of the payload. `circleStream.eventCircleId` reads the
 *      top-level field first and keeps the payload-dig as a back-compat
 *      fallback for older entries (and for entries appended by paths that
 *      don't set it yet).
 *
 *   2. A SILENT system-entry lane — `appendSilentEntry({circleId, kind,
 *      payload})` writes a typed, first-class-`circleId`, `silent:true` entry.
 *      Silent entries are the log's system lane: the chat projection IGNORES
 *      them (chat stays a chat — see `circleStream.buildCircleChat`), while the
 *      cross-circle Stream tab (the firehose) still shows them. The pinned
 *      notifications rule keys off entry KIND: a silent kind NEVER wakes an
 *      offline member (`shouldWakeForEntry` → false); only human-facing kinds
 *      may. `isSilentEntry` is the single discriminator both sides read.
 *
 * TAIL (NOT done here — the remaining C15 consolidation): routing the scattered
 * system actions that today dispatch via the peer-router to their own handlers
 * (membership changes, group key-events, delivery-state) INTO the log as typed
 * silent entries, and narrowing the per-circle chat surface to project only
 * `chat-message`. That is the wider "peer-router → one-stream" migration; this
 * increment only adds the lane + the first-class scope the profile-update
 * pull-me note (the next slice) needs.
 */

/** App tag for log entries written by the system lane (not a user/peer app). */
export const SYSTEM_APP = 'system';

/**
 * Is this entry a SILENT system entry? Discriminates by KIND: silent entries
 * are stamped with the `silent:true` marker by `appendSilentEntry`. The
 * notifications/attention gate + the chat projection both read THIS — never a
 * bespoke payload peek — so "silent" has one definition.
 *
 * @param {LoggedEvent} entry
 * @returns {boolean}
 */
export function isSilentEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  // DERIVED from the shared kind table (2026-07-27) rather than read off a flag someone remembered to
  // stamp — so a new system kind cannot arrive in a conversation because one append site forgot it.
  //
  // ONLY for kinds the table KNOWS. The log holds entries whose types predate this registry (`buurt`,
  // reactions, app-specific rows); treating an unlisted type as "system" would silently delete them from
  // every conversation — caught by `eventLog.test.js` when I first wrote it the other way. So an unknown
  // type falls back to the flag, which is the old behaviour exactly. The conservative UNKNOWN_KIND default
  // still applies where a kind is asked about directly (it must never let an unrecognised kind WAKE a
  // device); it must not reclassify existing content.
  if (typeof entry.type === 'string' && entry.type in ENTRY_KINDS) return isSystemKind(entry.type);
  return entry.silent === true;
}

/**
 * The single source the offline/notifications wake-gate reads: should THIS
 * entry be allowed to wake an offline member? Keys off entry KIND — a silent
 * system kind NEVER wakes; every human-facing kind (a `chat-message`, a
 * reaction, …) may.
 *
 * SEAM: the live wake path is decoupled from the log — it lives in
 * `@onderling/relay` (`push/wakePayload.js`) + `@onderling/notifier`
 * (`PushPolicy`) and is driven off push tokens + `humanInTheLoop`, reached via
 * the kring fan-out (`@onderling/kring-host` `broadcastKringFanOut` →
 * `stoop broadcastKringMessage`). When that path grows an entry-kind gate, it
 * MUST consult `shouldWakeForEntry(entry)` BEFORE enqueuing a wake so a silent
 * system entry can never nudge a device. Until then this is the pure,
 * unit-testable source of truth that gate plugs into.
 *
 * @param {LoggedEvent} entry
 * @returns {boolean}
 */
export function shouldWakeForEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  // The kind decides — including the ONE per-event exception (`governance`: a decision opening wakes, the
  // votes that follow do not), which `kindWakes` owns so stoop and basis stop each deriving it.
  if (typeof entry.type === 'string' && entry.type in ENTRY_KINDS) {
    return kindWakes(entry.type, entry.payload);
  }
  // An entry of an unregistered kind falls back to the pre-registry rule.
  return !isSilentEntry(entry);
}

/**
 * Build a SILENT system entry (pure — no append). Typed entry carrying a
 * first-class `circleId`, the `silent:true` marker, `app:'system'`, and
 * `type:kind`. Exported so callers/tests can shape one without a live log.
 *
 * @param {object} a
 * @param {string} a.circleId          first-class circle scope (required)
 * @param {string} a.kind              the system entry kind → `type`
 * @param {*}      [a.payload]         opaque per-kind body
 * @param {string} [a.id]             defaults to a generated `sys-…` id
 * @param {number} [a.ts]             defaults to Date.now()
 * @param {string} [a.actor]
 * @returns {LoggedEvent}
 */
export function makeSilentEntry({ circleId, kind, payload, id, ts, actor } = {}) {
  return {
    id:   typeof id === 'string' && id ? id : `sys-${Math.random().toString(36).slice(2, 10)}`,
    ts:   typeof ts === 'number' ? ts : Date.now(),
    app:  SYSTEM_APP,
    type: kind,
    silent: true,
    circleId: circleId ?? null,
    ...(actor != null ? { actor } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}

export class EventLog {
  /** @type {LoggedEvent[]} most-recent first */
  #events;
  /** @type {(events: LoggedEvent[]) => Promise<void>} */
  #persist;
  /** @type {() => number} */
  #now;
  /** @type {number} */
  #retentionMs;
  /** @type {Set<(event: LoggedEvent) => void>} */
  #subscribers;
  /** @type {Set<string>} */
  #mutedKeys;

  /**
   * @param {object}                          [opts]
   * @param {LoggedEvent[]}                   [opts.initial=[]]
   * @param {(events: LoggedEvent[]) => Promise<void>} [opts.persist]
   * @param {() => number}                    [opts.now=Date.now]
   * @param {number}                          [opts.retentionMs=RETENTION_MS]
   * @param {string[]}                        [opts.muted=[]]
   *   `<app>:<type>`-keyed entries.  Events matching a muted key
   *   are STILL logged (audit trail) but `query({excludeMuted: true})`
   *   filters them out.
   */
  constructor(opts = {}) {
    this.#events = Array.isArray(opts.initial) ? [...opts.initial] : [];
    this.#persist = typeof opts.persist === 'function' ? opts.persist : async () => {};
    this.#now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.#retentionMs = typeof opts.retentionMs === 'number'
      ? opts.retentionMs : RETENTION_MS;
    this.#subscribers = new Set();
    this.#mutedKeys = new Set(Array.isArray(opts.muted) ? opts.muted : []);
  }

  /**
   * Append an event.  Idempotent on `id`: re-appends with the same
   * id overwrite the existing entry (covers EventRouter re-deliveries
   * during in-flight wake).  Prunes on every append.
   *
   * @param {LoggedEvent} event
   */
  append(event) {
    if (!event || typeof event !== 'object') return;
    if (typeof event.id !== 'string' || event.id === '') return;
    // De-dup on id.
    const existing = this.#events.findIndex((e) => e.id === event.id);
    if (existing !== -1) this.#events.splice(existing, 1);
    // Most-recent first.
    this.#events.unshift({ ...event });
    this.prune();
    // Persist async — caller doesn't await.
    this.#persist(this.#events.slice()).catch(() => {});
    for (const fn of this.#subscribers) {
      try { fn(event); } catch { /* swallow */ }
    }
  }

  /**
   * Append a SILENT system entry (C15). Convenience over `append` for the
   * system lane: shapes a typed, first-class-`circleId`, `silent:true` entry
   * (see `makeSilentEntry`) and appends it. Returns the appended entry so the
   * caller can read its generated id.
   *
   * Silent entries are logged like any other (the Stream firehose shows them),
   * but the chat projection ignores them and `shouldWakeForEntry` returns false
   * for them — a silent kind never wakes an offline member.
   *
   * @param {object} a  see `makeSilentEntry` — { circleId, kind, payload, id?, ts?, actor? }
   * @returns {LoggedEvent} the appended entry
   */
  appendSilentEntry(a = {}) {
    const entry = makeSilentEntry(a);
    this.append(entry);
    return entry;
  }

  /**
   * Prune events older than retentionMs.  Returns the number pruned.
   *
   * @returns {number}
   */
  prune() {
    const cutoff = this.#now() - this.#retentionMs;
    const before = this.#events.length;
    this.#events = this.#events.filter((e) => e.ts >= cutoff);
    return before - this.#events.length;
  }

  /**
   * Query the log.  Returns most-recent-first slice.
   *
   * @param {object}              [opts]
   * @param {import('./filter.js').ThreadFilter} [opts.filter]
   *   Same DSL as thread filters — flat key:value AND/OR-of-keys OR
   *   expression-tree form (OQ-2.A).
   * @param {number}              [opts.since]    only events with ts >= since
   * @param {number}              [opts.until]    only events with ts <= until
   * @param {boolean}             [opts.excludeMuted=false]
   * @param {number}              [opts.limit]
   * @returns {LoggedEvent[]}
   */
  query(opts = {}) {
    let result = this.#events;
    if (opts.filter) result = result.filter((e) => matchesFilter(e, opts.filter));
    if (typeof opts.since === 'number') result = result.filter((e) => e.ts >= opts.since);
    if (typeof opts.until === 'number') result = result.filter((e) => e.ts <= opts.until);
    if (opts.excludeMuted) {
      result = result.filter((e) => !this.#mutedKeys.has(`${e.app}:${e.type}`));
    }
    if (typeof opts.limit === 'number') result = result.slice(0, opts.limit);
    return result.slice();   // defensive copy
  }

  /** Total events currently in the log (post-prune). */
  get size() { return this.#events.length; }

  /**
   * Subscribe to new appended events.
   *
   * @param {(event: LoggedEvent) => void} fn
   * @returns {() => void}                 unsubscribe
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /* ─── mute set (per-event-kind) ────────────────────────── */

  /** Mute key: `<app>:<type>`. */
  mute(app, type) {
    const key = `${app}:${type}`;
    if (this.#mutedKeys.has(key)) return false;
    this.#mutedKeys.add(key);
    this.#persistMuted(this.mutedList());
    return true;
  }

  unmute(app, type) {
    const key = `${app}:${type}`;
    if (!this.#mutedKeys.has(key)) return false;
    this.#mutedKeys.delete(key);
    this.#persistMuted(this.mutedList());
    return true;
  }

  isMuted(app, type) { return this.#mutedKeys.has(`${app}:${type}`); }

  /** Snapshot of muted keys (for serialisation). */
  mutedList() { return [...this.#mutedKeys].sort(); }

  /**
   * Set a persistor for the muted list.  Optional — main.js wires
   * this to the same IDB store the events live in.
   *
   * @param {(muted: string[]) => Promise<void>} fn
   */
  setMutedPersistor(fn) {
    if (typeof fn !== 'function') return;
    this.#persistMuted = fn.bind(null);
  }

  #persistMuted = async () => {};

  /* ─── connect to EventRouter ───────────────────────────── */

  /**
   * Wire this log to an EventRouter so every delivered event is
   * appended automatically.  Returns the unsubscribe handle.
   *
   * @param {import('./events.js').EventRouter} router
   * @returns {() => void}
   */
  attachToRouter(router) {
    if (!router || typeof router.onRouted !== 'function') {
      throw new TypeError('attachToRouter: router with onRouted required');
    }
    return router.onRouted((event /* , threadIds */) => {
      // Persist the FULL event regardless of whether any thread
      // matched.  The log is the audit trail; threads are the
      // foreground filter.
      this.append(event);
    });
  }
}

/**
 * Convenience factory.  Same API as `new EventLog(opts)`.
 *
 * @param {ConstructorParameters<typeof EventLog>[0]} opts
 * @returns {EventLog}
 */
export function createEventLog(opts) {
  return new EventLog(opts);
}
