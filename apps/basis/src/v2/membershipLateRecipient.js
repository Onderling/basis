/**
 * membershipLateRecipient — a statement this device fanned is told again to a member whose address landed later.
 *
 * A device fans each membership statement it signs to the roster it holds at that moment. A short roster (a new point
 * that opened on a catch-up batch whose address rows were still being re-tried) leaves a member who never hears it, and
 * the fan has no second chance. So the device remembers, for a window, which addresses each of its own statements
 * reached; when the roster later holds an address that was not among them, it tells those statements again — the same
 * signed statement under the same message id, so every receiver that already holds it dedupes. Past the window the
 * catch-up is what reconciles, as before.
 *
 * Pure: the caller hands the retell (its broadcast) and reports the roster's addresses when the roster changes.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a fanned statement is remembered for a late recipient (after that, the catch-up covers it). */
export const LATE_RECIPIENT_WINDOW_MS = param({ key: 'membership.lateRecipientWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60_000 });

/**
 * @param {object} a
 * @param {(circleId: string, statement: object) => Promise<any>} a.retell  the broadcast, as the fan sends it
 * @param {() => number} [a.now]
 * @param {number} [a.windowMs]
 * @returns {{ holds: (circleId: string) => boolean, fanned: (circleId: string, statement: object, reached: string[]) => void,
 *             rosterAddresses: (circleId: string, addresses: string[]) => Promise<number> }}
 */
export function makeLateRecipientRetell({ retell, now = Date.now, windowMs = LATE_RECIPIENT_WINDOW_MS } = {}) {
  if (typeof retell !== 'function') throw new Error('makeLateRecipientRetell: `retell` is required');
  const byCircle = new Map();   // circleId → Array<{ statement, reached: Set<string>, at }>
  const prune = (circleId) => {
    const list = (byCircle.get(circleId) ?? []).filter((e) => now() - e.at <= windowMs);
    if (list.length) byCircle.set(circleId, list); else byCircle.delete(circleId);
    return list;
  };
  return {
    /** Whether any statement of this circle is still remembered (so the caller reads the roster only then). */
    holds(circleId) { return prune(circleId).length > 0; },
    fanned(circleId, statement, reached = []) {
      if (typeof circleId !== 'string' || !circleId || !statement?.body?.hash) return;
      const list = prune(circleId);
      list.push({ statement, reached: new Set((reached ?? []).filter(Boolean)), at: now() });
      byCircle.set(circleId, list);
    },
    /** The roster's member addresses now; every remembered statement is told again to the circle if one is new to it. */
    async rosterAddresses(circleId, addresses = []) {
      let told = 0;
      for (const e of prune(circleId)) {
        const fresh = (addresses ?? []).filter((a) => a && !e.reached.has(a));
        if (!fresh.length) continue;
        for (const a of fresh) e.reached.add(a);
        try { await retell(circleId, e.statement); told += 1; } catch { /* the catch-up remains */ }
      }
      return told;
    },
  };
}
