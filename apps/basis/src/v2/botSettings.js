/**
 * botSettings — what a household bot's admin decides, as parameters: never a prompt line, never the model's.
 *
 * WHO may give a chore to whom (`assistant.assignPolicy`): a household decides whether anyone may hand out chores or
 * only some people (Frits, 2026-09-30: "depends on the settings of the bot, set by the admin"). Enforced at the waist
 * when an add names an assignee — the model only passes the words on.
 *   - `self`   (default): a member may name only themselves; the admin anyone;
 *   - `anyone`: everyone may name anyone;
 *   - `role`:   a person whose role is in `assistant.assignRoles` (default `['admin']`) may name anyone; others themselves.
 *
 * Device scope, `kind: user`: settable by the bot's admin (`/settings`), never synced to anyone's other devices.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const ASSIGN_POLICIES = Object.freeze(['self', 'anyone', 'role']);
export const ASSIGN_POLICY_KEY = 'assistant.assignPolicy';
export const ASSIGN_ROLES_KEY = 'assistant.assignRoles';

export const ASSIGN_POLICY = param({ key: ASSIGN_POLICY_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'self' });
export const ASSIGN_ROLES = param({ key: ASSIGN_ROLES_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: Object.freeze(['admin']) });

/** A stored policy as one of the three; anything else is the default. */
export const assignPolicyFrom = (v) => (ASSIGN_POLICIES.includes(v) ? v : ASSIGN_POLICY);
/** A stored role list; anything else is the default. */
export const assignRolesFrom = (v) => (Array.isArray(v) && v.length ? v.map(String) : [...ASSIGN_ROLES]);

/**
 * May this person give a chore to that one?
 * @param {{policy?: string, roles?: string[], callerId: string|null, callerRole: string|null, assigneeId: string}} a
 *        no caller (the bot's owner, not a door) may always
 */
export function assignAllowed({ policy, roles, callerId, callerRole, assigneeId }) {
  if (!callerId || assigneeId === callerId) return true;
  const p = assignPolicyFrom(policy);
  if (p === 'anyone') return true;
  if (p === 'role') return assignRolesFrom(roles).includes(String(callerRole ?? ''));
  return callerRole === 'admin';
}

/** "mij" / "me" / "ik" / "myself" / "zelf": the person who asks. */
export const isSelfWord = (w) => /^(mij|me|ik|mezelf|zelf|myself|self)$/i.test(String(w ?? '').trim());
