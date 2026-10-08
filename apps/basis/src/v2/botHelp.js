/**
 * botHelp — `/help` on a household bot, for a person: their commands in their language, grouped (lists, chores, the
 * agenda, their own settings, and the admin's last), each with a short line of what it does — never the manifest's
 * developer hint ("Compare-and-swap claim a task", seen on the real bot 2026-10-02). The lines are the locale's
 * `circle.bot.help.ops.<app>.<op>`; every op on the bot's map has one (`test/fitness/botHelpComplete.test.js`).
 */

import { botOpLevel } from './botOpMap.js';
import { reminderRuleLine } from './botReminders.js';
import { HOUSEHOLD_RULES_DEFAULT } from './botSettings.js';

const SECTION_OF = { lists: 'lists', tasks: 'chores', calendar: 'agenda', assistant: 'you' };
const ORDER = ['lists', 'chores', 'agenda', 'you', 'admin'];

/** Is this op the admin's on the bot: the assistant's own by its visibility, the rest by their level on the bot's map. */
export const isAdminOp = (entry) => (entry?.appOrigin === 'assistant' ? entry?.op?.visibility === 'trusted' : botOpLevel(`${entry?.appOrigin}.${entry?.op?.id}`) === 'trusted');

/** The person's commands by section, in `/help`'s order: `[section, entries]`, empty sections left out. */
function botHelpGroups(commandMenu, opsById, isAdmin = isAdminOp) {
  const groups = new Map(ORDER.map((s) => [s, []]));
  for (const e of commandMenu ?? []) {
    const entry = opsById?.get?.(e.opId);
    if (!entry?.appOrigin || !entry?.op?.id) continue;
    groups.get(isAdmin(entry) ? 'admin' : (SECTION_OF[entry.appOrigin] ?? 'you')).push(e);
  }
  return [...groups].filter(([, rows]) => rows.length);
}

/** The person's commands in `/help`'s order (the Telegram menu lists them so). */
export const botHelpOrder = (commandMenu, opsById) => botHelpGroups(commandMenu, opsById).flatMap(([, rows]) => rows);

/**
 * @param {object} a
 * @param {Array<{command: string, opId: string}>} a.commandMenu  the person's commands (their role's catalogue)
 * @param {{get: Function}} a.opsById  the catalogue's op entries
 * @param {(entry: object) => boolean} [a.isAdmin]  is this op the admin's (default: their level on the bot's map)
 * @param {(key: string, params?: object) => string} a.t  the person's translator
 * @param {{on?: boolean, rules?: string[]}} [a.reminders]  the household's reminders as they stand: when given, a person
 *        who has `/herinneringen` reads when the bot reminds (the welcome's own line) under their own commands
 * @returns {string[]} the lines, sections with their heading
 */
export function botHelpLines({ commandMenu, opsById, isAdmin = isAdminOp, t, reminders = null }) {
  const out = [];
  const remindable = reminders && (commandMenu ?? []).some((e) => opsById?.get?.(e.opId)?.op?.id === 'assistant-reminders');
  const remindLine = !remindable ? null
    : reminders.on === false ? t('circle.bot.welcome_reminders_off')
      : reminderRuleLine({ rules: Array.isArray(reminders.rules) ? reminders.rules : HOUSEHOLD_RULES_DEFAULT, t });
  for (const [s, rows] of botHelpGroups(commandMenu, opsById, isAdmin)) {
    if (out.length) out.push('');
    out.push(`${t(`circle.bot.help.sections.${s}`)}:`, ...rows.map((e) => {
      const entry = opsById.get(e.opId);
      const key = `circle.bot.help.ops.${entry.appOrigin}.${entry.op.id}`;
      const line = t(key);
      return line && line !== key ? `${e.command} — ${line}` : e.command;
    }));
    if (s === 'you' && remindLine) out.push(remindLine);
  }
  return out;
}
