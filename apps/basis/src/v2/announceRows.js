/**
 * announceRows — what a change tells others, as planned work a household can see and switch: two rows in the
 * household's own store, each an event trigger whose op is the announcer. "New, moved or cancelled appointments" and
 * "a chore given to you, or its day moved". Cancelling a row switches that kind of message off for the household; a
 * cancelled row is never seeded again.
 *
 * The rows act as the HOUSEHOLD, not as a person: the host's runner calls the op as itself (the door refuses it from
 * anyone else), and the announcer decides who hears what — never the one who made the change.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The door's op the rows call. */
export const ANNOUNCE_OP = 'announceChange';
/** Whom an announce row acts as: the household itself (the host), never a person. */
export const HOUSEHOLD_ACTS_AS = 'household';
/**
 * The mark of a call the HOST makes as itself (its runner, for a household row). A Symbol: no message, screen call or
 * model tool can carry one, so nothing from outside can make the door believe the host is calling.
 */
export const HOST_CALL = Symbol('host-call');

/** The household's announce rows: one per kind of item, the announcements each may make. */
export const ANNOUNCE_ROWS = Object.freeze([
  Object.freeze({ label: 'announce-appointments', trigger: Object.freeze({ event: Object.freeze({ kind: 'any', type: 'calendar-event' }) }), args: Object.freeze({ kinds: Object.freeze(['new', 'moved', 'cancelled']) }) }),
  Object.freeze({ label: 'announce-chores', trigger: Object.freeze({ event: Object.freeze({ kind: 'any', type: 'task' }) }), args: Object.freeze({ kinds: Object.freeze(['given', 'moved']) }) }),
]);

/** Is this one of the household's announce rows — a kind of change it tells (whatever its state)? */
export const isAnnounceRow = (row) => row?.op === ANNOUNCE_OP && row?.actsAs === HOUSEHOLD_ACTS_AS && ANNOUNCE_ROWS.some((spec) => spec.label === row.label);

/**
 * A reminder for everyone ("herinner iedereen om 19:45: eten"): a timed household row whose op is the announcer, with the
 * words to say (`args.say`). It acts as the household like the announce rows, and is said to everyone at its moment.
 */
export const REMIND_EVERYONE_LABEL = 'remind-everyone';
/**
 * A reminder of one's own at a time ("herinner me over 10 minuten: …"): a timed row acting as the PERSON, on the host's
 * own store (where a Telegram-only person's rows live), whose op says the words in their private chat.
 */
export const REMIND_ME_LABEL = 'remind-me';
/** The door's op a reminder of one's own runs at its moment (the host's runner calls it, as the person). */
export const SAY_REMINDER_OP = 'sayReminder';
/**
 * How long after its moment a timed reminder (one's own, or for everyone) may still be said (a box that was off): after
 * that it is skipped.
 */
export const TIMED_REMINDER_WINDOW_MIN = param({ key: 'assistant.timedReminderWindowMinutes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 });

/**
 * Write the household's announce rows once, into the circle store named by `scope`, each watching THAT circle only: a
 * row that exists — open, or cancelled (switched off) — is left as it is. Returns how many were written.
 * @param {ReturnType<import('./intentionBook.js').createIntentionBook>} book
 * @param {string} scope   the household's circle id
 */
export async function seedAnnounceRows(book, scope) {
  if (!scope) return 0;
  await book.load();
  const mine = book.rows().filter((r) => isAnnounceRow(r) && book.scopeOf(r.id) === scope);
  // rows seeded before rows were signed, or signed under an older version: signed now by this host (a host runs no
  // unsigned circle row; `book.sign` leaves a current signature as it is)
  for (const r of mine) { try { await book.sign(r.id); } catch { /* said when it is refused */ } }
  const have = new Set(mine.map((r) => r.label));
  let made = 0;
  for (const spec of ANNOUNCE_ROWS) {
    if (have.has(spec.label)) continue;
    await book.intend({
      // the household's own circle only: a bot that joined another circle never announces that circle's changes here
      trigger: { event: { ...spec.trigger.event, circleId: scope } }, op: ANNOUNCE_OP, appOrigin: 'assistant',
      args: JSON.parse(JSON.stringify(spec.args)), actsAs: HOUSEHOLD_ACTS_AS, label: spec.label, scope,
    });
    made += 1;
  }
  return made;
}

/**
 * How a host's runner hands a due row to its door — ONE composition for the box and its tests: the household's announce
 * rows (and its reminders for everyone) run as the host itself (only that op ever carries the host's mark); a person's row
 * as that person, through their own column of the door.
 * @param {{door: (app: string, op: string, args: object, ctx: object) => Promise<any>, callerFor?: (actsAs: string) => Promise<string|null>}} a
 * @returns {(o: {op: string, appOrigin?: string, actsAs: string, args?: object, id: string}) => Promise<any>}
 */
export function runRowThroughDoor({ door, callerFor = async () => null }) {
  return async (o) => {
    if (o.op === ANNOUNCE_OP && o.actsAs === HOUSEHOLD_ACTS_AS) return door(o.appOrigin ?? 'assistant', o.op, { ...o.args, occurrence: o.id }, { [HOST_CALL]: true });
    // as the person, through their own column of the door (a member's key maps to the row of the person it names)
    const as = (await callerFor(o.actsAs)) ?? o.actsAs;
    return door(o.appOrigin ?? 'assistant', o.op, { ...o.args, occurrence: o.id }, { caller: as, threadId: as });
  };
}
