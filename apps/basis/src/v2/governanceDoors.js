/**
 * THE DOORS OF THE GOVERNED ACTIONS: a person's act goes through the circle's "who decides", whichever screen or
 * chat line it starts from. Each door calls the governance `propose`: where one admin may decide (`any-admin`), that
 * enacts at once and leaves a propose + resolve trail; where the circle decides together, it opens a proposal and
 * the vote reaches whoever the rule names. The raw ops stay as what an APPROVED decision enacts, never a door.
 *
 * One function per governed action, shared by every shell (web and mobile call the same door); what a door answers
 * is an outcome a screen can say in words.
 */
import { DECISION_STATUS } from './governanceDecision.js';

/**
 * What a governance `propose` answer means for the person who acted.
 * @returns {{outcome: 'done'|'proposed'|'refused', proposalId?: string, reason?: string}}
 */
export function doorOutcome(r) {
  if (!r || r.ok === false && r.status !== DECISION_STATUS.PENDING) return { outcome: 'refused', reason: r?.reason ?? r?.error ?? 'refused' };
  if (r.status === DECISION_STATUS.APPROVED && r.enacted !== false) return { outcome: 'done', proposalId: r.proposalId };
  if (r.status === DECISION_STATUS.PENDING) return { outcome: 'proposed', proposalId: r.proposalId };
  return { outcome: 'refused', proposalId: r.proposalId, reason: r.reason ?? r.status ?? 'refused' };
}

/**
 * REMOVE A MEMBER, through the circle's rule for `removeMember`.
 * @param {object} a
 * @param {{propose: Function}} a.governance  the circle governance binding (`bindCircleGovernance`)
 * @param {string} a.circleId
 * @param {string} a.memberWebid
 * @param {string|null} a.actorRef            the self this device acts as in the circle
 * @returns {Promise<{outcome: 'done'|'proposed'|'refused', proposalId?: string, reason?: string}>}
 */
export async function removeMemberDoor({ governance, circleId, memberWebid, actorRef = null } = {}) {
  if (typeof governance?.propose !== 'function') return { outcome: 'refused', reason: 'no-governance' };
  if (typeof circleId !== 'string' || !circleId || typeof memberWebid !== 'string' || !memberWebid) return { outcome: 'refused', reason: 'missing-args' };
  let r;
  try { r = await governance.propose({ circleId, action: 'removeMember', subject: memberWebid, ...(actorRef ? { actor: { ref: actorRef } } : {}) }); }
  catch (err) { return { outcome: 'refused', reason: err?.message ?? 'propose-failed' }; }
  return doorOutcome(r);
}
