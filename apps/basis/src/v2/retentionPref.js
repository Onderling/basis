/**
 * retentionPref — the windowed-content retention model, and the age choices the CLEANUP control offers.
 *
 * Since the chat-lane sitting the conversation itself is RECORD class — it never expires by POLICY.
 * What the user gets instead (Frits: "an explicit cleanup control") is a deliberate, clearly-destructive
 * act: "verwijder berichten ouder dan N dagen" — `eventLog.purgeConversation`, surfaced in My data. The
 * age choices below serve that control now.
 *
 * The retention WINDOWS still exist for the windowed classes (`short` plumbing · `chat`-class content
 * whose durable head lives elsewhere · `audit`, which compacts instead of dropping) — an internal tuning,
 * no longer a user promise about the conversation.
 *
 * Device-local: what THIS device keeps/cleans. Never fanned — telling a circle how long you keep its
 * messages would be a disclosure nobody asked you to make.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The age choices the cleanup control offers ("older than N days"), and the windowed-class windows. */
export const RETENTION_CHOICES_DAYS = Object.freeze([7, 14, 30, 90]);

// Parameter register (#36) — INTERNAL since the cleanup redesign: the conversation no longer expires by
// policy, so there is no user promise here to keep settable; this default only feeds the windowed-class
// windows (`retentionFromDays`). The user-facing act is `purgeConversation`, an operation, not a param.
export const DEFAULT_RETENTION_DAYS = param({ key: 'retention.chatDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 14 });

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
