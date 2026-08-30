/**
 * basis v2 — one read-through cache for the roster reads at the `stoop` waist.
 *
 * Found on the phone (2026-08-30, story 8 → N8/N9): at boot every lane walks every circle's roster on its
 * own — the governance, membership, key and grants catch-ups each call `listMyCircles` then a roster read
 * per circle, the frontier replays do the same, the pairing check again, and the membership verifier reads
 * the roster per statement it binds. ~45 roster reads a minute at rest, each a signed envelope round trip
 * to the stoop agent over the internal bus plus the per-member work in the handler. That saturated the JS
 * thread for the first two minutes after launch — native mDNS promises resolved 20–80 s late — and it is
 * battery all day.
 *
 * The callers are right to ask; they are wrong to each ask the wire. A roster changes on a membership
 * statement, not between two lanes' catch-ups a millisecond apart. So: the three reads share one answer per
 * (op, circle) for a short window, concurrent callers share the in-flight promise, and any write through
 * the same waist — or a membership statement landing — invalidates. The callers keep their code.
 *
 * Deliberately NOT a longer verifier memo: a stale roster is a security question for the verifier
 * (binding a statement to membership), so the window is short and every membership change clears it.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * How long one roster answer serves every caller. Measured on the A33: the boot kicks (one per lane, 2–3.5 s
 * apart on paper) land 10–20 s apart because each read costs the saturated JS thread ~0.5 s, so a 5 s
 * window never overlapped two lanes. 30 s covers the whole boot sequence; a membership change inside the
 * window clears it (writes through the waist, landed statements, the store's own change event).
 */
export const ROSTER_READ_TTL_MS = param({
  key: 'rosterRead.ttlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000,
});

/** The stoop ops this cache answers. Everything else through the waist is treated as a potential write. */
export const ROSTER_READ_OPS = Object.freeze(['listGroupMembers', 'listGroupRoster', 'listMyCircles']);

/** Stoop ops that only read something else — they do not touch the roster, so they must not invalidate. */
const NON_ROSTER_READS = new Set([
  'listFeed', 'listPosts', 'searchPosts', 'whoAmI', 'getCurrentGroup', 'listSkills', 'getProfile',
  'listGroupChatHistory', 'listMyHandle', 'getGroupInvite', 'listGrants', 'getPolicy', 'briefSummary',
]);

export function isRosterRead(opId) { return ROSTER_READ_OPS.includes(opId); }

/**
 * @param {object} [deps]
 * @param {number} [deps.ttlMs]
 * @param {() => number} [deps.now]
 * @returns {{ read, afterWrite, invalidate, invalidateAll, size }}
 */
export function createRosterReadCache({ ttlMs = ROSTER_READ_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();   // key → { at, promise, circleId }

  const keyFor = (opId, args) => {
    if (!isRosterRead(opId)) return null;
    const circleId = args?.groupId ?? '';
    return `${opId}|${circleId}|${args?.spineless === true ? 's' : ''}`;
  };

  function invalidate(circleId) {
    for (const [k, e] of entries) {
      if (e.circleId === circleId || e.circleId === '' /* listMyCircles */) entries.delete(k);
    }
  }
  function invalidateAll() { entries.clear(); }

  return {
    /**
     * Answer a roster read from the window, or run it once for everyone asking in the window.
     * A rejected read is forgotten immediately — a failure must not be served for five seconds.
     */
    read(opId, args, run) {
      const key = keyFor(opId, args);
      if (!key) return run();
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.promise;
      const promise = Promise.resolve().then(run);
      entries.set(key, { at: now(), promise, circleId: args?.groupId ?? '' });
      promise.catch(() => { if (entries.get(key)?.promise === promise) entries.delete(key); });
      return promise;
    },
    /** A stoop op that may have changed a roster went through the waist: forget everything. */
    afterWrite(opId) {
      if (isRosterRead(opId) || NON_ROSTER_READS.has(opId)) return;
      invalidateAll();
    },
    invalidate,
    invalidateAll,
    get size() { return entries.size; },
  };
}
