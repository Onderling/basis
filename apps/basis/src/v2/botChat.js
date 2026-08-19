/**
 * basis v2 — 1:1-bot chat gate (shared web + mobile).
 *
 * The CONVERSATION chat card shows an "assistant header" strip (green presence dot +
 * the bot's name) ONLY when the conversation is a genuine 1:1 with a bot: you +
 * exactly one other participant, and that participant is a bot. On a group circle
 * (any human co-members, or more than one other participant) the strip is hidden.
 *
 * Pure + host-agnostic: the host passes its per-member roster (each carrying an
 * id/webid + the substrate's bot marker) plus the viewer's own webid, and this
 * decides. Both shells wire the SAME helper so the gate can't drift.
 *
 * A member counts as a BOT when any of these hold (whatever the host's member
 * data exposes):
 *   - `relation === 'agent'`   — the 5.6 MemberMap marker for an LLM-backed peer
 *   - `isBot === true`
 *   - `type === 'a2a'` | `'hybrid'`
 */

/** @param {object} m */
function isBotMember(m) {
  if (!m || typeof m !== 'object') return false;
  return m.relation === 'agent'
    || m.isBot === true
    || m.type === 'a2a'
    || m.type === 'hybrid';
}

/** @param {object} m */
function memberId(m) {
  return m?.id ?? m?.webid ?? m?.webId ?? null;
}

/**
 * The label for a genuine 1:1-with-a-bot chat, or `null` when the strip must
 * stay hidden (group, 1:1-with-a-human, or empty roster).
 *
 * @param {object}        [args]
 * @param {Array<object>} [args.members]        per-member rows (id/webid + bot marker + a name)
 * @param {string|null}   [args.selfWebid]      the viewer's own webid (filtered out of the roster)
 * @param {string|null}   [args.fallbackLabel]  used when the bot has no display name of its own
 * @returns {string|null}
 */
export function oneToOneBotLabel({ members = [], selfWebid = null, fallbackLabel = null } = {}) {
  if (!Array.isArray(members)) return null;
  // Everyone who ISN'T me.
  const others = members.filter((m) => m && memberId(m) !== selfWebid);
  // A genuine 1:1 has exactly one other participant.
  if (others.length !== 1) return null;
  const other = others[0];
  if (!isBotMember(other)) return null;
  return other.name ?? other.displayName ?? other.label ?? fallbackLabel;
}
