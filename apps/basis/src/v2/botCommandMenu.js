/**
 * botCommandMenu — a household bot's commands, handed to Telegram, so the "Menu" button beside the typing box lists them.
 *
 * The list is the one `/help` reads: the catalogue scoped to a role, each command with its help line in a language
 * (`circle.bot.help.ops.<app>.<op>`), in `/help`'s order. Telegram keeps a list per scope and per app language: every
 * private chat gets the member's list (in the bot's language, and in the other one for people whose Telegram speaks it);
 * a person whose role is not member gets their own role's list on their own chat, in the language they chose. What the
 * menu shows is a convenience — the gate still decides what each command does for whoever sends it.
 */
import { botHelpOrder } from './botHelp.js';

/** Telegram's rule for a command's name. */
const TELEGRAM_COMMAND = /^[a-z0-9_]{1,32}$/;
/** Telegram's limits: a hundred commands, a description of 1–256 characters. */
const MAX_COMMANDS = 100;
const MAX_DESCRIPTION = 256;
const LANGS = ['nl', 'en'];

/**
 * @param {object} a
 * @param {{commandMenu?: Array<{command: string, opId: string}>, opsById?: Map<string, object>}} a.catalogue  scoped to a role
 * @param {(key: string, params?: object) => string} a.t  the translator for the list's language
 * @returns {Array<{command: string, description: string}>}
 */
export function botCommandList({ catalogue, t }) {
  const out = [];
  const seen = new Set();
  for (const e of botHelpOrder(catalogue?.commandMenu ?? [], catalogue?.opsById)) {
    const command = String(e.command ?? '').replace(/^\//, '');
    if (!TELEGRAM_COMMAND.test(command) || seen.has(command)) continue;   // a qualified `app:op` or a dashed name: typed only
    const entry = catalogue.opsById?.get?.(e.opId);
    const key = `circle.bot.help.ops.${entry?.appOrigin}.${entry?.op?.id}`;
    const line = t(key);
    const description = (line && line !== key ? line : (entry?.op?.surfaces?.chat?.hint ?? command)).slice(0, MAX_DESCRIPTION);
    seen.add(command);
    out.push({ command, description });
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

/**
 * @param {object} a
 * @param {(commands: Array<{command: string, description: string}>, opts?: {chatId?: string, languageCode?: string, clear?: boolean}) => Promise<void>} a.setCommands  the Telegram door's
 * @param {() => object} a.catalogue  the bot's catalogue now
 * @param {(catalogue: object, role: string) => object} a.scopeToRole
 * @param {() => Promise<Array<{id: string, channel: string, uid?: string, role?: string}>>} a.users
 * @param {(personId: string) => string|null} a.langOf  the language a person chose (null: the bot's)
 * @param {(key: string, params?: object, lng?: string) => string} a.t
 * @param {string} [a.lang]  the bot's language
 */
export function createCommandMenus({ setCommands, catalogue, scopeToRole, users, langOf, t, lang = 'nl' }) {
  const own = new Set();   // the chats that carry their own list now
  const listFor = (role, lng) => botCommandList({ catalogue: scopeToRole(catalogue(), role), t: (k, p) => t(k, p, lng) });
  async function publish() {
    const base = LANGS.includes(lang) ? lang : 'nl';
    await setCommands(listFor('member', base));
    for (const lng of LANGS.filter((l) => l !== base)) await setCommands(listFor('member', lng), { languageCode: lng });
    const now = new Set();
    for (const u of (await users()) ?? []) {
      if (u?.channel !== 'telegram' || !u.uid || (u.role ?? 'member') === 'member') continue;
      const chatId = String(u.uid);
      now.add(chatId);
      await setCommands(listFor(u.role, langOf(u.id) ?? base), { chatId });
    }
    // a chat whose person is a member again (or gone): back to the default list
    for (const chatId of own) if (!now.has(chatId)) await setCommands([], { chatId, clear: true });
    own.clear();
    for (const c of now) own.add(c);
  }
  return { publish };
}
