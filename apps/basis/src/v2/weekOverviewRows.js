/**
 * The Sunday week overview as planned work. A person who wants it has ONE open intention row — every Sunday 18:00,
 * `sendWeekOverview`, as them — in the store of the device that serves them (on a household bot: the bot's
 * own-devices store, the bot being their device). Switching it on writes the row, off cancels it, and "is it on?" is
 * whether the row is open: the row is the one place it is kept.
 */

/** The op the row calls: it sends the overview to the caller's own door (it delivers its own result). */
export const WEEK_OVERVIEW_OP = 'sendWeekOverview';

/** The row, but for whom. Sunday from 18:00, the rest of that day (a Sunday overview is not sent on a Wednesday). */
export const WEEK_OVERVIEW_ROW = Object.freeze({
  trigger: Object.freeze({ every: 'week', on: 'sun', at: '18:00' }),
  op: WEEK_OVERVIEW_OP, appOrigin: 'assistant', args: Object.freeze({}), label: 'week-overview',
});

/** Is it on for this person? */
export const weekOverviewOn = (book, person) => book.openFor(person, WEEK_OVERVIEW_OP).length > 0;

/** On: one open row (never a second). Off: every open one cancelled. */
export async function switchWeekOverview(book, person, on) {
  const open = book.openFor(person, WEEK_OVERVIEW_OP);
  if (on && !open.length) await book.intend({ ...WEEK_OVERVIEW_ROW, trigger: { ...WEEK_OVERVIEW_ROW.trigger }, args: {}, actsAs: person });
  if (!on) for (const r of open) await book.cancel(r.id);
}

/**
 * The switch used to live on each person's thread row: a person whose row still says "on" gets their planned row,
 * and the thread row lets go of it. Run at boot; a second run finds nothing to move.
 * @returns {Promise<number>} how many rows were written
 */
export async function moveOverviewSwitchesToRows({ threads, users, book }) {
  let moved = 0;
  for (const u of (await users.list()) ?? []) {
    if (!u?.id || !threads.overviewOn(u.id)) continue;
    if (!weekOverviewOn(book, u.id)) { await switchWeekOverview(book, u.id, true); moved += 1; }
    threads.setOverview(u.id, false);
  }
  return moved;
}
