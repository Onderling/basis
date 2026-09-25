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
 * shown to the one it concerns — and a role change is shown to everyone in the circle, because who runs it
 * is everyone's business.
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
  // A role change is the circle's fact, not a private message: the person it concerns reads "you", everyone
  // else reads their name (decided 2026-09-15 — before that only the promoted member got a line). Both
  // wordings follow the one "promoted" / "demoted" setting.
  memberPromoted: 'circle.membership.member_is_now_admin',
  memberDemoted:  'circle.membership.member_is_no_longer_admin',
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
    const role = body.payload?.role;
    if (role !== 'admin' && role !== 'member') return null;
    if (subject === viewerId) return { notice: role === 'admin' ? 'promoted' : 'demoted' };
    const row = Array.isArray(members) ? members.find((m) => refOf(m) === subject) : null;
    const name = row ? revealedMemberLabel(row, { viewerId }).primary : subject;
    return { notice: role === 'admin' ? 'memberPromoted' : 'memberDemoted', args: { name } };
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

/**
 * WHEN A KEY FORKS (Frits 2026-09-25, ledger L133). Two membership statements signed by one key off the same parent
 * prove the key can no longer be trusted from there — almost always a stolen key. The fold removes the author from the
 * fork on (L131); these rows say so, to the two who can act on it:
 *   • the person whose key it is — told first and plainly, on their own devices: someone else may hold their key;
 *   • the circle's admins — named, for an admin's fork and a member's alike: they can rotate and remove.
 * Not the whole group: they see the roster change, and an alarm reads as an accusation when most forks are theft.
 *
 * Rendered from the log like every membership notice — the fork IS on the log — never appended; one row per fork, its
 * id the fork's smallest sibling hash (the same name the fold's removal carries), dated when the fork became visible.
 * Not subject to the per-kind notice settings: a key that may be stolen is not a line a person switches off.
 */
export const FORK_NOTICE_KEYS = Object.freeze({
  you:    'circle.membership.your_key_forked',
  member: 'circle.membership.member_key_forked',
});

/**
 * @param {object} a
 * @param {Array<object>} a.events   the device log
 * @param {string} a.circleId
 * @param {string} a.viewerId        this person
 * @param {Array<object>|null} [a.members]  the roster rows (the viewer's role, the forked member's name)
 * @param {(key:string, args?:object)=>string} a.t
 */
export function forkNoticeRows({ events = [], circleId, viewerId, members = null, t } = {}) {
  if (typeof t !== 'function' || typeof circleId !== 'string' || !circleId || typeof viewerId !== 'string' || !viewerId) return [];
  // author key + parent → the statements off that parent (the fork is two or more with different hashes)
  const byParent = new Map();
  for (const e of events ?? []) {
    if (!e || e.type !== 'membership') continue;
    if ((e.circleId ?? e.payload?.circleId) !== circleId) continue;
    const body = e.payload?.body;
    if (!body || typeof body.author !== 'string' || typeof body.hash !== 'string') continue;
    const key = `${body.author}\n${body.parentHash ?? ''}`;
    if (!byParent.has(key)) byParent.set(key, new Map());
    byParent.get(key).set(body.hash, e);
  }
  const viewerIsAdmin = Array.isArray(members) && members.some((m) => refOf(m) === viewerId && m?.role === 'admin');
  const out = [];
  const said = new Set();
  for (const siblings of byParent.values()) {
    if (siblings.size < 2) continue;
    const entries = [...siblings.values()];
    const any = entries[0];
    const person = any.actor ?? any.payload?.body?.payload?.authorRef ?? any.payload?.body?.author;
    const isMe = person === viewerId || any.payload?.body?.author === viewerId;
    if (!isMe && !viewerIsAdmin) continue;
    const seed = [...siblings.keys()].sort()[0];
    const id = `notice:fork:${seed}`;
    if (said.has(id)) continue;
    said.add(id);
    const ts = Math.max(...entries.map((e) => (typeof e.ts === 'number' ? e.ts : 0)));
    let text;
    if (isMe) text = t(FORK_NOTICE_KEYS.you);
    else {
      const row = members.find((m) => refOf(m) === person);
      const name = row ? revealedMemberLabel(row, { viewerId }).primary : String(person ?? '').slice(0, 8);
      text = t(FORK_NOTICE_KEYS.member, { name });
    }
    const notice = isMe ? 'keyForked' : 'memberKeyForked';
    out.push({
      id, ts, app: 'basis', type: 'chat-message', actor: 'bot', circleId, circleName: null,
      event: { id, ts, app: 'basis', type: 'chat-message', actor: 'bot',
        payload: { circleId, kind: 'chat-message', scope: 'self', text, notice } },
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
