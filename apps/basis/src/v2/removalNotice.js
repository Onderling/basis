/**
 * basis v2 — telling someone they are no longer in a circle.
 *
 * The eviction itself is correct and always was: the admin signs it, every device folds it the same
 * way, the key rotates, and what comes next is unreadable to the person removed. What was missing is
 * the part a person experiences. Their circle looked exactly as it had a second earlier — same roster,
 * same composer, same menu — and they went on typing into it. Frits walked this on 2026-08-27 and
 * reported it as *"everything looks the same, it still looks like i can send messages (which i did -
 * no notification whatsoever)"*.
 *
 * Frits' rule, the same one `caretakerNotice` opens with: never change anything silently. A removal is
 * the largest change a circle can make to somebody, and it was the quietest.
 *
 * ── WHAT THIS DOES NOT DO — the access question, decided 2026-08-28 ──────────────────────────────────
 * It does not take anything away. Their history stays theirs and the circle stays readable.
 *
 * That follows from the enforceability test (`docs/conventions/enforceability.md`): could someone on a
 * different app version get it anyway? Yes — the data is already on their disk, and a client that
 * simply does not hide it is trivial. So a read-restriction here would be a costume, not a gate, and
 * the real gate is the one that already holds: the key rotated, so nothing NEW is readable, and their
 * statements no longer fold on anyone else's device.
 *
 * What honesty requires is the opposite of restriction — SAY IT. A person who can still see the circle
 * and is not told they are out is being misled by silence; a person who is told, and keeps their
 * history, is being treated straight.
 *
 * ── THE REASON IS NOT SHOWN — decided 2026-08-28, and deliberately one line to change ────────────────
 * `removeMember` accepts a `reason` and records it on the admin's `group-removal` item. It is NOT
 * surfaced here: see `SHOW_REMOVAL_REASON` below, which is the whole of the decision.
 */

/** The locale keys this module can ask for. Exported so a locale-coverage check can find them. */
import { circleChatMessageEvent } from '@onderling/kring-host/circleBroadcast';

export const REMOVAL_NOTICE_KEYS = Object.freeze({
  removed: 'circle.membership.you_were_removed',
  withReason: 'circle.membership.you_were_removed_reason',
});

/**
 * Whether a removed person is shown the reason the admin recorded.
 *
 * FALSE (Frits, 2026-08-28: *"lets say no for now, but make it easy to change"*).
 *
 * What flipping it would mean, so the choice is made with its consequences visible rather than as a
 * config tweak:
 *   · the text was written BY one person ABOUT another and never for their eyes — an admin typing
 *     "keeps ignoring the bin rota" into a field is not writing to the person it names;
 *   · it is unverified and unanswerable: the removed member cannot correct it and, once removed, has
 *     no channel in that circle to reply on;
 *   · it becomes the last thing a person is told by a group they belonged to, which is a weight most
 *     admins will not have realised they were putting on it.
 * None of that is an argument that they should never know — only that showing it is a different
 * feature (with a warning at the point of typing) rather than a `true` here.
 *
 * To flip: set this to `true`, thread `reason` from the removal record into `removalNotice`, and the
 * `withReason` key above is already there. Nothing else in this module needs to change.
 */
const SHOW_REMOVAL_REASON = false;

const refOf = (row) => (typeof row === 'string' ? row : (row?.webid ?? row?.addr ?? row?.ref ?? ''));

/**
 * Was this person removed, as opposed to having left?
 *
 * The distinction matters and cannot be read off the roster, where both look identical — absent. It
 * lives in the membership lane: a `leave` is SELF-authored (the fold enforces author == subject) and an
 * `evict` is authored by an admin about someone else. Somebody who walked out does not need telling
 * they are gone; somebody who was removed does.
 *
 * On the removed member's own device the typed `group-removal` item does not exist — that is written on
 * the ADMIN's device — so the signed statement is the only record there is, which is exactly why the
 * eviction has to reach them at all (fixed 2026-08-27: `alsoTo` now carries their proven address).
 *
 * ── THIS DELIBERATELY DOES NOT ORDER THE STATEMENTS ──────────────────────────────────────────────────
 * A first version took the last matching statement as the most recent one. It is not: the verified read
 * returns them in storage order, and a real device produced `["evict:admin→me", "join:admin→me"]` for a
 * member who had joined and THEN been evicted — the original join arriving after the eviction, because
 * catch-up brought it later. Reading that as a re-join meant the person was told nothing (walked
 * 2026-08-28, and my own unit test had encoded the same false assumption).
 *
 * There is nothing to order, because the question of WHETHER I am still in has already been answered,
 * authoritatively, by the fold — `removalNotice` only reaches here when the roster says I am out, and
 * that roster is ordered by causal depth. So a re-join needs no special case: it puts me back in the
 * roster and this function is never consulted. All that is left is WHY, and for that the presence of an
 * eviction about me, authored by somebody else, is the whole answer.
 *
 * @param {Array<object>} statements  verified membership bodies for this circle (`readVerifiedBodies`)
 * @param {string} myRef
 * @returns {{ by: string|null }|null} the eviction that removed me, or null
 */
export function evictionOfMe(statements, myRef) {
  if (!Array.isArray(statements) || typeof myRef !== 'string' || !myRef) return null;
  for (const b of statements) {
    if (b?.kind !== 'evict' || b?.subject !== myRef) continue;
    if (b?.author === myRef) continue;          // self-authored: a departure, not a removal
    return { by: typeof b.author === 'string' ? b.author : null };
  }
  return null;
}

/**
 * What, if anything, to say to this person about their own membership.
 *
 * Mirrors `caretakerNotice`: it reads a folded roster plus the statements behind it and returns what
 * should be said, or null. No rendering, no store, no memory of what it has already said — the shells
 * hold the primitive that puts a line in front of a person.
 *
 * @param {object} a
 * @param {Array<object>} a.members      roster rows (`listGroupMembers`) as this device folds them
 * @param {string} a.myRef               this person's ref
 * @param {Array<object>} [a.statements] verified membership bodies, when the caller has them
 * @param {string|null} [a.reason]       the admin's recorded reason — ignored unless the flag above flips
 * @returns {{ key: string, by: string|null, reason?: string }|null}
 */
export function removalNotice({ members, myRef, statements = null, reason = null } = {}) {
  if (typeof myRef !== 'string' || !myRef) return null;
  const rows = Array.isArray(members) ? members : [];

  // A roster this device has no answer for says nothing about my standing. Absence from an EMPTY list
  // is not evidence of removal — it is evidence of not having loaded, and telling someone they were
  // thrown out of a circle because a read came back empty would be the worst possible false positive.
  if (rows.length === 0) return null;
  if (rows.some((r) => refOf(r) === myRef)) return null;      // still in it

  // I am not in a roster that has people in it. If the statements are at hand they settle WHY;
  // without them, absence from a populated circle this device still holds is enough to say something
  // true — a person owed a notice is worse served by silence than by a line that does not name a cause.
  if (Array.isArray(statements)) {
    const evicted = evictionOfMe(statements, myRef);
    if (!evicted) return null;                                // I left, or nothing says I was removed
    return SHOW_REMOVAL_REASON && reason
      ? { key: REMOVAL_NOTICE_KEYS.withReason, by: evicted.by, reason }
      : { key: REMOVAL_NOTICE_KEYS.removed, by: evicted.by };
  }
  return { key: REMOVAL_NOTICE_KEYS.removed, by: null };
}

/**
 * Say it — the shared WRITE, so both shells tell a removed person the same thing.
 *
 * The decision above was always shared; the delivery was not, and that is the whole of W23 (2026-08-29):
 * on a phone that had just been removed, nothing appeared at all, while the admin's `removeMember`
 * reported `told: true`. Web computed the notice inside its own paint code behind a module-scoped
 * `removalNoticeSaid`; mobile never computed it. A notice one shell can say and the other cannot is
 * invariant 2 in its plainest form.
 *
 * So the write lives here, next to the decision, and both shells call it.
 *
 * ── THE ENTRY ID IS THE MEMORY ───────────────────────────────────────────────────────────────────────
 * The line is an ordinary bot bubble — `circleChatMessageEvent`, the same entry kind both shells already
 * append for every other thing the app says to one person (`scope: 'self'`). Deliberately NOT a second
 * kind: `type: 'notification'` also exists and also lands in a circle, which is one concept with two
 * vocabularies; which of the two is canonical is a decision on the ledger, and this uses the one the
 * notices already use.
 *
 * Because the id is derived from the eviction rather than from a counter, saying it twice is impossible
 * rather than merely unlikely: the second call finds its own entry and returns null. That replaces the
 * shell boolean, and unlike a boolean it survives a reinstall — the log comes back, the line does not
 * repeat, and a person who was removed while offline is still told when their device catches up.
 *
 * Honest limit: the statement bodies this module sees carry `kind`/`subject`/`author` and no stable
 * hash, so the id is per (circle, remover). Removed by the same admin, re-invited, and removed again
 * by that same admin ⇒ the second removal reuses the id and is not said twice. Rare, and the fix is a
 * hash on the body rather than a counter here.
 *
 * @param {object} a
 * @param {{append:Function, query:Function}} a.eventLog
 * @param {string} a.circleId
 * @param {Array<object>} a.members       roster rows as this device folds them
 * @param {string} a.myRef
 * @param {Array<object>|null} [a.statements]
 * @param {(key:string)=>string} a.t      the shell's translator
 * @param {() => number} [a.now]          injectable clock (tests)
 * @returns {{ msgId: string, notice: object }|null}  null = nothing to say, or already said
 */
export function sayRemovalNotice({
  eventLog, circleId, members, myRef, statements = null, reason = null, t, now = () => Date.now(),
} = {}) {
  if (!eventLog?.append || typeof circleId !== 'string' || !circleId || typeof t !== 'function') return null;
  const notice = removalNotice({ members, myRef, statements, reason });
  if (!notice) return null;

  const msgId = `circle-${circleId}-removed-${notice.by ?? 'unknown'}`;
  // The id is the memory: ask the log, not a boolean the next boot forgets.
  try {
    const said = (eventLog.query?.({}) ?? []).some((e) => e?.id === msgId || e?.payload?.msgId === msgId);
    if (said) return null;
  } catch { /* an unreadable log must not silence the notice — better said twice than never */ }

  eventLog.append(circleChatMessageEvent({
    msgId, ts: now(), circleId, actor: 'bot', text: t(notice.key), scope: 'self',
  }));
  return { msgId, notice };
}

export default removalNotice;
