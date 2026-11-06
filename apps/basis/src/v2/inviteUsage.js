/**
 * THE OPEN INVITE KEEPS UP. A walk (2026-11-05) kept the invite open while someone joined: after 45 s it still said
 * "0 of 6 places used", and nothing told the inviter someone had come in. The invite reads its count once, when it
 * opens. Both shells already hear when a circle's membership moves (the membership lane's `membershipChange`); on that
 * signal an open invite re-reads what is used here and says who is new.
 *
 * Pure reads + one comparison — web ≡ mobile.
 */
import { memberShown } from './personLabel.js';

/**
 * How much of the circle's current invite is used, and who is in the circle now.
 * @param {{ callSkill: Function, circleId: string }} a
 * @returns {Promise<{ used: number|null, max: number|null, members: Array<object> }>}
 */
export async function readInviteUsage({ callSkill, circleId } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return { used: null, max: null, members: [] };
  let code = null;
  let members = [];
  try { code = await callSkill('pinboard', 'getCurrentMembershipCode', { groupId: circleId }); } catch { code = null; }
  try { members = (await callSkill('pinboard', 'listGroupMembers', { groupId: circleId }))?.members ?? []; } catch { members = []; }
  return {
    used: typeof code?.redemptionsUsed === 'number' ? code.redemptionsUsed : null,
    max:  typeof code?.maxRedemptions === 'number' ? code.maxRedemptions : null,
    members: Array.isArray(members) ? members : [],
  };
}

/**
 * Who came in since the invite opened, as words: "Tester B is erbij gekomen." — one line per newcomer, never a key.
 * @param {string[]} before  the member webids when the invite opened
 * @param {Array<object>} members  the members now (raw `listGroupMembers` rows)
 * @param {(k: string, v?: object) => string} t
 * @returns {string[]}
 */
export function joinedSince(before, members, t) {
  const had = new Set(Array.isArray(before) ? before : []);
  return (Array.isArray(members) ? members : [])
    .filter((m) => m?.webid && !had.has(m.webid))
    .map((m) => t('circle.invite.joined', { name: memberShown(m, t) }));
}

/** The member webids to compare against later. */
export function memberIdsOf(members) {
  return (Array.isArray(members) ? members : []).map((m) => m?.webid).filter(Boolean);
}
