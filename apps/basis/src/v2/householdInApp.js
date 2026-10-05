/**
 * householdInApp — the household in a person's own app.
 *
 * A household bot's lists, chores and agenda are typed items in ONE circle store, under the bot's own circle id
 * (`householdCircleIdFor`). A person who links their Basis identity (`/koppel`) and says yes joins that circle from
 * their app: an invite bound to the chat key they linked, single use, for a day. The circle's rules are made the first
 * time someone is invited — the bot founds it, so the bot is its admin — so a household nobody takes into an app never
 * becomes a circle at all.
 */

import { quickCreateCircle } from './circleCreate.js';
import { buildCircleInviteUri } from './circleInvite.js';

/**
 * @param {object} a
 * @param {Function} a.callSkill        the bot's own (owner) callSkill
 * @param {string} a.circleId           the household's circle id
 * @param {string} a.selfWebid          the bot's address (the invite names it as the admin to redeem with)
 * @param {() => string} a.name         the household's name, for the circle a joiner sees
 * @param {() => string|null} [a.relayUrl]  where the bot is, put on the invite
 * @param {(a: {circleId: string}) => any} [a.onCreated]  after founding: the bot's presence in the circle (as after a join)
 * @param {number} [a.hours]            how long an invite is good for
 * @param {(addr: string) => string} [a.identityOf]  an address → the person's canonical (chat) key
 */
export function createHouseholdInApp({ callSkill, circleId, selfWebid, name, relayUrl = null, onCreated = null, hours = 24, identityOf = (a) => a } = {}) {
  if (typeof callSkill !== 'function' || !circleId || !selfWebid) throw new TypeError('createHouseholdInApp: callSkill, circleId and selfWebid are required');

  /** The household's circle rules, made once (the bot its founder and admin). */
  async function ensureCircle() {
    // one of the bot's circles already (the question the pair roster asks; a rules read answers in words)
    const mine = await callSkill('stoop', 'listMyCircles', {}).catch(() => null);
    if ((mine?.circles ?? []).includes(circleId)) return { created: false };
    await quickCreateCircle({ callSkill, id: circleId, founderPubKey: selfWebid, name: (typeof name === 'function' ? name() : name) || 'Huishouden' });
    if (typeof onCreated === 'function') { try { await onCreated({ circleId }); } catch { /* the next boot registers */ } }
    return { created: true };
  }

  /** An invite into the household's circle for ONE person: bound to their chat key, one use, `hours` long. */
  async function inviteFor(personKey) {
    if (typeof personKey !== 'string' || !personKey) return { ok: false, reason: 'no-key' };
    await ensureCircle();
    const inv = await buildCircleInviteUri({
      callSkill, circleId, adminPeerAddr: selfWebid, boundTo: personKey, boundForHours: hours,
      ...(typeof relayUrl === 'function' && relayUrl() ? { relayUrl: relayUrl() } : {}),
    });
    return inv?.uri ? { ok: true, uri: inv.uri, expiresAt: inv.expiresAt ?? null } : { ok: false, reason: inv?.error ?? 'no-invite' };
  }

  /**
   * A person the bot no longer admits (`/revoke`) leaves the household's circle too: every roster address that is
   * theirs (resolved to their canonical key) is removed by the bot, its admin. Not on `/ontkoppel` — membership is the
   * circle's, and unlinking only drops the bot's knowledge of their key.
   */
  async function evict(personKey) {
    if (typeof personKey !== 'string' || !personKey) return { removed: 0 };
    const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId }).catch(() => null);
    const theirs = (r?.members ?? []).map((m) => m?.webid).filter((w) => typeof w === 'string' && w && w !== selfWebid && (w === personKey || identityOf(w) === personKey));
    let removed = 0;
    for (const memberWebid of theirs) {
      const out = await callSkill('stoop', 'removeMember', { groupId: circleId, memberWebid, policy: 'graceful' }).catch(() => null);
      if (out && !out.error && out.ok !== false) removed += 1;
    }
    return { removed };
  }

  return { ensureCircle, inviteFor, evict };
}
