/**
 * Scheduler — Phase 4 convergence.  Owns the NudgeTimer + DailyDigest
 * lifecycle, listens for agent state-updates, and posts the resulting
 * skill replies via a `postToChat` callable.
 *
 * Construction:
 *
 *   const scheduler = new Scheduler({
 *     store, postToChat, primaryChatId, household, isSuppressed,
 *   });
 *   await scheduler.start();
 *   ...
 *   await scheduler.stop();
 *
 * The scheduler is invoked by the HouseholdAgent on every state update
 * a skill emits (`onStateUpdate`).  The agent doesn't know about
 * NudgeTimer or DailyDigest individually; just hands the scheduler
 * the state stream and the dispatch callback.
 *
 * v0 simplification: a single "primaryChatId" is the post target for
 * the daily digest.  The nudge fires in the chat the triggering item
 * lived on.  Multi-chat-per-household digests can come later.
 *
 * 5.7c — `isSuppressed: (recipient, kind, now) => boolean|Promise<boolean>`
 * is an optional cross-circle availability hook (typically backed by
 * `isPushSuppressed(availability, now)` from
 * basis's `src/v2/memberAvailability.js`).  When it returns truthy
 * the scheduled digest / nudge is skipped instead of posted.  The
 * predicate is consulted JUST BEFORE the postToChat dispatch so that
 * builders + state updates still run normally; only the user-visible
 * delivery is suppressed.  `setSuppressionPredicate(fn)` lets the host
 * wire the hook late once an async availability store loads.  Mirrors
 * the Notifier suppression contract from 5.7b so a future migration to
 * the substrate Notifier is a drop-in.
 */

import { NudgeTimer }     from './NudgeTimer.js';
import { DailyDigest }    from './DailyDigest.js';
import { nudgeCompletion } from '../skills/nudgeCompletion.js';
import { composeDigest }  from '../skills/composeDigest.js';

/**
 * Single nudge timer per chat — Q-H2.7 lock: "1 h after last
 * activity in this chat".  Per-item timers would over-nudge.
 */
const NUDGE_KEY = '__chat_nudge__';

export class Scheduler {
  /** @type {NudgeTimer} */ #nudge;
  /** @type {DailyDigest} */ #digest;
  /** @type {import('../storage/Store.js').Store} */ #store;
  /** @type {(chatId: string, replies: Array) => Promise<void>} */ #postToChat;
  /** @type {string} */ #primaryChatId;
  /** @type {Map<string, Set<string>>} chatId → set of pending itemIds */
  #pendingByChat = new Map();
  #started = false;

  /** @type {((recipient: string, kind: 'digest'|'nudge', now: number) => boolean|Promise<boolean>) | null} */
  #isSuppressed = null;
  /** @type {() => number} */
  #now = () => Date.now();

  /**
   * @param {object} args
   * @param {import('../storage/Store.js').Store} args.store
   * @param {(chatId: string, replies: Array) => Promise<void>} args.postToChat
   * @param {string} args.primaryChatId    where the daily digest posts
   * @param {import('../types.js').HouseholdSettings} [args.household]
   *   tz + nudgeDelayMs + digestAtLocal lifted from HouseholdConfig.settings
   * @param {(recipient: string, kind: 'digest'|'nudge', now: number) => boolean|Promise<boolean>} [args.isSuppressed]
   *   5.7c — optional availability/quiet-hours predicate.  Truthy = skip
   *   the post (the schedule re-arms regardless).  Typically wraps
   *   `isPushSuppressed(getAvailability(recipient), now)` from
   *   basis's memberAvailability substrate.
   * @param {() => number} [args.now]      test seam
   */
  constructor({
    store, postToChat, primaryChatId, household = {}, isSuppressed, now,
  } = {}) {
    if (!store)                            throw new Error('Scheduler: store required');
    if (typeof postToChat !== 'function')  throw new Error('Scheduler: postToChat required');
    if (!primaryChatId)                    throw new Error('Scheduler: primaryChatId required');

    this.#store          = store;
    this.#postToChat     = postToChat;
    this.#primaryChatId  = primaryChatId;
    this.#isSuppressed   = typeof isSuppressed === 'function' ? isSuppressed : null;
    if (typeof now === 'function') this.#now = now;

    this.#nudge = new NudgeTimer({
      delayMs: household.nudgeDelayMs ?? 60 * 60 * 1000,    // 1h per Q-H2.7
      onFire:  ({ chatId, itemId }) => this.#fireNudge(chatId, itemId),
    });

    this.#digest = new DailyDigest({
      tz:       household.tz ?? 'UTC',
      atLocal:  household.digestAtLocal ?? '20:00',          // Q-H2.7
      onFire:   () => this.#fireDigest(),
    });
  }

  start() {
    if (this.#started) return;
    this.#started = true;
    this.#digest.start();
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    this.#nudge.stop();
    this.#digest.stop();
  }

  /**
   * Called by HouseholdAgent after each onMessage cycle.  One state
   * update per call.  Routes to the right internal handler.
   *
   * @param {import('../types.js').StateUpdate} update
   */
  onStateUpdate(update) {
    if (!update?.kind) return;
    const { kind, itemId, chatId } = update;

    if (kind === 'item.added') {
      const set = this.#pendingByChat.get(chatId) ?? new Set();
      set.add(itemId);
      this.#pendingByChat.set(chatId, set);
      // ONE timer per chat ("1 h after last activity in this chat" per
      // Q-H2.7).  NudgeTimer.schedule resets on the same key.
      this.#nudge.schedule(chatId, NUDGE_KEY);
      return;
    }
    if (kind === 'item.completed' || kind === 'item.removed') {
      const set = this.#pendingByChat.get(chatId);
      if (set) {
        set.delete(itemId);
        if (set.size === 0) {
          this.#pendingByChat.delete(chatId);
          // No more pending items in this chat → cancel the timer.
          this.#nudge.cancel(chatId, NUDGE_KEY);
        }
      }
      return;
    }
  }

  /**
   * Force-fire the daily digest now (Settings UX in Phase 5; useful
   * for e2e tests).
   *
   * 5.7c — the suppression predicate is consulted just like a scheduled
   * fire, so users can verify their quiet-hours config from the
   * settings UX ("send now" honours the same gate the scheduler does).
   * Pass `force: true` to bypass suppression (e.g. an admin-issued
   * /digest command).
   */
  async fireDigestNow({ force = false } = {}) {
    await this.#fireDigest({ force });
  }

  /**
   * 5.7c — register / replace the suppression predicate after
   * construction.  Useful when the cross-circle availability store
   * loads asynchronously at boot (basis pattern).  Pass `null`
   * to disable.
   *
   * @param {((recipient: string, kind: 'digest'|'nudge', now: number) => boolean|Promise<boolean>) | null} fn
   */
  setSuppressionPredicate(fn) {
    this.#isSuppressed = typeof fn === 'function' ? fn : null;
  }

  // ── internal ─────────────────────────────────────────────────────

  async #fireNudge(chatId, itemId) {
    const pending = this.#pendingByChat.get(chatId);
    const itemIds = pending ? [...pending] : [itemId];
    // Drain the per-chat pending set — they're getting nudged about.
    this.#pendingByChat.delete(chatId);

    const ctx = { store: this.#store, chatId, senderWebid: null, bridgeId: null };
    let reply;
    try { reply = await nudgeCompletion({ chatId, itemIds }, ctx); }
    catch (err) {
      console.error('[Scheduler] nudgeCompletion failed:', err?.message ?? err);
      return;
    }
    if (!reply.replies?.length) return;
    if (await this.#shouldSuppress(chatId, 'nudge')) return;
    try { await this.#postToChat(chatId, reply.replies); }
    catch (err) {
      console.error('[Scheduler] postToChat (nudge) failed:', err?.message ?? err);
    }
  }

  async #fireDigest({ force = false } = {}) {
    const ctx = { store: this.#store, chatId: this.#primaryChatId, senderWebid: null, bridgeId: null };
    let reply;
    try { reply = await composeDigest({ chatId: this.#primaryChatId }, ctx); }
    catch (err) {
      console.error('[Scheduler] composeDigest failed:', err?.message ?? err);
      return;
    }
    if (!reply.replies?.length) return;
    if (!force && await this.#shouldSuppress(this.#primaryChatId, 'digest')) return;
    try { await this.#postToChat(this.#primaryChatId, reply.replies); }
    catch (err) {
      console.error('[Scheduler] postToChat (digest) failed:', err?.message ?? err);
    }
  }

  /**
   * 5.7c — consult the optional suppression predicate.  A throwing
   * predicate is treated as "do not suppress" so a broken hook never
   * silently swallows a user-facing post (mirrors the Notifier 5.7b
   * contract).
   */
  async #shouldSuppress(recipient, kind) {
    if (!this.#isSuppressed) return false;
    try {
      return !!(await this.#isSuppressed(recipient, kind, this.#now()));
    } catch (err) {
      console.warn('[Scheduler] isSuppressed threw — delivering anyway:', err?.message ?? err);
      return false;
    }
  }
}
