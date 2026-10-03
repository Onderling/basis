/**
 * Where a household bot's things live: its lists, chores and appointments are typed items in the household circle's
 * ONE store, each with its noun's verbs over that store (`listsOps`, `tasksOps`, `circleCalendarOps`). One
 * declaration, spread by the box (`bin/device-runner.mjs`) and by every test that composes the bot — so a test can
 * never boot a bot whose chores live somewhere the box's do not.
 */
export const HOUSEHOLD_BOT_STORE_OPTS = Object.freeze({
  tasksCircleId: 'household',
  calendarInCircle: true,
  tasksInCircle: true,
});
