/**
 * retentionPref — how long this device keeps the conversation.
 *
 * The mechanism is per-KIND (one-log step D: `short` plumbing · `chat` · `audit`, where audit compacts
 * instead of dropping). The SETTING deliberately exposes **only the chat window** (Frits, 2026-07-28):
 * it is the one number a person has an opinion about. Plumbing retention is an implementation detail
 * nobody should have to reason about, and the audit window is not a "how long do I keep things"
 * question at all — audit entries compact rather than disappear, so a control there would promise a
 * deletion it does not perform. If someone later asks for the audit window, it joins as a second line;
 * shipping three controls now would be a settings farm answering a question nobody asked.
 *
 * Device-local: retention is what THIS device keeps. It is not a circle policy and is never fanned —
 * telling a circle how long you keep its messages would be a disclosure nobody asked you to make.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The offered chat windows, in days. */
export const RETENTION_CHOICES_DAYS = Object.freeze([7, 14, 30, 90]);

// Parameter register (#36) — a GENUINE user preference (the chat-retention window a person actually has an
// opinion about) and explicitly device-scoped ("what THIS device keeps... not a circle policy"): scope:device,
// kind:user. Declared here for discoverability + the stale-param census; its SETTABLE home stays the existing
// retention setting (do NOT also route it through set-param — double-homing would be drift). Folding that
// bespoke set into the one set-param op is part of the register's read/set adoption (REMAINING-WORK L24).
/** The decided default — unchanged by this setting existing. */
export const DEFAULT_RETENTION_DAYS = param({ key: 'retention.chatDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 14 });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days → ms. */
export const daysToMs = (days) => days * DAY_MS;

/**
 * Normalise a stored value to one of the offered choices. Anything else — a hand-edited store, a value
 * from a future version — falls back to the default rather than to "keep forever" or "keep nothing":
 * both of those are answers the user never gave.
 *
 * @param {*} stored
 * @returns {number} days
 */
export function normalizeRetentionDays(stored) {
  const n = typeof stored === 'number' ? stored : Number(stored);
  return RETENTION_CHOICES_DAYS.includes(n) ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * The per-class retention map the EventLog takes, built from the chat choice.
 *
 * `short` follows chat but is never longer than it (plumbing outliving the conversation it describes
 * would be backwards) and never longer than its own 7-day default. `audit` tracks the chat window as
 * its DETAIL window — past it, entries compact into a summary rather than dropping, which is why one
 * control can honestly govern both.
 *
 * @param {number} [days]
 * @returns {{short: number, chat: number, audit: number}}
 */
export function retentionFromDays(days = DEFAULT_RETENTION_DAYS) {
  const chat = daysToMs(normalizeRetentionDays(days));
  return {
    short: Math.min(chat, daysToMs(7)),
    chat,
    audit: chat,
  };
}

// The `localStorageRetentionIo` / `asyncStorageRetentionIo` bespoke stores (key `cc.retentionDays`) were
// RETIRED 2026-08-10 (#36): the chat-retention window is now a registered param (`retention.chatDays`,
// device/user), set through `callSkill('params','set-param',…)` and read via the register. `DEFAULT_RETENTION_DAYS`
// (the `param()` above) + `normalizeRetentionDays` + `retentionFromDays` remain the shared model.
