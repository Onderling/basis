/**
 * botWelcome — a new person's first message, derived: what THIS bot does for THEM.
 *
 * A projection over two sources: the ops the person's role reaches (the door's catalogue as scoped to them) and the
 * household's settings. One line per thing those ops reach — the template's plain lists by name, its chores list, its
 * Agenda, the week overview — then the reminders as they stand (on, with the quiet hours and the person's own switches;
 * or off for the household) and, for the admin, where the household's settings are. A bot without the calendar never
 * offers the Agenda; an observer reads along and is told only that.
 */
import { QUIET_HOURS } from './botReminders.js';

/**
 * @param {object} a
 * @param {Set<string>} a.ops  the op ids this person's role reaches
 * @param {Array<{name: string, defaultChild?: string|null}>} a.lists  the template's lists (`templateLists`)
 * @param {string|null} [a.role]
 * @param {{reminders?: string, quiet?: string}} [a.settings]
 * @param {(key: string, vars?: object) => string} a.t
 * @returns {string[]}
 */
export function welcomeLines({ ops, lists = [], role = null, settings = {}, t }) {
  const has = (op) => ops.has(op);
  const lines = [];
  const plain = lists.filter((l) => !l.defaultChild).map((l) => l.name);
  const chores = lists.find((l) => l.defaultChild === 'task');
  const agenda = lists.find((l) => l.defaultChild === 'calendar-event');

  if (!has('addToList') && !has('addEvent')) {
    lines.push(t('circle.bot.welcome_reader'));
  } else {
    if (has('addToList') && plain.length) lines.push(t('circle.bot.welcome_lists', { lists: plain.join(', ') }));
    if (has('addToList') && chores && has('claimTask')) lines.push(t('circle.bot.welcome_chores', { list: chores.name }));
    if (has('addEvent') && agenda) lines.push(t('circle.bot.welcome_agenda', { list: agenda.name }));
  }
  if (has('addToList') && has('createList')) lines.push(t('circle.bot.welcome_own_lists'));
  if (has('makeChore')) lines.push(t('circle.bot.welcome_make_chore'));
  if (has('shopVisit')) lines.push(t('circle.bot.welcome_shop'));
  if (has('weekOverview')) lines.push(t('circle.bot.welcome_week'));
  if (has('assistant-people')) lines.push(t('circle.bot.welcome_people'));
  if (has('assistant-screen')) lines.push(t('circle.bot.welcome_screen'));
  if (has('assistant-link')) lines.push(t(has('assistant-inapp') && settings.inApp === 'on' ? 'circle.bot.welcome_link_inapp' : 'circle.bot.welcome_link'));

  // reminders go to the people who can be reminded: not an observer (the projection skips them too)
  if (role !== 'observer' && has('assistant-reminders')) {
    if (settings.reminders === 'off') lines.push(t('circle.bot.welcome_reminders_off'));
    else {
      const [from, to] = String(settings.quiet || QUIET_HOURS).split('-');
      lines.push(Number(settings.lead) > 0 ? t('circle.bot.welcome_reminders_on_lead', { from, to, lead: settings.lead }) : t('circle.bot.welcome_reminders_on', { from, to }));
    }
    // the weekly overview is off until the person switches it on: its own line, after either reminders line
    if (has('assistant-overview')) lines.push(t('circle.bot.welcome_overview'));
    if (has('assistant-quiet')) lines.push(t('circle.bot.welcome_quiet'));
  }
  if (role === 'admin') lines.push(t('circle.bot.welcome_admin'));
  return lines;
}

/**
 * Every op a person can reach is SAID in the welcome (the line that says it is in `welcomeLines`) or LEFT OUT on purpose,
 * with the reason. `test/fitness/welcomeSaysEveryCommand.test.js` fails on an op in neither: a new command is a new
 * line here, or a reason here — never forgotten (Frits 2026-10-06: "the welcome must be updated each time").
 */
export const WELCOME_SAYS = Object.freeze({
  addToList: "welcome_lists",
  createList: "welcome_own_lists",
  removeList: "welcome_own_lists",
  restoreList: "welcome_own_lists",
  makeChore: "welcome_make_chore",
  shopVisit: "welcome_shop",
  claimTask: "welcome_chores",
  addEvent: "welcome_agenda",
  weekOverview: "welcome_week",
  "assistant-people": "welcome_people",
  "assistant-screen": "welcome_screen",
  "assistant-link": "welcome_link",
  "assistant-inapp": "welcome_link_inapp",
  "assistant-reminders": "welcome_reminders_on",
  "assistant-overview": "welcome_overview",
  "assistant-quiet": "welcome_quiet",
  "assistant-settings": "welcome_admin",
});
export const WELCOME_LEAVES = Object.freeze({
  'assistant-planned': "asked when wanted ('wat ga je me sturen?'); /help lists it — the reminders line says when reminders come",
  entryReminders: "asked in words ('herinner iedereen ook de avond ervoor aan de tandarts'); the reminders line says when reminders come",
  remindMe: "asked in words ('herinner me een uur van tevoren aan de tandarts'); the reminders line says how to change your own",
  sendWeekOverview: "not typed: the host's runner sends it to whoever switched the overview on (said on the overview line)",
  listLists: "part of the lists line: reading a list is said there",
  listEntries: "part of the lists line: reading a list is said there",
  markListItemDone: "part of the lists line (\"melk is gekocht\")",
  removeFromList: "part of the lists line; /help has it",
  editEntry: "a refinement of the lists line; /help has it",
  completeTask: "part of the chores line (\"de ramen zijn klaar\")",
  listMine: "part of the chores line; /help has it",
  removeTask: "an admin (or flat) chore tool; /help and the screen have it",
  reassignTask: "an admin (or flat) chore tool; /help and the screen have it",
  editTask: "an admin (or flat) chore tool; /help and the screen have it",
  listEvents: "part of the agenda line (\"wat staat er in de agenda\")",
  rsvpAccept: "a reply to an appointment, offered on the appointment itself",
  rsvpDecline: "a reply to an appointment, offered on the appointment itself",
  rsvpTentative: "a reply to an appointment, offered on the appointment itself",
  cancelEvent: "part of the agenda; /help has it",
  "assistant-memory": "a personal setting: /instellingen lists it",
  "assistant-language": "a personal setting: /instellingen lists it",
  "assistant-menu": "the settings menu itself, named in the reminders line",
  "assistant-view": "a personal setting: /instellingen lists it",
  "assistant-usage": "a count of the model's use; /help has it",
  "assistant-unlink": "the undo of /koppel, said in its reply",
  "assistant-link-confirm": "a follow-up step of /koppel (the code), offered in its reply",
  "assistant-screen-paste": "a follow-up step of /scherm, offered in its reply",
  "assistant-screen-confirm": "a follow-up step of /scherm, offered in its reply",
  "assistant-screens": "the list of one's own screens, offered after /scherm",
  "assistant-screen-approve": "the admin's yes to a screen's request, asked in their chat",
  "assistant-role": "an admin tool: the admin line points to /help",
  "assistant-status": "an admin tool: the admin line points to /help",
  "assistant-users": "an admin tool: the admin line points to /help",
  "assistant-cohort": "an admin tool: the admin line points to /help",
  "assistant-invite": "an admin tool: the admin line points to /help",
  "assistant-rotate": "an admin tool: the admin line points to /help",
  "assistant-circle": "an admin tool: the admin line points to /help",
  "assistant-circles": "an admin tool: the admin line points to /help",
  "assistant-revoke": "an admin tool: the admin line points to /help",
  "assistant-export-key-set": "an admin tool: the admin line points to /help",
  "assistant-export-key-unlock": "an admin tool: the admin line points to /help",
  "assistant-exports": "an admin tool: the admin line points to /help",
  "assistant-export": "an admin tool: the admin line points to /help",
  "assistant-import": "an admin tool: the admin line points to /help",
});

/**
 * What works WITHOUT the model (it is off, or not answering): the word rules the door takes itself, for the person's
 * tools, and where the commands are. Said instead of "I only understand commands" — the person learns what to type.
 * @param {object} a
 * @param {Set<string>} a.ops  the op ids this person's role reaches
 * @param {Array<{name: string, defaultChild?: string|null}>} a.lists
 * @param {(key: string, vars?: object) => string} a.t
 * @returns {string[]}
 */
export function basicModeLines({ ops, lists = [], t }) {
  const has = (op) => ops.has(op);
  const plain = lists.filter((l) => !l.defaultChild);
  const chores = lists.find((l) => l.defaultChild === 'task');
  const lines = [];
  const first = plain[0]?.name;
  if (first && has('addToList')) lines.push(t('circle.bot.basic_add', { list: first.toLowerCase() }));
  if (first && has('listEntries')) lines.push(t('circle.bot.basic_read', { list: first.toLowerCase() }));
  if (first && has('removeFromList')) lines.push(t('circle.bot.basic_remove'));
  if (chores && has('addToList')) lines.push(t('circle.bot.basic_chore'));
  if (has('claimTask')) lines.push(t('circle.bot.basic_claim'));
  if (has('listMine')) lines.push(t('circle.bot.basic_mine'));
  if (has('markListItemDone') || has('completeTask')) lines.push(t('circle.bot.basic_done'));
  if (has('addEvent')) lines.push(t('circle.bot.basic_appt'));
  if (has('weekOverview')) lines.push(t('circle.bot.basic_week'));
  lines.push(t('circle.bot.basic_help'));
  return lines;
}
