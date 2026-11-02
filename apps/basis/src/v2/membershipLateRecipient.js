/**
 * membershipLateRecipient — a statement this device fanned is told again to a member whose address landed later.
 *
 * A device fans each membership statement it signs to the roster it holds at that moment. A short roster (a new point
 * that opened on a catch-up batch whose address rows were still being re-tried) leaves a member who never hears it, and
 * the fan has no second chance. So the device remembers, for a window, which addresses each of its own statements
 * reached; when the roster later holds an address that was not among them, it tells those statements again — the same
 * signed statement under the same message id, so every receiver that already holds it dedupes. A statement is kept for
 * the window, and beyond it while a member the fan had no address for still waits; otherwise the catch-up reconciles.
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
 * @returns {{ windowMs: number, noAddress: (circleId: string, webids: string[]) => void, unreachable: (circleId: string, rows: Array<{webid: string, addresses: string[]}>) => string[],
 *             holds: (circleId: string) => boolean, fanned: (circleId: string, statement: object, reached: string[]) => void,
 *             rosterAddresses: (circleId: string, addresses: string[]) => Promise<number> }}
 */
export function makeLateRecipientRetell({ retell, now = Date.now, windowMs = LATE_RECIPIENT_WINDOW_MS } = {}) {
  if (typeof retell !== 'function') throw new Error('makeLateRecipientRetell: `retell` is required');
  const byCircle = new Map();   // circleId → Array<{ statement, reached: Set<string>, at }>
  // members a fan had NO ADDRESS for (circleId → webid → since): past the window with still none, the person is told
  const missing = new Map();
  // a statement is kept for the window — and beyond it while a member the circle's fans had no address for still waits
  // (their address landing later must still bring them the statement); bounded, newest kept
  const KEEP_WHILE_WAITING = 200;
  const prune = (circleId) => {
    const waiting = (missing.get(circleId)?.size ?? 0) > 0;
    let list = (byCircle.get(circleId) ?? []).filter((e) => waiting || now() - e.at <= windowMs);
    if (list.length > KEEP_WHILE_WAITING) list = list.slice(-KEEP_WHILE_WAITING);
    if (list.length) byCircle.set(circleId, list); else byCircle.delete(circleId);
    return list;
  };
  return {
    /** The window this memory keeps (the caller schedules its own look once it has passed). */
    windowMs,
    /** The fan reached these current members nowhere: they have no circle address on this device's roster yet. */
    noAddress(circleId, webids = []) {
      if (typeof circleId !== 'string' || !circleId) return;
      const m = missing.get(circleId) ?? new Map();
      for (const w of webids ?? []) if (w && !m.has(w)) m.set(w, now());
      if (m.size) missing.set(circleId, m);
    },
    /**
     * The members of this circle the person should be told about: a fan had no address for them, the window passed,
     * and the roster rows given (`[{ webid, addresses }]`) still show none. A member whose address landed, or who is no
     * longer on the roster, is forgotten.
     */
    unreachable(circleId, rows = []) {
      const m = missing.get(circleId);
      if (!m) return [];
      const byWebid = new Map((rows ?? []).map((r) => [r?.webid, r]));
      const out = [];
      for (const [w, since] of [...m]) {
        const row = byWebid.get(w);
        if (!row || (row.addresses ?? []).length > 0) { m.delete(w); continue; }
        if (now() - since > windowMs) out.push(w);
      }
      if (!m.size) missing.delete(circleId);
      return out;
    },
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
