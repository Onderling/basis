/**
 * basis v2 — the roster "pull-me" signal (profile-update propagation).
 *
 * A member edits what they disclose to a circle → the ADMIN ROSTER is written
 * (the roster is the source of truth; a member speaks only for their own row) →
 * a SILENT typed entry lands on that circle's stream saying only *whose row
 * changed and which keys* → every member RE-READS those rows from the roster.
 *
 * Three rules this module exists to keep:
 *
 *   1. **No fat push.** The entry and its wire envelope carry a member REF +
 *      the changed KEY NAMES. Never a value. `rosterUpdatedPayload` is a
 *      whitelist, so a caller who hands it values gets them dropped HERE, at
 *      the boundary (the same discipline as `mediaForCircleWire`).
 *   2. **No chat bubble.** The entry rides the C15 SILENT lane
 *      (`EventLog.appendSilentEntry`): the per-circle chat projection
 *      (`buildCircleChat`) ignores it, the cross-circle Stream firehose still
 *      shows it, and `shouldWakeForEntry` is false for it — a roster update
 *      never wakes an offline member.
 *   3. **Diff-gated.** Nothing is announced unless something really changed —
 *      `changedPersonaKeys` is the one comparator both the member side (before
 *      sending) and the admin side (before writing) use.
 *
 * Reveal-gating needs no code here: the roster row holds exactly the persona's
 * RELEASE for that circle (`agents.getPersonaRelease`), so the key list is by
 * construction only what the member discloses to THIS circle.
 */

import { changedReleaseKeys, releaseUnchanged } from '@onderling/agent-registry';
import { LruSet } from './circleKindFactory.js';

// The diff lives ONCE, next to the disclosure policy it compares releases of
// (`@onderling/agent-registry` — the reveal-state home), so the member side here and the roster
// side in stoop gate on the same comparator. Re-exported for the basis-side call sites.
export { changedReleaseKeys, releaseUnchanged };

/**
 * The one name for this signal: the silent EventLog entry `type` AND the peer
 * wire subtype. One string so the log, the fan-out and the receiver can't drift.
 */
export const ROSTER_UPDATED_KIND = 'roster-updated';

/* ─── the signal payload (refs only, never values) ─────────────────────── */

/**
 * The pull-me body — a WHITELIST. `memberRef` is the member's webid (which is
 * the mesh signing address here, i.e. an address the circle already knows) and
 * `keys` are property NAMES. Anything else a caller passes is dropped.
 *
 * @param {object} a
 * @param {string} a.memberRef  whose row to re-read
 * @param {string[]} [a.keys]   which property keys changed (names only)
 * @returns {{memberRef: string, keys: string[]}}
 */
export function rosterUpdatedPayload({ memberRef, keys } = {}) {
  return {
    memberRef: typeof memberRef === 'string' ? memberRef : '',
    keys: Array.isArray(keys) ? keys.filter((k) => typeof k === 'string' && k) : [],
  };
}

/**
 * Append the SILENT pull-me entry to a circle's stream. Thin over C15's
 * `EventLog.appendSilentEntry` — the point is that every producer (the admin
 * recording a peer's update, an admin editing their own row, a member receiving
 * the fan-out) shapes the SAME entry.
 *
 * @param {object} a
 * @param {{appendSilentEntry: Function}} a.eventLog
 * @param {string} a.circleId
 * @param {string} a.memberRef
 * @param {string[]} [a.keys]
 * @param {number} [a.ts]
 * @param {string} [a.id]
 * @returns {object|null} the appended entry (null when no log was wired)
 */
export function appendRosterUpdatedEntry({ eventLog, circleId, memberRef, keys, ts, id } = {}) {
  if (!eventLog || typeof eventLog.appendSilentEntry !== 'function') return null;
  if (typeof circleId !== 'string' || !circleId) return null;
  return eventLog.appendSilentEntry({
    circleId,
    kind:    ROSTER_UPDATED_KIND,
    actor:   typeof memberRef === 'string' ? memberRef : undefined,
    payload: rosterUpdatedPayload({ memberRef, keys }),
    ...(typeof ts === 'number' ? { ts } : {}),
    ...(typeof id === 'string' && id ? { id } : {}),
  });
}

/* ─── admin side: announce a real roster change ────────────────────────── */

/**
 * Build the ADMIN-side announcer: on a REAL roster change, drop the silent
 * entry locally and fan the same refs out to the circle so every member pulls.
 * Callers (both shells) construct one and hand it to the places that write the
 * roster — the peer handler (`makeHandlePersonaPropsUpdate`) and the local
 * "I am the admin of my own circle" path (`shareDisclosureToCircle`).
 *
 * Fire-and-forget for callers; returns the promise so tests can await it.
 *
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.rawCallSkill
 * @param {{appendSilentEntry: Function}} [a.eventLog]
 * @param {() => void} [a.onChange]   rerender hook (the local surface refreshes too)
 * @param {{info?:Function, warn?:Function}} [a.logger]
 * @returns {(a:{circleId:string, memberRef:string, keys?:string[]}) => Promise<object|null>}
 */
export function makeRosterUpdateAnnouncer({ rawCallSkill, eventLog, onChange, logger = console } = {}) {
  return async function announceRosterUpdate({ circleId, memberRef, keys } = {}) {
    if (typeof circleId !== 'string' || !circleId) return null;
    const body = rosterUpdatedPayload({ memberRef, keys });
    const ts = Date.now();
    const msgId = `ru-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    appendRosterUpdatedEntry({ eventLog, circleId, ...body, ts, id: msgId });
    try { onChange?.(); } catch { /* a render hook must never break the fan-out */ }
    if (typeof rawCallSkill !== 'function') return null;
    try {
      return await rawCallSkill('stoop', 'broadcastRosterUpdated', {
        groupId: circleId, msgId, ts, ...body,
      });
    } catch (err) {
      logger.warn?.('[roster-updated] fan-out failed', err?.message ?? err);
      return null;
    }
  };
}

/* ─── member side: receive the signal and pull ─────────────────────────── */

/** Envelope guard — same shape as the other per-circle broadcasts. */
export function isValidRosterUpdatedEnvelope(p) {
  return !!(
    p
    && typeof p === 'object'
    && p.subtype  === ROSTER_UPDATED_KIND
    && typeof p.circleId  === 'string' && p.circleId
    && typeof p.msgId     === 'string' && p.msgId
    && typeof p.ts        === 'number' && Number.isFinite(p.ts)
    && typeof p.memberRef === 'string' && p.memberRef
  );
}

/**
 * MEMBER-side inbound handler for the pull-me signal. Registered on the peer
 * router under `roster-updated`. It records the silent entry locally (so the
 * Stream firehose shows what happened) and then asks the host to RE-READ the
 * roster — the pull. No bubble, no toast: `onPull` refreshes the MEMBERS rows /
 * member cards and nothing else.
 *
 * @param {object} a
 * @param {{appendSilentEntry: Function}} [a.eventLog]
 * @param {(a:{circleId:string, memberRef:string, keys:string[]}) => any} [a.onPull]
 * @param {LruSet} [a.dedup]
 * @param {number} [a.dedupCap=256]
 * @param {{debug?:Function, warn?:Function}} [a.logger]
 * @returns {(fromPeerAddr: string, payload: object) => Promise<void>}
 */
export function makeRosterUpdatedPeerHandler({
  eventLog, onPull, dedup = null, dedupCap = 256, logger = console,
} = {}) {
  const seen = dedup ?? new LruSet(dedupCap);
  return async function onRosterUpdated(_fromPeerAddr, payload) {
    if (!isValidRosterUpdatedEnvelope(payload)) {
      logger.warn?.('[roster-updated] dropping malformed envelope', payload);
      return;
    }
    if (seen.has(payload.msgId)) return;
    seen.add(payload.msgId);
    const body = rosterUpdatedPayload(payload);
    appendRosterUpdatedEntry({
      eventLog, circleId: payload.circleId, ...body, ts: payload.ts, id: payload.msgId,
    });
    try { await onPull?.({ circleId: payload.circleId, ...body }); }
    catch (err) { logger.warn?.('[roster-updated] pull failed', err?.message ?? err); }
  };
}
