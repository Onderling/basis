/**
 * basis v2 — making someone an admin, and stepping back again (web ≡ mobile).
 *
 * The op has existed and worked for a while; what did not exist was any way for a person to reach it.
 * `setMemberRole` declares no slash command, so until this control the ONLY route to it was asking the
 * assistant in words — no deterministic path at all, on either shell. This module is the decision half
 * of that control: given the roster rows a panel already holds, it says whether to offer the change on
 * a row, which way it goes, and — the part that matters — WHAT WILL HAPPEN if it is taken.
 *
 * ── Why the consequence is computed here and not in the panel ─────────────────────────────────────────
 * Since the roster fold answers a step-down that would empty the admin set by HANDING OVER — appointing
 * a caretaker from whoever is left — rather than by refusing it, "make this admin a member again" is two
 * quite different acts wearing one button:
 *
 *   plain        another admin remains; the circle carries on with one fewer.
 *   handover     this is the last admin. After it nobody is running the circle, so it passes to one of
 *                the other members. WHICH one is derived from the log — the fold seeds the choice with
 *                the statement that emptied the set — so a shell must never try to name them. Saying
 *                "it passes to someone else" is honest; naming a person a second computation guessed
 *                at is how two devices end up telling one circle two different stories.
 *   no-one-else  the last admin is also the only member. There is nobody to hand to, so the fold keeps
 *                the demotion from standing at all (`rosterFold`, the last-admin rule). The person is
 *                told that instead of being told about a handover that cannot happen.
 *
 * A shell that worked this out for itself would be a second answer to "who runs this circle", and the
 * two would drift — which is the whole reason `memberAdminStatus` next door exists. So the panels paint
 * what this returns and decide nothing.
 *
 * ── Admin-only ────────────────────────────────────────────────────────────────────────────────────────
 * The op refuses a non-admin and the fold refuses it again on every device, so this is a convenience,
 * not a gate (the enforceability test: a different app version gets nothing from skipping it). It is
 * still deny-by-default here — an unknown viewer, or a viewer this roster does not show as an admin,
 * gets no control — because painting an action a person cannot take is its own kind of lie.
 *
 * Pure: roster rows in, a decision out. No I/O, no DOM, no clock.
 */

// The manifest is the source of truth for surfaces (invariant 4), including the confirm this control
// must honour: `setMemberRole` declares `ui.confirm`, and its severity is read from there rather than
// restated per shell. Through basis's ONE door onto stoop's manifest (`mockStoopManifest` is a
// re-export of the real one under its historical name) — a second relative path to the same file from
// the same app is a reference living twice.
import { mockStoopManifest as stoopManifest } from '../core/manifests/mockManifests.js';
import { confirmRequestForOp } from './confirmGate.js';

/** The op this control drives, and its declaration. */
const SET_MEMBER_ROLE = 'setMemberRole';
const SET_MEMBER_ROLE_OP = (stoopManifest.operations ?? []).find((o) => o?.id === SET_MEMBER_ROLE) ?? null;

/**
 * Every locale key this control can ask for, flat, so the label-key fitness check can walk it and a
 * renamed key fails CI instead of rendering its own name at a person.
 */
export const ROLE_CONTROL_KEYS = Object.freeze({
  make_admin:          'circle.admin.make_admin',
  make_member:         'circle.admin.make_member',
  confirm_promote:     'circle.admin.role_confirm.promote',
  confirm_demote:      'circle.admin.role_confirm.demote',
  confirm_handover:    'circle.admin.role_confirm.handover',
  confirm_no_one_else: 'circle.admin.role_confirm.no_one_else',
  notice_promoted:     'circle.admin.role_notice.promoted',
  notice_demoted:      'circle.admin.role_notice.demoted',
  notice_handed_over:  'circle.admin.role_notice.handed_over',
  notice_no_one_else:  'circle.admin.role_notice.no_one_else',
});

/** The roster row's identity, in the order the roster shapes carry it (same reading as `caretakerNotice`). */
const refOf = (row) => (typeof row === 'string' ? row : (row?.webid ?? row?.id ?? row?.addr ?? row?.ref ?? ''));
const isAdminRow = (row) => row?.role === 'admin';
const rows = (members) => (Array.isArray(members) ? members.filter((m) => m && typeof m === 'object') : []);

/**
 * @typedef {object} RoleControl
 * @property {'admin'|'member'} role         the role the change moves this member TO (the op's `role` arg)
 * @property {string}           labelKey     the button's label
 * @property {string}           confirmKey   what the confirm says will happen
 * @property {string}           noticeKey    what the panel says afterwards
 * @property {'plain'|'handover'|'no-one-else'} consequence
 */

/**
 * The role change this viewer may offer on this roster row, or `null` for none.
 *
 * @param {object}        a
 * @param {Array<object>} a.members  the circle's roster rows (`listGroupMembers`, raw)
 * @param {object}        a.member   the row the control would sit on
 * @param {string}        a.myRef    the viewer's own ref (their webid)
 * @returns {RoleControl|null}
 */
export function roleControlFor({ members, member, myRef } = {}) {
  const list = rows(members);
  const targetRef = refOf(member);
  if (!targetRef) return null;                       // nothing to name in the op's `memberWebid`
  if (typeof myRef !== 'string' || !myRef) return null;   // unknown viewer ⇒ no control (deny-by-default)
  const me = list.find((m) => refOf(m) === myRef);
  if (!isAdminRow(me)) return null;                  // only an admin is offered the change
  // Read the role off the ROSTER row, not off the object handed in: the roster is the one list every
  // other answer here is counted from, and a caller holding a stale copy of a row must not be able to
  // get a different decision than the list it is looking at.
  const target = list.find((m) => refOf(m) === targetRef);
  if (!target) return null;                          // not in this circle ⇒ no role here to change

  if (!isAdminRow(target)) {
    return {
      role: 'admin',
      labelKey:   ROLE_CONTROL_KEYS.make_admin,
      confirmKey: ROLE_CONTROL_KEYS.confirm_promote,
      noticeKey:  ROLE_CONTROL_KEYS.notice_promoted,
      consequence: 'plain',
    };
  }

  // Stepping an admin back down. Whether that is an ordinary demotion, a handover, or something the
  // fold will not let stand is the whole of what the person needs told before they take it.
  const admins = list.filter(isAdminRow);
  const someoneElse = list.some((m) => refOf(m) && refOf(m) !== targetRef);
  const consequence = admins.length > 1 ? 'plain' : (someoneElse ? 'handover' : 'no-one-else');
  const CONFIRM = {
    plain: ROLE_CONTROL_KEYS.confirm_demote,
    handover: ROLE_CONTROL_KEYS.confirm_handover,
    'no-one-else': ROLE_CONTROL_KEYS.confirm_no_one_else,
  };
  const NOTICE = {
    plain: ROLE_CONTROL_KEYS.notice_demoted,
    handover: ROLE_CONTROL_KEYS.notice_handed_over,
    'no-one-else': ROLE_CONTROL_KEYS.notice_no_one_else,
  };
  return {
    role: 'member',
    labelKey:   ROLE_CONTROL_KEYS.make_member,
    confirmKey: CONFIRM[consequence],
    noticeKey:  NOTICE[consequence],
    consequence,
  };
}

/**
 * The confirmation to put in front of the person before the change is dispatched — the manifest's own
 * confirm declaration for `setMemberRole` (invariant 4: the severity is declared there, not per shell),
 * carrying the consequence THIS change has rather than a message that cannot know which one it is.
 * The shells hold only the presenter (web dialog · RN Alert).
 *
 * @param {object}      a
 * @param {RoleControl} a.control
 * @param {string}      [a.name]  the member's display name, for the message
 * @param {Function}    a.t
 * @returns {import('./confirmGate.js').ConfirmRequest|null}
 */
export function roleChangeConfirm({ control, name, t } = {}) {
  if (!control) return null;
  const tr = typeof t === 'function' ? t : (k) => k;
  return confirmRequestForOp(SET_MEMBER_ROLE_OP, { t: tr, message: tr(control.confirmKey, { name }) });
}
