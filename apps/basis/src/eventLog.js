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
import {
  ENTRY_KINDS, isSystemKind, isAuditKind, kindWakes, retentionOf, RETENTION_DEFAULTS,
} from '@onderling/item-store';

/**
 * Per-CLASS retention defaults (one-log step D). "Retention of what?" is the right question — one number
 * for chat, roster pings and an audit trail is wrong for all three. The classes come from the kind registry
 * (`retentionOf`); the DURATIONS live in the ONE shared table in `@onderling/item-store` (`RETENTION_DEFAULTS`,
 * a per-user setting with these defaults) — moved there so `sa.audit` (secure-agent) reads the SAME numbers as
 * this trail does, since secure-agent cannot import the basis app. Re-exported for the existing basis
 * consumers; `RETENTION_MS` is the `chat`-class window (the historical name).
 *
 *   • `short` — pure plumbing (roster pings, delivery state): 7 days.
 *   • `chat`  — the conversation: 14 days.
 *   • `audit` — governance, reports, key events, the agent trail: the number is the DETAIL window; entries
 *     past it COMPACT into an `audit-summary` instead of dropping, so the shape of what happened survives —
 *     and says how many it folded. A trail that quietly forgets looks complete.
 */
export { RETENTION_DEFAULTS };
export const RETENTION_MS = RETENTION_DEFAULTS.chat;

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
 * MEMBERS are projections of it. Two primitives land here — additive, so every
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
  // ONLY for kinds the table KNOWS. The log holds entries whose types predate this registry (`circle`,
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
 * the circle fan-out (`@onderling/kring-host` `broadcastCircleFanOut` →
 * `stoop broadcastCircleMessage`). When that path grows an entry-kind gate, it
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

/**
 * Shape an AGENT-TRAIL entry (one-log step E) — the record of an agent acting, or a settings change.
 *
 * The field set is a WHITELIST by construction: `{op, target:{kind,ref}, outcome, via}` and nothing
 * else. Deliberately no arguments, message bodies or file contents — a log holding contents becomes a
 * second copy of the data under different access rules (the leak shape found twice in July 2026). The
 * trail says THAT an agent wrote to a file; version history says what.
 *
 * `via` is what makes "what did that revoked delegation reach?" answerable after the grant is gone:
 * `grant:<id>` | `mandate:<task>` | `owner`. Read the trail back with `agentTrailRows({ actor })`.
 *
 * @param {object} a
 * @param {string} a.actor                     the acting agent (pubKey / stable id) — required
 * @param {string} a.op                        what was done (an opId-shaped name) — required
 * @param {{kind?: string, ref?: string}} [a.target]   what it acted on (a POINTER, never content)
 * @param {string} [a.outcome]                 'ok' | an error label
 * @param {string} [a.via='owner']             the authority used
 * @param {string} [a.circleId]                when it happened inside a circle; null otherwise
 * @param {'agent-action'|'settings-change'} [a.kind='agent-action']
 * @param {string} [a.id]  @param {number} [a.ts]
 * @returns {LoggedEvent|null}  null when actor/op are missing — an unattributed trail row is noise
 */
export function makeAgentTrailEntry({
  actor, op, target = null, outcome = null, via = 'owner', circleId = null,
  kind = 'agent-action', id, ts,
} = {}) {
  if (!actor || typeof op !== 'string' || !op) return null;
  const k = kind === 'settings-change' ? 'settings-change' : 'agent-action';
  return makeSilentEntry({
    circleId, kind: k, actor, id, ts,
    payload: {
      op,
      ...(target && typeof target === 'object'
        ? { target: { kind: target.kind ?? null, ref: target.ref ?? null } } : {}),
      ...(outcome != null ? { outcome: String(outcome) } : {}),
      via: typeof via === 'string' && via ? via : 'owner',
    },
  });
}

export class EventLog {
  /** @type {LoggedEvent[]} most-recent first */
  #events;
  /** @type {(events: LoggedEvent[]) => Promise<void>} */
  #persist;
  /** @type {() => number} */
  #now;
  /** @type {Set<(event: LoggedEvent) => void>} */
  #subscribers;
  /** @type {Set<string>} */
  #mutedKeys;

  /** Monotonic storage handle, assigned on append and never accepted from a caller. */
  #seq = 0;

  /** @type {{short: number, chat: number, audit: number}} */
  #retention;

  /**
   * @param {object}                          [opts]
   * @param {LoggedEvent[]}                   [opts.initial=[]]
   * @param {(events: LoggedEvent[]) => Promise<void>} [opts.persist]
   * @param {() => number}                    [opts.now=Date.now]
   * @param {number}                          [opts.retentionMs=RETENTION_MS]
   *   back-compat: overrides the `chat` class (it was the one number everything used). `short` scales
   *   with it (half, floor 0) so tests/hosts that shrink the window shrink the whole log as before;
   *   `audit` uses it as the DETAIL window (entries past it compact, never silently drop).
   * @param {{short?: number, chat?: number, audit?: number}} [opts.retention]
   *   per-class durations (ms) — the user-settable knobs of one-log step D. Wins over `retentionMs`.
   * @param {string[]}                        [opts.muted=[]]
   *   `<app>:<type>`-keyed entries.  Events matching a muted key
   *   are STILL logged (audit trail) but `query({excludeMuted: true})`
   *   filters them out.
   */
  constructor(opts = {}) {
    this.#events = Array.isArray(opts.initial) ? [...opts.initial] : [];
    this.#persist = typeof opts.persist === 'function' ? opts.persist : async () => {};
    this.#now = typeof opts.now === 'function' ? opts.now : Date.now;
    const legacy = typeof opts.retentionMs === 'number' ? {
      chat: opts.retentionMs, audit: opts.retentionMs, short: Math.floor(opts.retentionMs / 2),
    } : {};
    this.#retention = { ...RETENTION_DEFAULTS, ...legacy, ...(opts.retention ?? {}) };
    this.#subscribers = new Set();
    this.#mutedKeys = new Set(Array.isArray(opts.muted) ? opts.muted : []);
  }

  /**
   * Append an event.
   *
   * `id` is the caller's **dedup key**, not a storage handle: re-appending the same id is how an
   * idempotent re-delivery collapses (the EventRouter replays during an in-flight wake, and hold-forward
   * flushes replay too). What happens on a repeat depends on the entry's KIND:
   *
   *   • **auditable kinds** (`isAuditKind` — governance, reports, key events, the agent trail):
   *     **FIRST WRITE WINS.** The existing entry stands and the repeat is dropped. This is invariant 4b —
   *     a bot must not be able to rewrite history. Before 2026-07-27 a repeat REPLACED the entry, so any
   *     actor who knew an id could silently change what it said.
   *   • **everything else** (chat and friends): replace, exactly as before. Chat relies on this — a
   *     re-delivered message must collapse rather than duplicate.
   *
   * `seq` is assigned HERE and can never be supplied by a caller: separating the storage handle from the
   * dedup key is what makes "append" mean append. A caller-supplied seq would put the ordering of the log
   * back in the caller's hands.
   *
   * Prunes on every append.
   *
   * @param {LoggedEvent} event
   * @returns {LoggedEvent|undefined} the stored entry, or undefined when nothing was written
   */
  append(event) {
    if (!event || typeof event !== 'object') return undefined;
    if (typeof event.id !== 'string' || event.id === '') return undefined;
    // De-dup on the caller's id.
    const existing = this.#events.findIndex((e) => e.id === event.id);
    if (existing !== -1) {
      // Invariant 4b: an auditable entry is immutable once written. Return the ORIGINAL so a caller that
      // reads the result still gets a truthful entry rather than the version it hoped to write.
      if (isAuditKind(event.type)) return this.#events[existing];
      this.#events.splice(existing, 1);
    }
    // Most-recent first. `seq` is ours: strip any caller-supplied one before stamping.
    const { seq: _ignored, ...rest } = event;
    const stored = { ...rest, seq: (this.#seq += 1) };
    this.#events.unshift(stored);
    this.prune();
    // Persist async — caller doesn't await.
    this.#persist(this.#events.slice()).catch(() => {});
    for (const fn of this.#subscribers) {
      try { fn(stored); } catch { /* swallow */ }
    }
    return stored;
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
   * Change the retention windows at runtime (the user's setting, applied without a reload) and prune
   * immediately, so shortening the window takes effect on the conversation the user is looking at
   * rather than at some later append. Returns the number of entries dropped by that prune.
   *
   * @param {{short?: number, chat?: number, audit?: number}} patch
   * @returns {number}
   */
  setRetention(patch = {}) {
    for (const k of ['short', 'chat', 'audit']) {
      if (typeof patch?.[k] === 'number' && patch[k] >= 0) this.#retention[k] = patch[k];
    }
    const dropped = this.prune();
    // Persist the shrunk log, but do NOT notify subscribers: they are documented as receiving the
    // APPENDED entry, and a prune has none. Inventing a null-event would make every subscriber add a
    // guard for a case that is really the caller's own re-render.
    if (dropped) this.#persist(this.#events.slice()).catch(() => {});
    return dropped;
  }

  /**
   * EXPLICITLY delete conversation entries older than `olderThanMs` — the user's own destructive act,
   * distinct from retention POLICY. Chat messages are record-class (never auto-expire); this is the one
   * deliberate way they leave the device. Touches ONLY the conversation kind: membership, governance,
   * the audit trail and its summaries are never purgeable through it. Optionally scoped to one circle.
   * Persists the shrunk log; returns how many were deleted (the confirmation the UI reports back).
   *
   * @param {{olderThanMs: number, circleId?: string}} args
   * @returns {number} the number of deleted conversation entries
   */
  purgeConversation({ olderThanMs, circleId = null } = {}) {
    if (typeof olderThanMs !== 'number' || !Number.isFinite(olderThanMs) || olderThanMs < 0) return 0;
    const cutoff = this.#now() - olderThanMs;
    const before = this.#events.length;
    this.#events = this.#events.filter((e) => !(
      e.type === 'chat-message'
      && e.ts < cutoff
      && (circleId == null || e.circleId === circleId)
    ));
    const deleted = before - this.#events.length;
    if (deleted) this.#persist(this.#events.slice()).catch(() => {});
    return deleted;
  }

  /**
   * Prune by the entry's retention CLASS (one-log step D). Three fates:
   *
   *   • `short` / `chat` entries older than their window are DROPPED (as before — one window each).
   *   • `audit` entries older than the audit window COMPACT: they fold into one `audit-summary` entry
   *     per circle (`{from, to, counts, actors, foldedCount}`) instead of vanishing — the trail keeps
   *     the shape of what happened and says how much it folded. The summary itself is never pruned.
   *
   * Compaction happens HERE, by direct mutation — deliberately not via `append`: `audit-summary` is an
   * auditable kind, so an EXTERNAL append with its id is dropped by first-write-wins (a bot cannot
   * rewrite the fold), while the log's own compactor merges freely. A bot cannot trigger compaction
   * either — nothing exposes it beyond append's own housekeeping.
   *
   * Returns the number of entries removed from the array (compacted audit entries count — they left the
   * detail log — but the summaries they fold into do not).
   *
   * @returns {number}
   */
  prune() {
    const now = this.#now();
    const before = this.#events.length;
    const keep = [];
    const fold = [];
    for (const e of this.#events) {
      if (e.type === 'audit-summary') { keep.push(e); continue; }   // a fold never expires
      const cls = retentionOf(e.type);
      // RECORD-class kinds never expire — the entry IS the record. Membership (the roster refolds from
      // these; one dropping away silently changes who-is-in on rebuild) and chat messages (the
      // conversation's record — dropping them is data destruction). Table-driven, not a per-kind hardcode.
      if (cls === 'record') { keep.push(e); continue; }
      const cutoff = now - (this.#retention[cls] ?? this.#retention.chat);
      if (e.ts >= cutoff) { keep.push(e); continue; }
      if (cls === 'audit') fold.push(e);   // past the detail window → compact, don't drop
      // short/chat past their window: dropped.
    }
    this.#events = keep;
    for (const e of fold) this.#foldIntoSummary(e);
    return before - this.#events.length;
  }

  /**
   * Fold one expired audit entry into its circle's `audit-summary` (creating it if absent). Counts are
   * keyed by the entry's op when it has one (`payload.op` — the agent-trail shape — else `payload.event`,
   * the governance shape) and by the entry KIND otherwise, so a summary reads "what happened how often"
   * rather than one opaque number.
   */
  #foldIntoSummary(e) {
    const circleId = e.circleId ?? null;
    const id = `audit-summary:${circleId ?? 'global'}`;
    const countKey = `${e.type}${typeof e.payload?.op === 'string' ? `:${e.payload.op}`
      : typeof e.payload?.event === 'string' ? `:${e.payload.event}` : ''}`;
    const idx = this.#events.findIndex((s) => s.id === id);
    const prev = idx !== -1 ? this.#events[idx] : null;
    const p = prev?.payload ?? { from: e.ts, to: e.ts, counts: {}, actors: [], foldedCount: 0 };
    const actors = new Set(Array.isArray(p.actors) ? p.actors : []);
    if (e.actor != null) actors.add(e.actor);
    const summary = {
      id,
      // keep the summary's ts current so nothing sorts it into pruned-looking territory; the honest
      // time RANGE it covers lives in the payload.
      ts: this.#now(),
      app: prev?.app ?? 'system',
      type: 'audit-summary',
      silent: true,
      circleId,
      payload: {
        from: Math.min(p.from ?? e.ts, e.ts),
        to:   Math.max(p.to   ?? e.ts, e.ts),
        counts: { ...p.counts, [countKey]: (p.counts?.[countKey] ?? 0) + 1 },
        actors: [...actors],
        foldedCount: (p.foldedCount ?? 0) + 1,
      },
      seq: prev?.seq ?? (this.#seq += 1),
    };
    if (idx !== -1) this.#events[idx] = summary;
    else this.#events.unshift(summary);
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
  /**
   * Bulk-load PERSISTED events at boot (the durability slice: the log is the record, so it must survive a
   * reload). Deduped by id against anything already present; `seq` is restamped locally (it is per-instance
   * and never travels); ONE prune afterwards. Deliberately does NOT notify subscribers and does NOT persist —
   * call BEFORE `setPersist`, so hydration never echoes into storage or repaints mid-boot.
   *
   * @param {LoggedEvent[]} events  a snapshot as `persist` received it (most-recent first)
   * @returns {number} how many entries were loaded
   */
  hydrate(events) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    const have = new Set(this.#events.map((e) => e.id));
    let loaded = 0;
    // The snapshot is most-recent-first; walk oldest→newest so unshift rebuilds the original order
    // with ascending fresh seqs.
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (!e || typeof e.id !== 'string' || e.id === '' || have.has(e.id)) continue;
      const { seq: _ignored, ...rest } = e;
      this.#events.unshift({ ...rest, seq: (this.#seq += 1) });
      have.add(e.id);
      loaded += 1;
    }
    if (loaded) this.prune();
    return loaded;
  }

  /**
   * Late-bind the persist sink (the shells construct the log synchronously at module scope, before any
   * async storage is open — same late-bind pattern as `persistMuted`). Called with the full snapshot on
   * every append and after every prune.
   */
  setPersist(fn) {
    this.#persist = typeof fn === 'function' ? fn : async () => {};
  }

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
