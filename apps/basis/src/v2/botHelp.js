/**
 * botHelp — `/help` on a household bot, for a person: their commands in their language, grouped (lists, chores, the
 * agenda, their own settings, and the admin's last), each with a short line of what it does — never the manifest's
 * developer hint ("Compare-and-swap claim a task", seen on the real bot 2026-10-02). The lines are the locale's
 * `circle.bot.help.ops.<app>.<op>`; every op on the bot's map has one (`test/fitness/botHelpComplete.test.js`).
 */

const SECTION_OF = { lists: 'lists', tasks: 'chores', calendar: 'agenda', assistant: 'you' };
const ORDER = ['lists', 'chores', 'agenda', 'you', 'admin'];

/**
 * @param {object} a
 * @param {Array<{command: string, opId: string}>} a.commandMenu  the person's commands (their role's catalogue)
 * @param {{get: Function}} a.opsById  the catalogue's op entries
 * @param {(entry: object) => boolean} a.isAdmin  is this op the admin's (their level)
 * @param {(key: string, params?: object) => string} a.t  the person's translator
 * @returns {string[]} the lines, sections with their heading
 */
export function botHelpLines({ commandMenu, opsById, isAdmin, t }) {
  const groups = new Map(ORDER.map((s) => [s, []]));
  for (const e of commandMenu ?? []) {
    const entry = opsById?.get?.(e.opId);
    const app = entry?.appOrigin; const op = entry?.op?.id;
    if (!app || !op) continue;
    const section = isAdmin(entry) ? 'admin' : (SECTION_OF[app] ?? 'you');
    const key = `circle.bot.help.ops.${app}.${op}`;
    const line = t(key);
    groups.get(section).push(line && line !== key ? `${e.command} — ${line}` : e.command);
  }
  const out = [];
  for (const s of ORDER) {
    const rows = groups.get(s);
    if (!rows.length) continue;
    if (out.length) out.push('');
    out.push(`${t(`circle.bot.help.sections.${s}`)}:`, ...rows);
  }
  return out;
}
