/**
 * basis v2 — THE SEND GATE's decisions (home: Agent · Connectivity). Pure: the agent's `peerSend` (realAgent) holds
 * the state and does the sending; this file says what a send to an address IS, by what this device knows.
 *
 * Why a gate: a send carried the circle as an optional extra (`circleId`) beside a raw address string, and any of the
 * ~40 callers could forget it. A turn to a member's PER-CIRCLE address then left without its circle: unscoped, signed
 * with the canonical key, over whatever transport won for that peer, including one that cannot carry a per-circle
 * address at all (architecture §4, "Per-peer is not enough for a circle"). The address itself already says which
 * circle it belongs to, when this device has read that circle's roster. So the gate asks the rosters, once, here.
 *
 *   • a member's circle address in one of my circles → that circle's scope (my circle self + the circle's points)
 *   • a caller-given circle that disagrees with the roster → refused (it would sign as the wrong circle's self)
 *   • a caller-given circle and no roster hit → that circle, as before (a member the roster has not shown yet)
 *   • neither → the person path, unchanged: a first Hi to a new card must still go
 *   • a caller that names WHO speaks (`sendAs`) or asks to speak as the person keeps its choice
 *
 * The transport layer never learns that a circle exists; the circle travels down as points (the scope).
 */
import { circleAddressSetOf } from './circleAddressKeys.js';

/**
 * Member per-circle address → circleId, from the roster reads the agent already makes (the sender check's read),
 * kept fresh by the same two hooks: a read REPLACES a circle's entries, a leave forgets them.
 *
 * Only per-circle addresses: never a person key or a webid (those are the person path), and never my own row (an
 * own device is reached as a sibling, before this index is asked). An address two circles both claim answers
 * neither: an ambiguous circle is not a route.
 */
export function createCircleAddressIndex() {
  /** circleId → Set<address> */
  const byCircle = new Map();
  /** address → Set<circleId> */
  const byAddress = new Map();
  const drop = (circleId) => {
    for (const a of byCircle.get(circleId) ?? []) {
      const cs = byAddress.get(a);
      if (cs) { cs.delete(circleId); if (cs.size === 0) byAddress.delete(a); }
    }
    byCircle.delete(circleId);
  };
  return {
    /** @returns {number} how many addresses the circle now has here (0 = nothing recorded, the old entries kept) */
    recordRoster(circleId, members, { selfWebid = null } = {}) {
      if (typeof circleId !== 'string' || !circleId) return 0;
      const next = new Set();
      for (const m of Array.isArray(members) ? members : []) {
        if (selfWebid && m?.webid === selfWebid) continue;
        for (const a of circleAddressSetOf(m)) next.add(a);
      }
      // an empty read is far more likely a failed skill call than a circle with nobody else in it: keep what we had.
      // A removed member's address therefore leaves at the circle's NEXT non-empty read (which replaces the whole set),
      // or when the circle is left (`forget`).
      if (next.size === 0) return 0;
      drop(circleId);
      byCircle.set(circleId, next);
      for (const a of next) {
        let cs = byAddress.get(a);
        if (!cs) { cs = new Set(); byAddress.set(a, cs); }
        cs.add(circleId);
      }
      return next.size;
    },
    forget(circleId) { drop(circleId); },
    /**
     * What this device knows about `address`: `{ circleId }` (a member's circle address in exactly one of my circles),
     * `{ ambiguous: true }` (two or more of my circles claim it: KNOWN to be a circle address, so never the person
     * path), or null (not a circle address I know of).
     */
    lookup(address) {
      const cs = byAddress.get(address);
      if (!cs || cs.size === 0) return null;
      return cs.size === 1 ? { circleId: cs.values().next().value } : { ambiguous: true };
    },
    /** The one circle this address is a member's circle address in, or null (unknown, or ambiguous). */
    circleOf(address) { return this.lookup(address)?.circleId ?? null; },
    get size() { return byAddress.size; },
  };
}

/**
 * What a send to `to` is. Siblings (my own devices) are decided before this, by the device map.
 *
 * @param {object} a
 * @param {string} a.to
 * @param {object} [a.opts]     the caller's send options (`circleId`, `sendAs`, `asPerson`)
 * @param {(address: string) => ({circleId: string}|{ambiguous: true}|null)} a.circleOf  the index's `lookup`
 * @returns {{kind: string, circleId: string|null, reason: string, refuse?: true}}
 */
export function decidePeerSend({ to, opts = {}, circleOf } = {}) {
  if (opts?.asPerson) return { kind: 'as-person', circleId: null, reason: 'as-person' };
  if (typeof opts?.sendAs === 'string' && opts.sendAs) return { kind: 'as-given', circleId: null, reason: 'caller-sendas' };
  const named = typeof opts?.circleId === 'string' && opts.circleId ? opts.circleId : null;
  let known = null;
  try { known = typeof circleOf === 'function' ? circleOf(to) : null; } catch { known = null; }
  // KNOWN to be a circle address, but two of my circles claim it: refused. The person path would hand my canonical key
  // to a circle address, the one link per-circle addressing exists to withhold; guessing a circle could sign as the
  // wrong self. Per-circle addresses are derived per circle, so a double claim is a fault to surface, not to route.
  if (known?.ambiguous) return { kind: 'circle-member', circleId: null, reason: 'circle-ambiguous', refuse: true };
  const hit = known?.circleId ?? null;
  if (hit) {
    if (named && named !== hit) return { kind: 'circle-member', circleId: null, reason: 'circle-mismatch', refuse: true };
    return { kind: 'circle-member', circleId: hit, reason: 'roster-hit' };
  }
  if (named) return { kind: 'circle-named', circleId: named, reason: 'caller-circle' };
  return { kind: 'person', circleId: null, reason: 'no-roster-hit' };
}

/**
 * The ONE log record a send decision writes (`@onderling/logger`, tag 'agent', code 'send.decision'): the kind, the
 * scope, each candidate transport as `kind:why:reach`, the chosen one and the outcome. Codes and scalars only: never an
 * address, a circle id or a payload. A scoped send that found no eligible transport because a relay did not match the
 * circle's points says `point-mismatch`, the one reason a person can fix by naming the relay the same way.
 */
export function sendDecisionFields(decision, explained = null, result = null) {
  const out = {
    kind: decision?.kind ?? 'unknown',
    scope: decision?.circleId ? 'circle' : 'none',
    reason: decision?.reason ?? 'unknown',
  };
  const cands = Array.isArray(explained?.candidates) ? explained.candidates : [];
  if (explained) {
    out.chosen = explained.chosen ?? 'none';
    cands.slice(0, 4).forEach((c, i) => { out[`t${i}`] = `${c.kind}:${c.why}:${c.reach ? 'reach' : 'noreach'}`; });
    out.candidates = cands.length;
    if (explained.scoped && !explained.chosen && cands.some((c) => c.why === 'point-mismatch')) out.reason = 'point-mismatch';
  }
  if (result) {
    // a send without the hold guarantee answers whatever its transport answered: handed over, the weakest claim
    out.outcome = result.delivered === true ? 'delivered'
      : result.held === true ? `held${result.reason ? `:${result.reason}` : ''}`
      : result.delivered === false ? `not-sent${result.reason ? `:${result.reason}` : ''}`
      : 'sent';
  }
  return out;
}
