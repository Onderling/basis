/**
 * Reminder rules — a CLOSED vocabulary of the dictionary, and the time anchors it applies to.
 *
 * A rule says when, relative to an item's moment, someone is reminded:
 *   `morning`          08:00 on the item's day;
 *   `evening-before`   19:00 the evening before;
 *   `before:<minutes>` that long before its time (1–10080);
 *   `at:<HH:MM>`       at that time on its day.
 * Nothing else is a rule: a new kind needs a journey that fails without it. Rules live in layers (the household's,
 * a person's own default, the item's own, a person's own for one item); which apply is the projection's business.
 *
 * A type that has a moment declares which field it is — its TIME ANCHOR. Any type with an anchor can be reminded of.
 */

/** The four kinds. */
export const REMINDER_RULE_KINDS = Object.freeze({
  morning: 'morning',
  'evening-before': 'evening-before',
  before: 'before',
  at: 'at',
});

const BEFORE = /^before:([1-9]\d{0,4})$/;
const AT = /^at:([01]\d|2[0-3]):([0-5]\d)$/;
/** A week: the longest "before" that is still a reminder rather than a plan of its own. */
const MAX_BEFORE_MINUTES = 7 * 24 * 60;

/**
 * Parse a reminder rule string; null when it is not one of the four kinds (or a `before` longer than a week).
 * @param {unknown} s
 * @returns {{kind: 'morning'|'evening-before'|'before'|'at', rule: string, minutes?: number, time?: string}|null}
 */
export function parseReminderRule(s) {
  if (typeof s !== 'string') return null;
  if (s === 'morning' || s === 'evening-before') return { kind: s, rule: s };
  const b = BEFORE.exec(s);
  if (b) { const minutes = Number(b[1]); return minutes <= MAX_BEFORE_MINUTES ? { kind: 'before', minutes, rule: s } : null; }
  const a = AT.exec(s);
  if (a) return { kind: 'at', time: `${a[1]}:${a[2]}`, rule: s };
  return null;
}

/** Is `s` a valid reminder rule? */
export const isReminderRule = (s) => parseReminderRule(s) !== null;

/** Type → the field that is its moment. */
export const TIME_ANCHORS = Object.freeze({ 'calendar-event': 'startsAt', task: 'dueAt' });

/** The field that is this type's moment, or null when the type has none. */
export const timeAnchorOf = (type) => (Object.prototype.hasOwnProperty.call(TIME_ANCHORS, type) ? TIME_ANCHORS[type] : null);

/**
 * The field an item with a moment carries for ITS reminders: the household's statement about the item (synced like any
 * content field), set by whoever may edit the item. `replace` stands instead of the layers below it; `add` keeps them.
 * A person's own reminders for an item are theirs and never live on the item.
 */
export const ITEM_REMINDERS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['mode', 'rules'],
  properties: {
    mode: { enum: ['replace', 'add'] },
    rules: { type: 'array', items: { type: 'string' } },
  },
});
