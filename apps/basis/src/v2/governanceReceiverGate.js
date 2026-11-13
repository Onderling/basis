/**
 * THE RECEIVER GATE OF THE GOVERNED WRITES: a device applies a carried change only when the circle's rule for that
 * action allowed it. The doors (governanceDoors.js) make an honest app ask; this is what binds a device that skips
 * them, because every member's device judges for itself (the enforceability test: another app version gets nothing
 * from skipping the door).
 *
 * The rule, per write:
 *   - where the action's class lets one admin decide (`any-admin`, or `admin-quorum` with a single admin, who IS the
 *     quorum), an admin's write stands on its own (the author's admin role is checked by the lane, as before);
 *   - otherwise the write must NAME the proposal that decided it (`payload.proposalId`), and that proposal, folded
 *     on THIS device from the verified governance events, must be of the same action, APPROVED, and about the same
 *     change (the enacted value matches the proposal's subject).
 * A write that fails is not applied and not dropped: it stays on the lane, and the governance view shows it as a
 * change made without the vote (Frits 2026-11-10, Q3).
 *
 * The founding write (version 1: the founder's first policy, written at creation) is not a change and is never
 * judged.
 *
 * Pure: the policy, members and folded proposals in; a verdict out.
 */
import { decisionClassFor } from './circlePolicy.js';
import { DECISION_STATUS } from './governanceDecision.js';
import { foldGovernance } from './governanceLog.js';

/** Does a write of `action` need a decided proposal in a circle with this policy and these members? */
export function writeNeedsVote(policy, action, members = []) {
  const cls = decisionClassFor(policy, action);
  if (!cls) return true;   // an unknown action is never let through on its own
  if (cls === 'any-admin') return false;
  if (cls === 'admin-quorum') return (Array.isArray(members) ? members : []).filter((m) => m?.role === 'admin').length >= 2;
  return true;   // member-vote: the vote is the point, whatever the roster size
}

/** Canonical JSON (sorted keys), so two equal objects compare equal whatever their key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Every key the patch sets is set to the same value in `whole` (a policy patch against the stated whole policy). */
function patchHolds(patch, whole) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return canonical(patch) === canonical(whole);
  if (!whole || typeof whole !== 'object') return false;
  return Object.keys(patch).every((k) => patchHolds(patch[k], whole[k]));
}

/** The enacted value of a carried write, per action: what the proposal's subject must match. */
const ENACTED = Object.freeze({
  changeRule:   { value: (payload) => payload?.rules,  matches: (subject, value) => canonical(subject) === canonical(value) },
  changePolicy: { value: (payload) => payload?.policy, matches: (subject, value) => patchHolds(subject, value) },
});

/**
 * Was this carried write made without the vote its circle's rule requires?
 * @param {object} a
 * @param {'changeRule'|'changePolicy'} a.action
 * @param {{payload: object}} a.body              the verified statement body (`payload.version`, `payload.proposalId`)
 * @param {object} a.policy                       the policy in force on this device
 * @param {Array<{ref: string, role: string}>} a.members
 * @param {Array<object>} a.proposals             this device's governance fold (`foldGovernance(...).proposals`)
 * @returns {boolean}
 */
export function writeSkippedTheVote({ action, body, policy, members = [], proposals = [] } = {}) {
  const payload = body?.payload ?? {};
  if (Number.parseInt(payload.version, 10) === 1) return false;   // the founding write is not a change
  if (!writeNeedsVote(policy, action, members)) return false;
  const shape = ENACTED[action];
  if (!shape) return true;
  const id = typeof payload.proposalId === 'string' ? payload.proposalId : null;
  if (!id) return true;
  const p = (Array.isArray(proposals) ? proposals : []).find((x) => x?.proposalId === id);
  if (!p || p.action !== action || !decidedYes(p)) return true;
  return !shape.matches(p.subject, shape.value(payload));
}

/**
 * Approved by THIS device's own tally of the votes, never by a recorded "resolve" alone: a closed proposal keeps the
 * outcome its resolve names, and a lone admin can write a resolve. The one recorded approval that counts without the
 * votes is the admin's past-deadline override of a member vote, and only where this device's tally says it was open.
 */
function decidedYes(p) {
  if (p?.decision?.status === DECISION_STATUS.APPROVED) return true;
  return p?.closed === true && p.status === DECISION_STATUS.APPROVED && p?.decision?.overrideAvailable === true;
}

/**
 * Split a lane's carried writes of one action into what this device may apply and what skipped the vote. Reads the
 * rail's verified governance events only when the circle's rule needs a vote at all (that read re-verifies the lane).
 * @param {object} a
 * @param {{readVerified: Function}} a.rail
 * @param {string} a.circleId
 * @param {'changeRule'|'changePolicy'} a.action
 * @param {object[]} a.bodies                     verified change statements (already the admins' only)
 * @param {object} a.policy                       the policy in force on this device
 * @param {Array<{ref: string, role: string}>} a.members
 * @returns {Promise<{kept: object[], skipped: object[]}>}
 */
export async function gateCarriedWrites({ rail, circleId, action, bodies = [], policy = {}, members = [], now = Date.now() } = {}) {
  if (!writeNeedsVote(policy, action, members)) return { kept: bodies, skipped: [] };
  let events = []; let disputed = new Set();
  try { ({ events = [], disputed = new Set() } = (await rail?.readVerified?.(circleId)) ?? {}); } catch { events = []; }
  const { proposals } = foldGovernance(events, { policy, members, now, disputed });
  const kept = []; const skipped = [];
  for (const body of bodies) (writeSkippedTheVote({ action, body, policy, members, proposals }) ? skipped : kept).push(body);
  return { kept, skipped };
}
