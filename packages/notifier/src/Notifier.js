/**
 * Notifier — schedule recurring digests + one-shot nudges; deliver
 * via channels.
 *
 * A "channel" IS an `@onderling/chat-agent` `MessagingBridge` (typedef
 * aliased in `./types.js`).  The substrate ships `NoopChannel` +
 * `PushChannel`; chat-shaped channels are L1c bridges (e.g.
 * `TelegramBridge`, `InMemoryBridge`).  `recipient` strings are opaque
 * to the notifier — they get passed through as `chatId` to the
 * channel; webid → identifier resolution is the consuming app's job
 * (typically L1h identity-resolver).
 *
 * Pattern source: the retired household bot's scheduler, nudge
 * timer and daily digest.  Substrate generalises into:
 *
 *   - schedule({id, cadence, recipients, channel, builder}) — recurring
 *   - scheduleOnce({triggerAt, recipient, channel, builder, cancelKey}) — one-shot
 *   - cancel(cancelKey)
 *   - subscribe(emitter, name, handler) — bridge events from upstream stores
 *
 * Time source pluggable for tests (default: Date.now / setTimeout).
 */

import { Emitter, genId } from '@onderling/core';

import { InMemoryScheduleStore } from './stores/InMemoryScheduleStore.js';
import { nextDailyFireInTz } from './timezone.js';

// V0: no retries by default.  Apps that want retry behaviour pass a
// non-empty `retryDelaysMs` to the constructor.  Keeping the V0 path
// simple keeps the substrate's testability tractable; retry-with-
// nested-fake-timers is hard to validate in a single advance pass.
const DEFAULT_RETRY_DELAYS = [];

export class Notifier extends Emitter {
  /** @type {Record<string, import('./types.js').Channel>} */
  #channels;
  /** @type {import('./types.js').ScheduleStore} */
  #store;
  /** @type {number[]} */
  #retryDelaysMs;
  // TODO: when core ships an injectable Clock primitive, collapse the
  // (now, setTimeoutFn, clearTimeoutFn) triple into a single `clock`
  // constructor option.
  #now;
  #setTimeout;
  #clearTimeout;
  /** @type {((recipient: string, channelId: string, payload: object, now: number) => boolean|Promise<boolean>) | null} */
  #isSuppressed;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  #timers = new Map();
  /** @type {boolean} */
  #started = false;
  /** @type {Array<() => void>} */
  #subscribers = [];

  /**
   * @param {object} args
   * @param {Record<string, import('./types.js').Channel>} args.channels
   * @param {import('./types.js').ScheduleStore} [args.store]
   * @param {() => number} [args.now]
   * @param {typeof setTimeout}  [args.setTimeoutFn]
   * @param {typeof clearTimeout} [args.clearTimeoutFn]
   */
  constructor({
    channels,
    store,
    retryDelaysMs,
    now,
    setTimeoutFn,
    clearTimeoutFn,
    isSuppressed,
  } = {}) {
    super();
    if (!channels || typeof channels !== 'object') {
      throw new TypeError('Notifier: channels (object) required');
    }
    this.#channels      = channels;
    this.#store         = store ?? new InMemoryScheduleStore();
    this.#retryDelaysMs = Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_RETRY_DELAYS;
    this.#now           = now            ?? (() => Date.now());
    this.#setTimeout    = setTimeoutFn   ?? globalThis.setTimeout;
    this.#clearTimeout  = clearTimeoutFn ?? globalThis.clearTimeout;
    // 5.7b — optional quiet-hours / per-recipient suppression hook.  The
    // host passes a predicate (typically `isPushSuppressed(availability,
    // now)`); the deliver path consults it BEFORE channel.sendReply and
    // emits 'suppressed' instead.  Late-binding via setSuppressionPredicate.
    this.#isSuppressed  = typeof isSuppressed === 'function' ? isSuppressed : null;
  }

  /**
   * 5.7b — register / replace the suppression predicate after construction
   * (useful when the availability store loads asynchronously at boot).
   * Pass `null` to disable.
   *
   * @param {((recipient: string, channelId: string, payload: object, now: number) => boolean|Promise<boolean>) | null} fn
   */
  setSuppressionPredicate(fn) {
    this.#isSuppressed = typeof fn === 'function' ? fn : null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Re-arms timers for any persisted jobs.  Idempotent.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;
    const jobs = await this.#store.listAll();
    for (const job of jobs) {
      this.#armTimer(job);
    }
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    for (const t of this.#timers.values()) this.#clearTimeout(t);
    this.#timers.clear();
    for (const off of this.#subscribers) off();
    this.#subscribers.length = 0;
  }

  // ── Scheduling ───────────────────────────────────────────────────

  /**
   * Schedule a recurring job.
   *
   * @param {object} args
   * @param {string} args.id                       app-supplied id (also used as cancelKey)
   * @param {import('./types.js').Cadence} args.cadence
   * @param {Array<string>} args.recipients        list of recipient identifiers
   * @param {string} args.channel                  channel id
   * @param {(recipient: string) => Promise<{text: string, buttons?: Array, meta?: object}>} args.builder
   * @returns {Promise<string>} jobId
   */
  async schedule({ id, cadence, recipients, channel, builder }) {
    if (typeof id !== 'string' || !id) throw new TypeError('schedule: id required');
    if (!cadence)                       throw new TypeError('schedule: cadence required');
    if (!Array.isArray(recipients))     throw new TypeError('schedule: recipients[] required');
    if (typeof channel !== 'string')    throw new TypeError('schedule: channel required');
    if (typeof builder !== 'function')  throw new TypeError('schedule: builder fn required');
    if (!this.#channels[channel])       throw new Error(`schedule: unknown channel '${channel}'`);

    // For recurring jobs, the "recipient" stored on the Job is the
    // first recipient; the runner expands to all on each fire.
    /** @type {import('./types.js').Job} */
    const job = {
      jobId:     id,
      kind:      'recurring',
      channelId: channel,
      recipient: recipients[0] ?? '',
      cadence,
      builder:   async () => builder(recipients[0]),     // placeholder — see #fireRecurring
      cancelKey: id,
      nextFireAt: this.#nextFireAt(cadence, this.#now()),
      metadata:  { recipients },
    };
    await this.#store.put(job);
    if (this.#started) this.#armTimer(job);
    return id;
  }

  /**
   * Schedule a one-shot job.
   *
   * @param {object} args
   * @param {number} args.triggerAt
   * @param {string} args.recipient
   * @param {string} args.channel
   * @param {() => Promise<{text: string, buttons?: Array, meta?: object}>} args.builder
   * @param {string} [args.cancelKey]
   * @returns {Promise<string>} jobId
   */
  async scheduleOnce({ triggerAt, recipient, channel, builder, cancelKey }) {
    if (typeof triggerAt !== 'number') throw new TypeError('scheduleOnce: triggerAt required');
    if (typeof recipient !== 'string') throw new TypeError('scheduleOnce: recipient required');
    if (typeof channel !== 'string')   throw new TypeError('scheduleOnce: channel required');
    if (typeof builder !== 'function') throw new TypeError('scheduleOnce: builder fn required');
    if (!this.#channels[channel])      throw new Error(`scheduleOnce: unknown channel '${channel}'`);

    const jobId = genId();
    /** @type {import('./types.js').Job} */
    const job = {
      jobId,
      kind:      'once',
      channelId: channel,
      recipient,
      triggerAt,
      builder,
      ...(cancelKey ? { cancelKey } : {}),
      nextFireAt: triggerAt,
    };
    await this.#store.put(job);
    if (this.#started) this.#armTimer(job);
    return jobId;
  }

  /**
   * Schedule a one-shot job to fire `leadMs` milliseconds *before* a
   * target `dueAt` timestamp.  Sugar over `scheduleOnce` — useful for
   * lend / borrow return reminders, deadline nudges, RSVP nags, etc.
   *
   * If `dueAt - leadMs` is in the past, the job fires immediately on
   * the next start/arm pass (same semantics as `scheduleOnce` with a
   * past triggerAt).  Apps that want different past-handling should
   * compute their own triggerAt and call `scheduleOnce` directly.
   *
   * Idiomatic `cancelKey` shape is `'due:<itemId>'` so that the app's
   * "mark returned" / "cancel deadline" flow can call
   * `notifier.cancel('due:' + itemId)` regardless of how many
   * reminders were scheduled for that item.
   *
   * @param {object} args
   * @param {number} args.dueAt                                 ms epoch — the deadline itself
   * @param {number} args.leadMs                                how long *before* dueAt to fire
   * @param {string} args.recipient
   * @param {string} args.channel
   * @param {() => Promise<{text: string, buttons?: Array, meta?: object}>} args.builder
   * @param {string} [args.cancelKey]
   * @returns {Promise<string>} jobId
   */
  async scheduleBefore({ dueAt, leadMs, recipient, channel, builder, cancelKey }) {
    if (typeof dueAt  !== 'number') throw new TypeError('scheduleBefore: dueAt (ms epoch) required');
    if (typeof leadMs !== 'number') throw new TypeError('scheduleBefore: leadMs (number) required');
    return this.scheduleOnce({
      triggerAt: dueAt - leadMs,
      recipient,
      channel,
      builder,
      cancelKey,
    });
  }

  /**
   * Cancel scheduled job(s) by cancelKey or jobId.
   *
   * @param {string} keyOrJobId
   */
  async cancel(keyOrJobId) {
    const direct = await this.#store.get(keyOrJobId);
    if (direct) {
      this.#disarmTimer(direct.jobId);
      await this.#store.remove(direct.jobId);
      return;
    }
    // No exact-jobId match — try cancelKey.
    const all = await this.#store.listAll();
    for (const job of all) {
      if (job.cancelKey === keyOrJobId) {
        this.#disarmTimer(job.jobId);
        await this.#store.remove(job.jobId);
      }
    }
  }

  // ── Generic event hook ───────────────────────────────────────────

  /**
   * Subscribe to events on an external emitter (typically a substrate
   * that fires `item-added` / `item-completed` / etc).  Useful for
   * "item-added → schedule a 1h nudge" patterns.
   *
   * Returns an off-fn; also auto-removed on stop().
   *
   * Distinct from `Emitter.on(name, handler)` (own events) —
   * `subscribe()` always targets a foreign emitter.
   *
   * @param {{on: Function, off?: Function}} emitter
   * @param {string} eventName
   * @param {Function} handler
   * @returns {() => void}
   */
  subscribe(emitter, eventName, handler) {
    if (!emitter || typeof emitter.on !== 'function') {
      throw new TypeError('subscribe: emitter with .on() required');
    }
    if (typeof eventName !== 'string') {
      throw new TypeError('subscribe: eventName required');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('subscribe: handler required');
    }
    emitter.on(eventName, handler);
    const off = () => emitter.off?.(eventName, handler);
    this.#subscribers.push(off);
    return off;
  }

  // ── Internals ────────────────────────────────────────────────────

  #armTimer(job) {
    if (!this.#started) return;
    if (this.#timers.has(job.jobId)) {
      this.#clearTimeout(this.#timers.get(job.jobId));
    }
    const fireAt = job.nextFireAt ?? this.#now();
    const delay  = Math.max(0, fireAt - this.#now());
    const t = this.#setTimeout(() => this.#fire(job.jobId), delay);
    this.#timers.set(job.jobId, t);
  }

  #disarmTimer(jobId) {
    const t = this.#timers.get(jobId);
    if (t) {
      this.#clearTimeout(t);
      this.#timers.delete(jobId);
    }
  }

  async #fire(jobId) {
    if (!this.#started) return;
    const job = await this.#store.get(jobId);
    if (!job) return;
    if (job.kind === 'once') {
      await this.#fireOnce(job);
      await this.#store.remove(jobId);
      this.#timers.delete(jobId);
      return;
    }
    if (job.kind === 'recurring') {
      await this.#fireRecurring(job);
      // Next fire is computed from the previously-scheduled fire (not
      // from `now`), so cadence stays exact even if the runner is
      // slightly late.
      const previous = job.nextFireAt ?? this.#now();
      const next     = this.#nextFireAfter(job.cadence, previous);
      const updated  = { ...job, lastFiredAt: this.#now(), nextFireAt: next };
      await this.#store.put(updated);
      this.#armTimer(updated);
    }
  }

  async #fireOnce(job) {
    const channel = this.#channels[job.channelId];
    if (!channel) {
      this.emit('error', { jobId: job.jobId, error: new Error(`unknown channel '${job.channelId}'`) });
      return;
    }
    try {
      const built = await job.builder();
      if (await this.#suppress(job.recipient, job.channelId, built)) {
        this.emit('suppressed', { jobId: job.jobId, kind: 'once', recipient: job.recipient });
      } else {
        await this.#deliverWithRetry(channel, { chatId: job.recipient, ...built });
        this.emit('fired', { jobId: job.jobId, kind: 'once', recipient: job.recipient });
      }
    } catch (err) {
      this.emit('error', { jobId: job.jobId, error: err });
    }
  }

  async #fireRecurring(job) {
    const channel = this.#channels[job.channelId];
    if (!channel) {
      this.emit('error', { jobId: job.jobId, error: new Error(`unknown channel '${job.channelId}'`) });
      return;
    }
    const recipients = job.metadata?.recipients ?? [job.recipient];
    for (const recipient of recipients) {
      try {
        const built = await job.builder.call(null, recipient);
        if (await this.#suppress(recipient, job.channelId, built)) {
          this.emit('suppressed', { jobId: job.jobId, kind: 'recurring', recipient });
          continue;
        }
        await this.#deliverWithRetry(channel, { chatId: recipient, ...built });
        this.emit('fired', { jobId: job.jobId, kind: 'recurring', recipient });
      } catch (err) {
        this.emit('error', { jobId: job.jobId, error: err, recipient });
      }
    }
  }

  /**
   * 5.7b — consult the optional suppression predicate.  A throwing or
   * truthy-returning predicate is taken at face value (truthy → suppress).
   * A throwing predicate counts as "do not suppress" so a broken hook
   * never silently swallows notifications.
   */
  async #suppress(recipient, channelId, payload) {
    if (!this.#isSuppressed) return false;
    try {
      return !!(await this.#isSuppressed(recipient, channelId, payload, this.#now()));
    } catch {
      return false;
    }
  }

  async #deliverWithRetry(channel, args, attempts = 0) {
    try {
      await channel.sendReply(args);
    } catch (err) {
      if (attempts < this.#retryDelaysMs.length) {
        await new Promise((r) => this.#setTimeout(r, this.#retryDelaysMs[attempts]));
        return this.#deliverWithRetry(channel, args, attempts + 1);
      }
      throw err;
    }
  }

  /**
   * Compute the next fire time AFTER a reference time.  Used both at
   * schedule time (`#nextFireAt(cadence, now)` for first fire) and on
   * recurring re-arming (`#nextFireAfter(cadence, previousFireAt)`
   * for subsequent fires).  They share the same logic.
   *
   * @param {import('./types.js').Cadence} cadence
   * @param {number} after        ms epoch
   * @returns {number}
   */
  #nextFireAt(cadence, after) {
    return this.#nextFireAfter(cadence, after);
  }

  #nextFireAfter(cadence, after) {
    if (cadence.kind === 'interval') {
      return after + (cadence.intervalMs ?? 60_000);
    }
    if (cadence.kind === 'hourly') {
      return after + 60 * 60 * 1000;
    }
    if (cadence.kind === 'daily') {
      // TZ-aware path when `cadence.tz` is provided; otherwise
      // runtime-local (same as the previous V0 default).
      if (cadence.tz && cadence.tz !== 'UTC' && cadence.tz !== 'local') {
        return nextDailyFireInTz(after, cadence.tz, cadence.timeLocal ?? '00:00');
      }
      const [h, m] = (cadence.timeLocal ?? '00:00').split(':').map(Number);
      const d = new Date(after);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= after) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return after + 60_000;
  }

  /**
   * Schedule-store inspection — for tests and diagnostics.
   */
  async listJobs() {
    return this.#store.listAll();
  }
}
