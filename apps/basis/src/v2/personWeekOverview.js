/**
 * The person's own week overview — the household bot's Sunday overview made personal, with no bot.
 *
 * A planned row in the person's own store (Saturday 09:00, the rest of that day), switched on and off from Gepland on
 * Mij. The person's clock runs it while the app is open: a card of their coming week — the same projection Gepland
 * paints (`plannedForMe`) — which says honestly that it shows when the app is open: a phone paints, it does not wake.
 * Their own store fans between their devices, so the card shows once, on whichever device they open first; a companion
 * of theirs may later deliver it on time.
 */
import { plannedForMe, plannedLines } from './plannedForMe.js';

/** The op the row runs (a basis op: `localBuiltins`). */
export const PERSON_WEEK_OP = 'personWeekOverview';
const LABEL = 'my-week-overview';
const TRIGGER = Object.freeze({ every: 'week', on: 'sat', at: '09:00' });

/** Is the person's week overview on? */
export const personWeekOn = (book, me) => book.openFor(me, PERSON_WEEK_OP).length > 0;

/** Switch it: on writes the one row (twice on is still one); off cancels it. */
export async function switchPersonWeek(book, me, on) {
  const open = book.openFor(me, PERSON_WEEK_OP);
  if (on) {
    if (open.length) return open[0];
    return book.intend({ trigger: { ...TRIGGER }, op: PERSON_WEEK_OP, appOrigin: 'basis', args: {}, actsAs: me, label: LABEL, window: 'day' });
  }
  for (const r of open) await book.cancel(r.id);
  return null;
}

/**
 * The card: the person's coming week, in their words, and the line that says when it shows.
 * @returns {Promise<{title: string, lines: string[], note: string}>}
 */
export async function personWeekCard({ callSkill, me, t, tz, lang = 'nl', now = Date.now() }) {
  const r = await plannedForMe({ callSkill, me, horizonDays: 7, now });
  return {
    title: t('circle.profile.week_card_title'),
    lines: plannedLines(r.items ?? [], { t, tz, lang }),
    note: t('circle.profile.week_card_note'),
  };
}
