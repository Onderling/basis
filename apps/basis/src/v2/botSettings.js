/**
 * botSettings — what a household bot's admin decides, as parameters: never a prompt line, never the model's.
 *
 * WHO may give a chore to someone else is the ROLE's first (core's one role vocabulary, the same words a circle's roster
 * uses: coordinator-or-above may assign anyone, a member only themselves — the tasks app's `rolePolicy.canReassign`).
 * The household's setting `assistant.assignPolicy` only loosens or tightens that:
 *   - `roles`  (default): the role decides;
 *   - `anyone`: every admitted person may give a chore to anyone;
 *   - `self`:   nobody gives chores to others, not even a coordinator.
 * Enforced at the waist when an add names an assignee — the model only passes the words on.
 *
 * Device scope, `kind: user`: settable by the bot's admin (`/instellingen`), never synced to anyone's other devices.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const ASSIGN_POLICIES = Object.freeze(['roles', 'anyone', 'self']);
export const ASSIGN_POLICY_KEY = 'assistant.assignPolicy';
export const ASSIGN_POLICY = param({ key: ASSIGN_POLICY_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'roles' });

/** A stored policy as one of the three; anything else is the default. */
export const assignPolicyFrom = (v) => (ASSIGN_POLICIES.includes(v) ? v : ASSIGN_POLICY);

/**
 * May this person give a chore to that one?
 * @param {{policy?: string, roleMayAssign: boolean, callerId: string|null, assigneeId: string}} a
 *        `roleMayAssign`: the role's answer (`rolePolicy.canReassign`); no caller (the bot's owner) may always
 */
export function assignAllowed({ policy, roleMayAssign, callerId, assigneeId }) {
  if (!callerId || assigneeId === callerId) return true;
  const p = assignPolicyFrom(policy);
  if (p === 'anyone') return true;
  if (p === 'self') return false;
  return Boolean(roleMayAssign);
}

/**
 * WHO may see the others' names on this bot — the household's CEILING over what each person disclosed (their display
 * name, given at admission); it can only narrow, never widen. A circle's own `revealPolicy` takes its place in a circle.
 *   - `members`   (default): every admitted person (a household knows itself);
 *   - `assigners`: those who may give chores to others (the role rule), and the admin;
 *   - `admin`:     only the admin;
 *   - `none`:      nobody — no name leaves the bot, not even to the admin's door.
 */
export const NAMES_POLICIES = Object.freeze(['members', 'assigners', 'admin', 'none']);
export const NAMES_KEY = 'assistant.names';
export const NAMES_POLICY = param({ key: NAMES_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'members' });
export const namesPolicyFrom = (v) => (NAMES_POLICIES.includes(v) ? v : NAMES_POLICY);

/** May this person see the others' names? The bot's owner (no door caller) may, unless names leave the bot at all. */
export function mayNamePeople({ setting, callerId, callerRole, roleMayAssign }) {
  const p = namesPolicyFrom(setting);
  if (p === 'none') return false;
  if (!callerId || p === 'members') return true;
  if (p === 'assigners') return Boolean(roleMayAssign) || callerRole === 'admin';
  return callerRole === 'admin';
}

/** The roles an admin may give a person on the bot (the admin role is the door's, given at admission). */
export const BOT_ROLES = Object.freeze(['coordinator', 'member', 'observer']);

/** "mij" / "me" / "ik" / "myself" / "zelf": the person who asks. */
export const isSelfWord = (w) => /^(mij|me|ik|mezelf|zelf|myself|self)$/i.test(String(w ?? '').trim());

/**
 * What happens to what is DONE (a completed chore, a ticked entry) or has PASSED (an appointment before now) — one knob
 * for the three (Frits, 2026-09-30):
 *   - `keep`:   shown, marked as done / passed, however old;
 *   - `hide`   (default): shown marked for `assistant.passedKeepDays` days, then no longer read — by default 0 days: a
 *               ticked "melk" leaves the next read at once and stays in the store (7 suited a chore, not a shopping list);
 *   - `delete`: removed from the list.
 */
export const PASSED_POLICIES = Object.freeze(['keep', 'hide', 'delete']);
export const PASSED_KEY = 'assistant.passedItems';
export const PASSED_DAYS_KEY = 'assistant.passedKeepDays';
export const PASSED_POLICY = param({ key: PASSED_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'hide' });
export const PASSED_KEEP_DAYS = param({ key: PASSED_DAYS_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 0 });
export const passedPolicyFrom = (v) => (PASSED_POLICIES.includes(v) ? v : PASSED_POLICY);
export const passedDaysFrom = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : PASSED_KEEP_DAYS);

