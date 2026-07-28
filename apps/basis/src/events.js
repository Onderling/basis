/**
 * basis — event router (reactive path).
 *
 * Inbound events (notifier output, item-changed signals from app
 * bundles, skill-reply async completions like J6's OIDC callback)
 * get routed to threads whose filter matches.  Each matching
 * thread receives an appended shell message + subscribers are
 * notified.
 *
 * Per design doc:
 *   1. Filter match — for each thread, test the event against
 *      `thread.filter` via matchesFilter (filter.js).
 *   2. Always-on archive — append to the network-events log
 *      (deferred to v0.7).
 *   3. In-flight wake — events matching a thread's in-flight
 *      correlation complete the pending dispatch (J6 territory).
 *   4. Record-panel refresh — events matching open record panels'
 *      items trigger re-render (deferred to v0.3 + v0.5).
 *
 * v0.2.1 ships (1) and (3) basic.  v0.7 wires (2); v0.3 / v0.5
 * extend (4).
 *
 * Phase v0.2 per `/Project Files/basis/coding-plan.md`.
 */

import { matchesFilter } from './filter.js';

/**
 * @typedef {object} Event
 * @property {string}              id
 * @property {number}              ts          epoch ms
 * @property {string}              app         app id (e.g. 'household')
 * @property {string}              type        event type ('notification', 'item-changed', ...)
 * @property {string}              [actor]     webid; undefined when not actor-attributed
 * @property {{app: string, type: string, id: string}} [itemRef]
 * @property {*}                   [payload]   app-shaped data
 * @property {string}              [correlationId]
 *   When set, an event router can match this against pending
 *   in-flight dispatches (J6: OIDC redirect → callback wakes the
 *   chat with `correlationId === sessionId`).
 */

let _eventIdSeq = 0;
function nextEventId() {
  _eventIdSeq += 1;
  return `e-${Date.now().toString(36)}-${_eventIdSeq.toString(36)}`;
}

/** Reset the event-id counter — test seam. @internal */
export function __resetEventIdSeq() { _eventIdSeq = 0; }

/**
 * Default formatter: produces a `{message}` reply payload from an
 * event.  Apps following the platform reply convention populate
 * `event.payload.message`; otherwise we fall back to a sane
 * concatenation that still tells the user something happened.
 *
 * @param {Event} event
 * @returns {{ message: string }}
 */
export function defaultFormatNotification(event) {
  if (event?.payload?.message && typeof event.payload.message === 'string') {
    return { message: event.payload.message };
  }
  if (event?.payload?.text && typeof event.payload.text === 'string') {
    return { message: event.payload.text };
  }
  // Fallback: app + type + (actor) — useful during development;
  // production apps should populate payload.message.
  const actor = event?.actor ? ` from ${event.actor}` : '';
  return { message: `[${event.app}/${event.type}]${actor}` };
}

export class EventRouter {
  /** @type {import('./threadStore.js').ThreadStore} */
  #threadStore;
  /** @type {(event: Event) => {message: string} | object} */
  #formatNotification;
  /** @type {() => number} */
  #now;
  /** @type {Array<(event: Event, threadIds: string[]) => void>} */
  #subscribers;
  /** @type {((thread: object, panel: object, itemRef: string) => void) | null} */
  #onPanelStale;
  /**
   * Pending in-flight registrations keyed by `correlationId`.
   * Each holds `{threadId, callback, registeredAt, timeoutMs?}`.
   * @type {Map<string, {threadId: string, callback: Function, registeredAt: number, timeoutMs?: number}>}
   */
  #inFlight;

  /**
   * @param {object}                                                opts
   * @param {import('./threadStore.js').ThreadStore}                opts.threadStore
   * @param {(event: Event) => object}                              [opts.formatNotification]
   * @param {() => number}                                          [opts.now=Date.now]
   * @param {(thread: object, panel: object, itemRef: string) => void} [opts.onPanelStale]
   *   E3 (§B#10) — invoked for each open record/mini-page/embed-card
   *   panel an `item-changed` event marks stale.  The host wires this to
   *   re-run the panel's `sourceOp` and swap its rendered content in
   *   place (auto-refresh), instead of leaving only the static stale
   *   badge.  Fired AFTER `markPanelStale`, so a no-op/failed refresh
   *   still leaves the badge as a fallback.
   */
  constructor(opts) {
    if (!opts?.threadStore) {
      throw new TypeError('EventRouter: opts.threadStore required');
    }
    this.#threadStore = opts.threadStore;
    this.#formatNotification =
      typeof opts.formatNotification === 'function'
        ? opts.formatNotification
        : defaultFormatNotification;
    this.#now         = typeof opts.now === 'function' ? opts.now : Date.now;
    this.#subscribers = [];
    this.#inFlight    = new Map();
    this.#onPanelStale = typeof opts.onPanelStale === 'function' ? opts.onPanelStale : null;
  }

  /* ─── public delivery API ──────────────────────────────────── */

  /**
   * Deliver an event.  Matches against every thread's filter;
   * appends a notification shell message to each matching thread;
   * notifies subscribers; checks in-flight wake.  Returns the list
   * of thread ids that received the event (empty when no thread
   * matched).
   *
   * v0.6.3 — when the event carries an `itemRef`, ALSO scans every
   * thread (regardless of filter match) for open record / mini-page
   * / embed-card panels referencing the same item and marks them
   * stale.  This is "reactive panel refresh" — separate from
   * filter-based notification routing.
   *
   * @param {Event}   event
   * @param {object}  [opts]
   * @param {string[]} [opts.excludeThreadIds]
   *   Threads to skip even when their filter matches.  The chat
   *   shell uses this when a user-initiated mutation in thread T
   *   would otherwise produce a duplicate notification IN T (the
   *   mutation reply already appears there).  Other matching
   *   threads still receive the notification.
   * @returns {string[]}  thread ids that received the event
   */
  deliver(event, opts = {}) {
    if (!event || typeof event !== 'object') {
      throw new TypeError('EventRouter.deliver: event required');
    }
    const enriched = this.#normaliseEvent(event);
    const matched  = [];
    const exclude  = new Set(
      Array.isArray(opts.excludeThreadIds) ? opts.excludeThreadIds : [],
    );

    for (const thread of this.#threadStore.listThreads()) {
      // v0.6.3 — reactive panel-staleness scan happens REGARDLESS of
      // filter match (excludeThreadIds still respected — the
      // dispatching thread already shows the fresh state).
      if (!exclude.has(thread.id) && enriched.itemRef) {
        for (const panel of thread.openPanelsForItemRef(enriched.itemRef)) {
          thread.markPanelStale(panel.messageId);
          // E3 — let the host auto-refresh (re-run sourceOp + replace in
          // place).  Guarded so a throwing host handler can't break
          // event delivery to the remaining threads.
          if (this.#onPanelStale) {
            try { this.#onPanelStale(thread, panel, enriched.itemRef); }
            catch { /* host refresh failure → static stale badge remains */ }
          }
        }
      }

      if (exclude.has(thread.id)) continue;
      if (!matchesFilter(enriched, thread.filter)) continue;
      this.#appendNotificationTo(thread, enriched);
      matched.push(thread.id);
    }

    // In-flight wake (mechanism only — full J6 OIDC handoff lands
    // in v0.6).  If the event carries a correlationId that matches
    // a registered handler, fire the callback.
    if (enriched.correlationId
        && this.#inFlight.has(enriched.correlationId)) {
      const reg = this.#inFlight.get(enriched.correlationId);
      this.#inFlight.delete(enriched.correlationId);
      try { reg.callback(enriched); }
      catch { /* swallow callback errors — subscribers still see the event */ }
    }

    this.#emit(enriched, matched);
    return matched;
  }

  /**
   * Subscribe to delivered events.  The callback receives the
   * enriched event + the list of thread ids that matched.
   *
   * @param {(event: Event, threadIds: string[]) => void} fn
   * @returns {() => void}   unsubscribe
   */
  onRouted(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('EventRouter.onRouted: fn required');
    }
    this.#subscribers.push(fn);
    return () => {
      this.#subscribers = this.#subscribers.filter((s) => s !== fn);
    };
  }

  /* ─── in-flight wake (J6 / future) ──────────────────────────── */

  /**
   * Register an in-flight handler.  When a future event arrives
   * with a matching `correlationId`, the callback is invoked once
   * and the registration removed.
   *
   * J6 use case: chat shell opens an OIDC redirect; persists
   * `{threadId, sessionId}`; the deep-link callback arrives later
   * as an event with `correlationId === sessionId`; the registered
   * callback completes the pending sign-in dispatch.
   *
   * @param {string}                          correlationId
   * @param {(event: Event) => void}          callback
   * @param {object}                          [opts]
   * @param {string}                          [opts.threadId]   for diagnostics
   * @returns {() => void}                                       cancel
   */
  registerInFlight(correlationId, callback, opts = {}) {
    if (typeof correlationId !== 'string' || correlationId === '') {
      throw new TypeError('registerInFlight: correlationId required');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('registerInFlight: callback required');
    }
    this.#inFlight.set(correlationId, {
      threadId: opts.threadId,
      callback,
      registeredAt: this.#now(),
    });
    return () => this.#inFlight.delete(correlationId);
  }

  /**
   * Whether an in-flight registration exists for the given id.
   *
   * @param {string} correlationId
   * @returns {boolean}
   */
  hasInFlight(correlationId) {
    return this.#inFlight.has(correlationId);
  }

  /** Number of pending in-flight registrations. @returns {number} */
  get inFlightSize() { return this.#inFlight.size; }

  /* ─── internals ────────────────────────────────────────────── */

  #normaliseEvent(event) {
    return {
      id:   event.id   ?? nextEventId(),
      ts:   typeof event.ts === 'number' ? event.ts : this.#now(),
      app:  String(event.app  ?? ''),
      type: String(event.type ?? ''),
      ...(event.actor   !== undefined ? { actor:   event.actor }   : {}),
      ...(event.itemRef !== undefined ? { itemRef: event.itemRef } : {}),
      ...(event.payload !== undefined ? { payload: event.payload } : {}),
      ...(event.correlationId !== undefined
        ? { correlationId: event.correlationId }
        : {}),
    };
  }

  #appendNotificationTo(thread, event) {
    const payload = this.#formatNotification(event);
    // Render as a `text` shape for v0.2.1 — the dedicated
    // `notification` shape with inline buttons lands in v0.5 alongside
    // embeds.  Thread.addShellMessage handles A2 lifecycle correctly.
    thread.addShellMessage({
      kind:           'text',
      messageId:      `notif-${event.id}-${thread.id}`,
      threadId:       thread.id,
      lifecycleState: 'live',
      text:           typeof payload?.message === 'string'
                        ? payload.message
                        : String(payload),
    });
  }

  #emit(event, threadIds) {
    for (const fn of this.#subscribers) {
      try { fn(event, threadIds); }
      catch { /* swallow subscriber errors */ }
    }
  }
}

/**
 * Convenience factory.  Same API as `new EventRouter(opts)`; matches
 * the style of `createDefaultThreadStore` + `createMockHouseholdAgent`.
 *
 * @param {ConstructorParameters<typeof EventRouter>[0]} opts
 * @returns {EventRouter}
 */
export function createEventRouter(opts) {
  return new EventRouter(opts);
}
