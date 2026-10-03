/**
 * botAddress — the "is this message FOR the bot?" gate (shared web + mobile). Pure: it decides
 * whether a posted line should be routed to the Onderling-bot at all, so an untagged group message
 * never wakes it.
 *
 * The rule (Frits):
 *   - In a genuine 1:1 bot chat (you + exactly one `relation:'agent'` member) → ALWAYS addressed:
 *     every message goes to the bot. That "1:1 with a bot" decision reuses `oneToOneBotLabel`'s member
 *     logic (others = roster − you; exactly one; it's a bot) so the two can't drift.
 *   - In a circle with 2+ members → addressed ONLY when the line @-tags/names the bot (the existing
 *     `mention` concept, `addressesBot`). An untagged group message → NOT addressed (the bot stays
 *     silent).
 *
 * No DOM, no network, no storage: the host passes the roster + its own webid + the bot member.
 */

import { oneToOneBotLabel } from './botChat.js';
import { addressesBot } from './circleDispatch.js';
import { botNamesFor, namesTheBotMember } from './circleDoor.js';

/** The bot's display handle from its member row (for the group @-mention test). */
function botHandle(botMember) {
  if (!botMember || typeof botMember !== 'object') return '';
  return botMember.name ?? botMember.displayName ?? botMember.label ?? '';
}

/**
 * Is the bot addressed by `text` in this circle?
 *
 * @param {object}        [args]
 * @param {string}        [args.text]           the posted line
 * @param {Array<object>} [args.circleMembers]  the circle's roster (id/webid + bot marker + name)
 * @param {string|null}   [args.selfWebid]      the viewer's own webid (filtered out of the roster)
 * @param {object|null}   [args.botMember]      the bot's member row (its handle powers the @-mention test)
 * @returns {boolean}
 */
export function botIsAddressed({ text, circleMembers = [], selfWebid = null, botMember = null } = {}) {
  // 1:1 with a bot → every message is for the bot. Reuse oneToOneBotLabel's member logic; a truthy
  // fallback guarantees a non-null return whenever it IS a 1:1 bot (even if the bot row has no name).
  const solo = oneToOneBotLabel({
    members: circleMembers,
    selfWebid,
    fallbackLabel: botHandle(botMember) || 'bot',
  });
  if (solo != null) return true;
  // Group → only when the line @-tags/names the bot.
  return addressesBot(text, botHandle(botMember));
}

/**
 * Does this line name a member that says it is a FUNCTION (a household bot on the roster, `kind: 'function'`)? Then the
 * line is that bot member's, and the sender's own local assistant stays quiet — one line, one answer, even when the line
 * also says `@assistent`. The names are the ones the bot's own door answers to (`circleDoor.botNamesFor`).
 *
 * @param {string} text
 * @param {Array<{handle?: string, kind?: string}>|null} members  the circle's roster rows
 * @returns {boolean}
 */
export function namesAFunctionMember(text, members) {
  for (const m of Array.isArray(members) ? members : []) {
    if (m?.kind !== 'function' || !m.handle) continue;
    if (namesTheBotMember(text, botNamesFor(m.handle))) return true;
  }
  return false;
}
