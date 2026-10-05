/**
 * Where a person's things live on their own node (web and mobile, one declaration both shells spread — as the box spreads
 * `HOUSEHOLD_BOT_STORE_OPTS`): a circle's appointments are typed items in that circle's ONE store (`circleCalendarOps`),
 * read and written with the circle's id — the same items a household bot writes, so whatever the circle holds is what
 * its members see. An appointment of no circle stays on the person's own calendar (`personalCalendar`).
 */
export const PERSON_NODE_STORE_OPTS = Object.freeze({
  calendarInCircle: true,
  personalCalendar: true,
});
