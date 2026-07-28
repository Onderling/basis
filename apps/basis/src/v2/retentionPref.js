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

/** The offered chat windows, in days. */
export const RETENTION_CHOICES_DAYS = Object.freeze([7, 14, 30, 90]);

/** The decided default (OQ-7.B, 2026-05-22) — unchanged by this setting existing. */
export const DEFAULT_RETENTION_DAYS = 14;

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

/** localStorage-backed store (web). */
export function localStorageRetentionIo(storage = globalThis.localStorage) {
  const KEY = 'cc.retentionDays';
  return {
    load: () => { try { return normalizeRetentionDays(storage?.getItem(KEY)); } catch { return DEFAULT_RETENTION_DAYS; } },
    save: (days) => {
      try {
        const d = normalizeRetentionDays(days);
        if (d === DEFAULT_RETENTION_DAYS) storage?.removeItem(KEY);   // no key for "I changed nothing"
        else storage?.setItem(KEY, String(d));
      } catch { /* ignore */ }
    },
  };
}

/** AsyncStorage-backed store (mobile). Same key, same defaulting. */
export function asyncStorageRetentionIo(AsyncStorage) {
  const KEY = 'cc.retentionDays';
  return {
    load: async () => {
      try { return normalizeRetentionDays(await AsyncStorage?.getItem(KEY)); }
      catch { return DEFAULT_RETENTION_DAYS; }
    },
    save: async (days) => {
      try {
        const d = normalizeRetentionDays(days);
        if (d === DEFAULT_RETENTION_DAYS) await AsyncStorage?.removeItem(KEY);
        else await AsyncStorage?.setItem(KEY, String(d));
      } catch { /* ignore */ }
    },
  };
}
