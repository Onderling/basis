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
  if (has('weekOverview')) lines.push(t('circle.bot.welcome_week'));

  // reminders go to the people who can be reminded: not an observer (the projection skips them too)
  if (role !== 'observer' && has('assistant-reminders')) {
    if (settings.reminders === 'off') lines.push(t('circle.bot.welcome_reminders_off'));
    else {
      const [from, to] = String(settings.quiet || QUIET_HOURS).split('-');
      lines.push(t('circle.bot.welcome_reminders_on', { from, to }));
    }
    // the weekly overview is off until the person switches it on: its own line, after either reminders line
    if (has('assistant-overview')) lines.push(t('circle.bot.welcome_overview'));
  }
  if (role === 'admin') lines.push(t('circle.bot.welcome_admin'));
  return lines;
}

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
