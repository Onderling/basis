/**
 * basis v2 — WHO MAY SPEAK IN A CIRCLE (Decision 1, step 3: the roster authorize).
 *
 * ── What this answers ───────────────────────────────────────────────────────────────────────────
 * Since Decision 1 the crypto layer verifies an envelope against the key the envelope CARRIES, not
 * against whatever key the claimed `_from` maps to. That makes verification self-consistent and
 * un-steerable — and it deliberately establishes nothing about who the sender is. A valid signature
 * by a key nobody vouched for is a valid signature from a stranger.
 *
 * This file is the vouching. Given the key that demonstrably signed an envelope and the address of
 * OURS it was sent to, it answers one question: **is that key on the roster of the circle that
 * address belongs to?** On it ⇒ that member. Not on it ⇒ a stranger, refused. The kernel calls it
 * through `SecurityLayer.setSenderAuthorizer` and never implements it — invariant 5: concrete
 * membership knowledge does not live in `packages/core`.
 *
 * ── Where it sits, and the open question it does not answer ─────────────────────────────────────
 * L3 (`plans/DESIGN-boundary-authentication.md` §13.3, Frits' call) asks whether this step belongs
 * in the kernel or a substrate. It is here, in the app, because this is the layer that already
 * holds rosters — but the shape is what survives either answer: the kernel holds a PORT, this file
 * is one implementation of it, and moving it into a substrate is a move of this file plus the two
 * lines in `realAgent.js` that install and feed it. No call site and no verdict shape changes.
 *
 * ── Synchronous by necessity ────────────────────────────────────────────────────────────────────
 * The receive path is synchronous, so the authorizer cannot go and read a roster when asked. It
 * answers from a snapshot that is refreshed out of band, at the moment the app already learns a
 * circle's membership (`bindCircleAddressKeysFor` — the one place that holds `{pubKey,
 * circleAddress}` per member). That is a real constraint and it has a real consequence, below.
 *
 * ── The honest degradation, stated rather than buried ───────────────────────────────────────────
 * A circle whose roster this snapshot has never seen is ALLOWED, not refused, and the allowance is
 * counted and warned about. Refusing would mean that any circle whose roster read had not happened
 * yet — a cold boot, a circle never opened, a failed skill call — silently drops every message from
 * every member, which is indistinguishable from the app being broken and is exactly the failure
 * mode Decision 3 shipped with. So the rule is: **refuse whenever a roster IS known, never on the
 * strength of not knowing.** The teeth are real for every circle the app has actually loaded; the
 * gap is real for one it has not, and `unknownRosterAllowances` is how you see it.
 *
 * ── Per-circle signing is ENFORCED, per member, with no flag day (B6) ───────────────────────────
 * A roster row carries the member's canonical `pubKey` AND their per-circle `circleAddress`, and
 * since Decision 4 what signs INSIDE the circle is the per-circle key (`circleSigningKeyOf`).
 * Recording both — the shape until 2026-08-02 — made per-circle signing a *preference*: a member who
 * simply kept signing canonically was accepted, so the cross-circle unlinkability decisions 1 and 4
 * exist to provide was the polite option rather than a property.
 *
 * The rule is now decided per member, from their own row, and it needs no coordination:
 *
 *   • the row carries a PROVEN per-circle address (`hasProvenCircleAddress`) ⇒ **their canonical key
 *     is refused.** They have demonstrated they can sign per-circle, so accepting the canonical one
 *     is a pure leak with no upside. Refused with its own reason, and counted separately from a
 *     stranger's refusal, because the two are different events: one is an outsider, the other is a
 *     member using the wrong identity.
 *   • the row carries no proven address ⇒ the canonical key is still allowed, because refusing it
 *     would make that member undeliverable rather than pseudonymous. This is the TRANSITIONAL SET,
 *     and it is counted (`canonicalOnlyMembers`) and warned about once per circle — a transition
 *     nobody can measure is a permanent state with better branding.
 *
 * It self-heals: the moment a member proves an address (B2's announce path, which is gated on the
 * *same* proof condition), their row moves from the second case to the first and their canonical key
 * stops being accepted. Nothing has to be switched on, and no two devices have to agree on a date.
 *
 * OUR OWN canonical key is the one deliberate exception, and it is not one of these two cases at
 * all: `selfKeys` names the keys of ours that speak here, and our other devices share this profile
 * seed and may still be speaking canonically. Refusing ourselves is never the right answer, and no
 * unlinkability of ours is protected by us refusing to hear from us.
 *
 * What is NOT allowed either way is a key belonging to a member of some OTHER circle — the snapshot
 * is per circle, so circle A's keys buy nothing in circle B.
 */

import { circleSigningKeyOf, hasProvenCircleAddress } from './circleAddressKeys.js';
import { allowSender, refuseSender } from '@onderling/core';

/** Verdict reasons. Diagnostics only — nothing branches on these but a human reading a log. */
export const SENDER_REASON = Object.freeze({
  NOT_CIRCLE_SCOPED: 'not-circle-scoped',
  ROSTER_UNKNOWN:    'no-roster-recorded-for-this-address',
  MEMBER:            'on-the-roster-of-this-circle',
  STRANGER:          'not-on-the-roster-of-this-circle',
  CANONICAL_REFUSED: 'a-members-canonical-key-where-they-sign-per-circle',
});

/**
 * Build the authorizer plus the seam that feeds it.
 *
 * @param {object} [a]
 * @param {(info: {ownAddress: string}) => void} [a.onUnknownRoster]
 *   called the FIRST time an address is authorized with no roster recorded for it. Once per
 *   address: a warning per envelope would be noise, and noise is how a real one gets missed.
 * @param {(info: {ownAddress: string, circleId: string|null, senderKey: string, from: string, reason: string}) => void} [a.onRefused]
 *   called when a validly-signed envelope is refused — as a stranger's, or as a member's canonical
 *   key where that member has proved a per-circle one. `reason` says which.
 * @param {(info: {ownAddress: string, circleId: string|null, count: number, of: number}) => void} [a.onCanonicalOnlyMembers]
 *   called when a recorded roster still contains members with no proven per-circle address — the
 *   transitional set, who are therefore still allowed to speak canonically. Fires once per circle
 *   per SIZE: silence means "unchanged", so a set that shrinks says so and a steady one is quiet.
 * @returns {{
 *   authorizeSender: (context: object) => {allow: boolean, reason: string},
 *   recordCircleRoster: (a: object) => number,
 *   forgetCircleSenders: (circleId: string) => boolean,
 *   circleAddressCount: number,
 *   unknownRosterAllowances: number,
 *   refusedStrangers: number,
 *   refusedCanonicalSigners: number,
 *   canonicalOnlyMembers: number,
 *   snapshotFor: (ownAddress: string) => ({circleId: string|null, keys: string[], canonicalOnly: number, refusedCanonical: string[]}|null),
 * }}
 */
export function createCircleSenderAuthorization({
  onUnknownRoster = null, onRefused = null, onCanonicalOnlyMembers = null,
} = {}) {
  /** our per-circle address → { circleId, keys: Set<string> } */
  const byOwnAddress = new Map();
  /** circleId → our per-circle address, so a left circle can be dropped by id */
  const addressOfCircle = new Map();
  const warnedUnknown = new Set();
  /** our per-circle address → the transitional-set size we last warned about, so silence means "same" */
  const warnedCanonicalOnly = new Map();
  let unknownRosterAllowances = 0;
  let refusedStrangers = 0;
  let refusedCanonicalSigners = 0;

  /**
   * Record (or refresh) which keys may speak in one circle.
   *
   * Idempotent and REPLACING: a refreshed roster is the whole truth about that circle, so a removed
   * member stops being able to speak as soon as the refresh runs. A read that produced no usable
   * key records nothing at all — an empty roster is far more likely to be a failed skill call than
   * a circle with no members, and recording it would lock the circle out on the strength of a
   * failure.
   *
   * @param {object} a
   * @param {string} a.circleId
   * @param {string} a.ownAddress          this device's per-circle address in that circle
   * @param {Array<object>} a.members      roster rows (`stoop listGroupMembers`)
   * @param {string[]} [a.selfKeys]        keys of OURS that speak in this circle
   * @returns {number} how many distinct keys are now allowed
   */
  function recordCircleRoster({ circleId, ownAddress, members, selfKeys = [] } = {}) {
    if (typeof ownAddress !== 'string' || !ownAddress) return 0;
    const mine = new Set((Array.isArray(selfKeys) ? selfKeys : []).filter((k) => typeof k === 'string' && k));
    const keys = new Set();
    /** canonical keys deliberately EXCLUDED — members who have proved they can sign per-circle. */
    const refusedCanonical = new Set();
    /** …and the other half of the same walk: members still allowed by their canonical key alone. */
    let canonicalOnly = 0;

    for (const m of Array.isArray(members) ? members : []) {
      const signing   = circleSigningKeyOf(m);
      const canonical = (typeof m?.pubKey === 'string' && m.pubKey) ? m.pubKey : null;
      if (typeof signing === 'string' && signing) keys.add(signing);
      if (!canonical) continue;
      // Our own row is neither enforced nor counted: `selfKeys` already decides which keys of ours
      // speak here, and our other devices may still be speaking canonically (see the header).
      if (mine.has(canonical)) { keys.add(canonical); continue; }
      if (hasProvenCircleAddress(m)) { refusedCanonical.add(canonical); continue; }
      keys.add(canonical);
      canonicalOnly += 1;
    }

    for (const k of mine) keys.add(k);
    // Our own address is our own signing key under one derivation (L2); adding it costs nothing if
    // that is ever answered otherwise, because then `selfKeys` carries the real one.
    keys.add(ownAddress);
    // Allowing wins over refusing, always. One key can reach both sets — our own row read back from
    // the roster, or (in principle) two members sharing one key — and a snapshot that both allows
    // and refuses the same key is an outage waiting for the order of two `if`s to change.
    for (const k of keys) refusedCanonical.delete(k);
    // Fewer than two keys means we found nobody but ourselves — the same "the read failed" shape.
    if (keys.size < 2) return 0;
    byOwnAddress.set(ownAddress, { circleId: circleId ?? null, keys, refusedCanonical, canonicalOnly });
    if (circleId) addressOfCircle.set(circleId, ownAddress);
    warnedUnknown.delete(ownAddress);

    // Say how big the transition still is — once per size, so a shrink is audible and a steady state
    // is silent. A count nobody can read is not a transition, it is a permanent state with a nicer name.
    if (canonicalOnly === 0) warnedCanonicalOnly.delete(ownAddress);
    else if (warnedCanonicalOnly.get(ownAddress) !== canonicalOnly) {
      warnedCanonicalOnly.set(ownAddress, canonicalOnly);
      try {
        onCanonicalOnlyMembers?.({
          ownAddress, circleId: circleId ?? null, count: canonicalOnly,
          of: Array.isArray(members) ? members.length : 0,
        });
      } catch { /* diagnostics only */ }
    }
    return keys.size;
  }

  /** Drop a circle's roster — it was left. Idempotent. */
  function forgetCircleSenders(circleId) {
    const address = addressOfCircle.get(circleId);
    if (!address) return false;
    addressOfCircle.delete(circleId);
    warnedCanonicalOnly.delete(address);
    return byOwnAddress.delete(address);
  }

  /**
   * The port itself. Synchronous, allocation-light, and asked about EVERY inbound envelope that
   * verified — including out-of-circle ones, which it passes without looking anything up.
   *
   * @param {object} context  `{ senderKey, from, to, ownAddress, pattern }`
   */
  function authorizeSender({ senderKey, from, ownAddress } = {}) {
    // Not addressed to one of our per-circle identities ⇒ not circle traffic. Contact and pairing
    // live here, and trust-on-first-use is the right answer for them — it is the only answer that
    // lets a stranger ever become a contact.
    if (typeof ownAddress !== 'string' || !ownAddress) {
      return allowSender(SENDER_REASON.NOT_CIRCLE_SCOPED);
    }
    const entry = byOwnAddress.get(ownAddress);
    if (!entry) {
      unknownRosterAllowances += 1;
      if (!warnedUnknown.has(ownAddress)) {
        warnedUnknown.add(ownAddress);
        try { onUnknownRoster?.({ ownAddress }); } catch { /* diagnostics only */ }
      }
      return allowSender(SENDER_REASON.ROSTER_UNKNOWN);
    }
    if (typeof senderKey === 'string' && entry.keys.has(senderKey)) {
      return allowSender(SENDER_REASON.MEMBER);
    }
    // A MEMBER, signing as their canonical self in a circle where they have proved a per-circle
    // identity (B6). Refused like a stranger — the point is that the leak is not available — but
    // named and counted apart from one, because the operator response is completely different: this
    // is someone's own device on an old code path, not an outsider probing the circle.
    if (typeof senderKey === 'string' && entry.refusedCanonical.has(senderKey)) {
      refusedCanonicalSigners += 1;
      try {
        onRefused?.({
          ownAddress, circleId: entry.circleId, senderKey, from,
          reason: SENDER_REASON.CANONICAL_REFUSED,
        });
      } catch { /* diagnostics only */ }
      return refuseSender(SENDER_REASON.CANONICAL_REFUSED);
    }
    refusedStrangers += 1;
    try { onRefused?.({ ownAddress, circleId: entry.circleId, senderKey, from, reason: SENDER_REASON.STRANGER }); }
    catch { /* diagnostics only */ }
    return refuseSender(SENDER_REASON.STRANGER);
  }

  return {
    authorizeSender,
    recordCircleRoster,
    forgetCircleSenders,
    get circleAddressCount()      { return byOwnAddress.size; },
    get unknownRosterAllowances() { return unknownRosterAllowances; },
    get refusedStrangers()        { return refusedStrangers; },
    /** envelopes refused because a member with a proven per-circle address signed canonically. */
    get refusedCanonicalSigners() { return refusedCanonicalSigners; },
    /**
     * THE TRANSITIONAL SET, right now, across every recorded circle: members who are allowed to
     * speak by their canonical key alone, because their roster row proves no per-circle address.
     * A live figure, not a running total — it must be watched going DOWN.
     */
    get canonicalOnlyMembers() {
      let n = 0;
      for (const entry of byOwnAddress.values()) n += entry.canonicalOnly ?? 0;
      return n;
    },
    snapshotFor(ownAddress) {
      const entry = byOwnAddress.get(ownAddress);
      return entry ? {
        circleId:         entry.circleId,
        keys:             [...entry.keys],
        canonicalOnly:    entry.canonicalOnly ?? 0,
        refusedCanonical: [...(entry.refusedCanonical ?? [])],
      } : null;
    },
  };
}
