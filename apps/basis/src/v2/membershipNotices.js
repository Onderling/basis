/**
 * Membership notices — RENDERED from the log, never appended.
 *
 * "You were removed", "you are now an admin", "someone you admitted joined": each of these is a FACT
 * already on the device log as a signed membership statement, folded identically on every device. For a
 * while the shells said them by writing a SECOND entry that repeated the first (a bot bubble on web, and
 * on the phone nothing at all — W23, 2026-08-29). That is a materialised projection, which the
 * architecture names as drift: *"reading it back is a projection, never a second store."*
 *
 * So this module is a projection. Given the log, the circle and the viewer, it derives the bot-shaped
 * rows the conversation should show — and writes nothing. Consequences, each of them the point:
 *   • both shells paint the same rows by construction (one projection, one call in `chatRows`);
 *   • it cannot say a thing twice — the same log projects the same row, with the statement's own id;
 *   • a reinstall, a wipe, a catch-up: as soon as the statement is on the log, the line is there.
 *
 * Why these kinds are on the SYSTEM lane and still render: the kind table answers two different questions
 * — may this wake a sleeping phone (`wakes`), and is it conversation (`lane`). Membership must never wake
 * a device; that was right. But "silent" had come to mean "invisible", and a person was never told what
 * happened to them. `VIEWER_FACING_SYSTEM_KINDS` is that distinction made explicit: silent on the wire,
 * shown to the one it concerns.
 *
 * The decisions stay small and pure, and mirror `removalNotice`/`caretakerNotice`. Whether a person
 * WANTS each of these lines is a separate question (a circle default with a private per-member override,
 * decided 2026-08-29) — the `wants` predicate is where that setting plugs in; absent, everything shows.
 */
import { VIEWER_FACING_SYSTEM_KINDS } from '@onderling/item-store';
import { revealedMemberLabel } from './circleViewAs.js';
import { REMOVAL_NOTICE_KEYS, SHOW_REMOVAL_REASON } from './removalNotice.js';

export const MEMBERSHIP_NOTICE_KEYS = Object.freeze({
  // The removal wording (and the reason flag beside it) stays where it was decided — removalNotice.js.
  removed:   REMOVAL_NOTICE_KEYS.removed,
  removedWithReason: REMOVAL_NOTICE_KEYS.withReason,
  promoted:  'circle.membership.you_are_now_admin',
  demoted:   'circle.membership.you_are_no_longer_admin',
  joined:    'circle.membership.someone_joined',
});

const refOf = (row) => (typeof row === 'string' ? row : (row?.webid ?? row?.addr ?? row?.ref ?? ''));

/**
 * What one membership statement means to THIS viewer, or null.
 * @returns {{ notice: string, args?: object }|null}
 */
export function membershipNoticeFor(body, { viewerId, members = null } = {}) {
  if (!body || typeof body !== 'object' || typeof viewerId !== 'string' || !viewerId) return null;
  const { kind, subject, author } = body;
  if (kind === 'evict') {
    // A self-authored evict is a departure, not a removal (the same rule as `evictionOfMe`).
    if (subject !== viewerId || author === viewerId) return null;
    const reason = body.payload?.reason;
    return SHOW_REMOVAL_REASON && typeof reason === 'string' && reason
      ? { notice: 'removedWithReason', args: { reason } }
      : { notice: 'removed' };
  }
  if (kind === 'role') {
    if (subject !== viewerId) return null;
    const role = body.payload?.role;
    if (role === 'admin')  return { notice: 'promoted' };
    if (role === 'member') return { notice: 'demoted' };
    return null;
  }
  if (kind === 'join') {
    // Addressed to the person who admitted them (the statement's author when admin-authored). A
    // self-authored join names nobody but the joiner, and the joiner needs no line about themselves.
    if (author !== viewerId || subject === viewerId) return null;
    const row = Array.isArray(members) ? members.find((m) => refOf(m) === subject) : null;
    const name = row ? revealedMemberLabel(row, { viewerId }).primary : subject;
    return { notice: 'joined', args: { name } };
  }
  return null;
}

/**
 * The bot-shaped rows a conversation should show for the membership statements that concern the viewer.
 * Rows carry the SAME shape `buildCircleStream` produces for a bot line, so both shells paint them with
 * the renderer they already have — and `id` is derived from the statement's, so there is exactly one
 * per statement, forever.
 *
 * @param {object} a
 * @param {Array<object>} a.events      the device log (already filtered to the circle by the caller or not)
 * @param {string} a.circleId
 * @param {string} a.viewerId
 * @param {Array<object>|null} [a.members]
 * @param {(key:string, args?:object)=>string} a.t
 * @param {(notice:string)=>boolean} [a.wants]   the per-kind notification setting; absent = show all
 */
export function membershipNoticeRows({ events = [], circleId, viewerId, members = null, t, wants = null } = {}) {
  if (typeof t !== 'function' || typeof circleId !== 'string' || !circleId || typeof viewerId !== 'string' || !viewerId) return [];
  const out = [];
  for (const e of events ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (!VIEWER_FACING_SYSTEM_KINDS.includes(e.type)) continue;
    if ((e.circleId ?? e.payload?.circleId) !== circleId) continue;
    const body = e.payload?.body;
    const hit = membershipNoticeFor(body, { viewerId, members });
    if (!hit) continue;
    if (typeof wants === 'function' && !wants(hit.notice)) continue;
    const text = t(MEMBERSHIP_NOTICE_KEYS[hit.notice], hit.args ?? {});
    const id = `notice:${e.id}`;
    const ts = typeof e.ts === 'number' ? e.ts : 0;
    out.push({
      id, ts, app: 'basis', type: 'chat-message', actor: 'bot', circleId, circleName: null,
      // `scope: 'self'` — addressed to one person; a notice about YOU is nobody else's line.
      event: { id, ts, app: 'basis', type: 'chat-message', actor: 'bot',
        payload: { circleId, kind: 'chat-message', scope: 'self', text, notice: hit.notice } },
    });
  }
  return out;
}
