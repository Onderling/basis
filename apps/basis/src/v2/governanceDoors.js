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
import { normalizeRulesDoc } from './circleRules.js';

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

/**
 * THE CIRCLE'S RULES, as the rules screen edits them: the `group-rules` head that `getGroupRules` answers (the
 * structured doc rides as `doc`). `head` is the whole stored object, `doc` the questions the screen asks.
 * @returns {Promise<{head: object|null, doc: object}>}
 */
export async function readCircleRules({ callSkill, circleId } = {}) {
  let head = null;
  if (typeof callSkill === 'function' && typeof circleId === 'string' && circleId) {
    try {
      const r = await callSkill('pinboard', 'getGroupRules', { groupId: circleId });
      head = r?.doc && typeof r.doc === 'object' ? r.doc : null;
    } catch { head = null; }
  }
  return { head, doc: normalizeRulesDoc(head) };
}

/** What a save writes: the head with the edited questions on top, so the rule fields the screen does not ask stay. */
export function rulesForSave(head, edited) {
  return { ...(head && typeof head === 'object' ? head : {}), ...normalizeRulesDoc(edited) };
}

/**
 * CHANGE THE CIRCLE'S RULES, through the circle's rule for `changeRule` (default: the admins decide together).
 * @param {object} a
 * @param {{propose: Function}} a.governance
 * @param {string} a.circleId
 * @param {object} a.rules                    the whole rules object to write (`rulesForSave`)
 * @param {string|null} a.actorRef
 */
export async function changeRulesDoor({ governance, circleId, rules, actorRef = null } = {}) {
  if (typeof governance?.propose !== 'function') return { outcome: 'refused', reason: 'no-governance' };
  if (typeof circleId !== 'string' || !circleId || !rules || typeof rules !== 'object') return { outcome: 'refused', reason: 'missing-args' };
  let r;
  try { r = await governance.propose({ circleId, action: 'changeRule', subject: rules, ...(actorRef ? { actor: { ref: actorRef } } : {}) }); }
  catch (err) { return { outcome: 'refused', reason: err?.message ?? 'propose-failed' }; }
  return doorOutcome(r);
}
