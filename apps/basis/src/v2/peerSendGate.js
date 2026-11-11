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
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * How long one invite exchange's send stays allowed on the person key: outlives the joiner's 30 s redeem timeout, so the
 * request and its retries match, and an answer the inviter never sent does not stand.
 */
export const INVITE_EXCHANGE_LIFETIME_MS = param({ key: 'sendGate.inviteExchangeLifetimeMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
/** At most this many invite exchanges are open at once on a device; past it the oldest goes. */
export const INVITE_EXCHANGE_MAX = param({ key: 'sendGate.inviteExchangeMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 16 });

/**
 * THE PERSON KEY'S ALLOWLIST. A send that is no circle's and no own device's leaves on the person key ONLY for one of
 * these reasons; anything else is 'none' (recorded today; held as 'unknown-address' once the gate enforces it). Data, in
 * one place: a new case is an entry here with its reason, never a silent fallback. Each entry answers from FACTS the agent
 * hands in (what this device holds), never from a caller's option, so no caller can name an entry for itself. Ordered
 * most specific first, the person's address-fallback setting LAST, so `allowedBy` names the real reason.
 * (Own devices are decided before the gate and recorded as 'own-device'.)
 */
export const PERSON_ALLOWLIST = Object.freeze([
  Object.freeze({
    id: 'invite-exchange',
    reason: 'the invite exchange: the joiner to the address on an invite it is redeeming now, and the inviter\'s one reply to a well-formed request (the answer when it proved its code, else the refusal) (the invite names the inviter\'s cross-circle id by decision, so this buys no link)',
    matches: (f) => f?.inviteExchange === 'joiner' || f?.inviteExchange === 'answer' || f?.inviteExchange === 'refusal',
    detail: (f) => ({ side: f.inviteExchange }),
  }),
  Object.freeze({
    id: 'contact-card',
    reason: 'a person in this self\'s contact book (not hidden, not deleted), at an address the row names or one the identity link PROVES is theirs (a contact\'s other device): an address the person chose to keep, so speaking to it as the person links nothing new',
    matches: (f) => !!f?.contact,
    detail: (f) => ({ origin: f.viaDevice === true ? 'card-via-device' : contactOriginOf(f.contact) }),
  }),
  Object.freeze({
    id: 'address-fallback',
    reason: 'the person turned on "rather routed over my one key than undeliverable": their choice, so the last resort',
    matches: (f) => f?.addressFallback === true,
  }),
]);

/**
 * Which allowlist entry lets a person-key send through, from the facts the agent holds about `to`.
 * @param {{inviteExchange?: 'joiner'|'answer'|null, contact?: object|null, addressFallback?: boolean}} [facts]
 * @returns {{allowedBy: string, origin?: string, side?: string}}
 */
export function personAllowedBy(facts = {}) {
  for (const e of PERSON_ALLOWLIST) {
    let hit = false;
    try { hit = e.matches(facts ?? {}) === true; } catch { hit = false; }
    if (hit) return { allowedBy: e.id, ...(e.detail ? e.detail(facts) : {}) };
  }
  return { allowedBy: 'none' };
}

/**
 * Where a contact-book row came from, read off the fields it carries: a bot's row, an identity link, the pair roster's
 * row for a contact's pair circle, or a card scan / deliberate add (the book does not tell those two apart today).
 * @param {object} row
 * @returns {'bot'|'link'|'pair-roster'|'card-or-add'}
 */
export function contactOriginOf(row) {
  if (row?.bot === true) return 'bot';
  if (row?.linkedRow || Number.isFinite(row?.linkedAt)) return 'link';
  if (typeof row?.pairCircleId === 'string' && row.pairCircleId) return 'pair-roster';
  return 'card-or-add';
}

/**
 * THE INVITE EXCHANGE's person-key sends, registered by the redeem code itself and nothing else: the JOINER's request to
 * the address on the invite it is redeeming (for that redeem's lifetime, released on its answer, timeout, error or failed
 * send), and the INVITER's ONE reply to a well-formed request: the answer when the request proved its code, the refusal
 * when it did not (each consumed by that reply). Bounded in count and in time; never a standing allow.
 *
 * One registration per redeem: two redeems open at once to one inviter (two codes from one admin) are counted, so the
 * first answer does not close the second. A reply is consumed on the gate's FIRST pass: every shell hands the redeem
 * handler `agent.sendPeerMessage`, one call is one pass, and hold-forward redelivery happens below the gate (the secure
 * agent's queue), so nothing re-enters it for the same reply.
 */
export function createInviteExchange({ now = () => Date.now(), lifetimeMs = INVITE_EXCHANGE_LIFETIME_MS, max = INVITE_EXCHANGE_MAX } = {}) {
  /** address → { n, until }: redeems open toward that inviter */
  const joiners = new Map();
  /** address → { side: 'answer'|'refusal', until }: the one reply owed to that joiner */
  const replies = new Map();
  const sweep = () => {
    const t = now();
    for (const m of [joiners, replies]) for (const [a, e] of m) if (e.until <= t) m.delete(a);
  };
  const bound = (m) => { while (m.size > max) m.delete(m.keys().next().value); };
  const reply = (address, side) => {
    if (typeof address !== 'string' || !address) return;
    sweep();
    replies.delete(address);   // re-insert: the newest goes last, so the bound drops the oldest
    replies.set(address, { side, until: now() + lifetimeMs });
    bound(replies);
  };
  return {
    /** JOINER: a redeem is about to send to the invite's address. Returns its release (idempotent). */
    expectFromInviter(address) {
      if (typeof address !== 'string' || !address) return () => {};
      sweep();
      const e = joiners.get(address);
      joiners.delete(address);
      joiners.set(address, { n: (e?.n ?? 0) + 1, until: now() + lifetimeMs });
      bound(joiners);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = joiners.get(address);
        if (!cur) return;
        if (cur.n <= 1) joiners.delete(address); else cur.n -= 1;
      };
    },
    /** INVITER: a well-formed request from `address` did not prove its code; its ONE refusal may go back. */
    refuseParsedRequest(address) { reply(address, 'refusal'); },
    /** INVITER: a request from `address` proved its code; its ONE answer may go back (replaces a refusal registration). */
    answerProvenRequest(address) { reply(address, 'answer'); },
    /** The gate asks, once per send: 'answer' | 'refusal' (now consumed) | 'joiner' | null. */
    take(address) {
      if (typeof address !== 'string' || !address) return null;
      sweep();
      const r = replies.get(address);
      if (r) { replies.delete(address); return r.side; }
      return joiners.has(address) ? 'joiner' : null;
    },
    get size() { sweep(); return joiners.size + replies.size; },
  };
}

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
export function sendDecisionFields(decision, explained = null, result = null, taken = null) {
  const out = {
    kind: decision?.kind ?? 'unknown',
    scope: decision?.circleId ? 'circle' : 'none',
    reason: decision?.reason ?? 'unknown',
  };
  // which person-key allowlist entry let it through (or 'none'), and a contact row's origin / the exchange's side: codes
  if (typeof decision?.allowedBy === 'string') out.allowedBy = decision.allowedBy;
  if (typeof decision?.origin === 'string') out.origin = decision.origin;
  if (typeof decision?.side === 'string') out.side = decision.side;
  // the route the send TOOK, as the send itself reported it; the candidates are explained only when nothing took it
  if (typeof taken === 'string' && taken) out.chosen = taken;
  const cands = Array.isArray(explained?.candidates) ? explained.candidates : [];
  if (explained) {
    if (!out.chosen) out.chosen = explained.chosen ?? 'none';
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
