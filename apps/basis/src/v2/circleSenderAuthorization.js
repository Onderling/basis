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
 * ── Two keys per member, and why both are on the list ───────────────────────────────────────────
 * A roster row carries the member's canonical `pubKey` AND their per-circle `circleAddress`, and
 * since Decision 4 what signs INSIDE the circle is the per-circle key (`circleSigningKeyOf`). Both
 * are recorded, because both are proof-verified membership facts: a member speaking as their
 * canonical identity is still a member (linkable, and a worse choice for them, but not a stranger),
 * and refusing them would break every roster row written before per-circle signing existed. What
 * is NOT allowed is a key belonging to a member of some OTHER circle — the snapshot is per circle,
 * so circle A's keys buy nothing in circle B.
 */

import { circleSigningKeyOf } from './circleAddressKeys.js';
import { allowSender, refuseSender } from '@onderling/core';

/** Verdict reasons. Diagnostics only — nothing branches on these but a human reading a log. */
export const SENDER_REASON = Object.freeze({
  NOT_CIRCLE_SCOPED: 'not-circle-scoped',
  ROSTER_UNKNOWN:    'no-roster-recorded-for-this-address',
  MEMBER:            'on-the-roster-of-this-circle',
  STRANGER:          'not-on-the-roster-of-this-circle',
});

/**
 * Build the authorizer plus the seam that feeds it.
 *
 * @param {object} [a]
 * @param {(info: {ownAddress: string}) => void} [a.onUnknownRoster]
 *   called the FIRST time an address is authorized with no roster recorded for it. Once per
 *   address: a warning per envelope would be noise, and noise is how a real one gets missed.
 * @param {(info: {ownAddress: string, circleId: string|null, senderKey: string, from: string}) => void} [a.onRefused]
 *   called when a validly-signed envelope is refused as a stranger's.
 * @returns {{
 *   authorizeSender: (context: object) => {allow: boolean, reason: string},
 *   recordCircleRoster: (a: object) => number,
 *   forgetCircleSenders: (circleId: string) => boolean,
 *   circleAddressCount: number,
 *   unknownRosterAllowances: number,
 *   refusedStrangers: number,
 *   snapshotFor: (ownAddress: string) => ({circleId: string|null, keys: string[]}|null),
 * }}
 */
export function createCircleSenderAuthorization({ onUnknownRoster = null, onRefused = null } = {}) {
  /** our per-circle address → { circleId, keys: Set<string> } */
  const byOwnAddress = new Map();
  /** circleId → our per-circle address, so a left circle can be dropped by id */
  const addressOfCircle = new Map();
  const warnedUnknown = new Set();
  let unknownRosterAllowances = 0;
  let refusedStrangers = 0;

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
    const keys = new Set();
    for (const m of Array.isArray(members) ? members : []) {
      const signing = circleSigningKeyOf(m);
      if (typeof signing === 'string' && signing) keys.add(signing);
      if (typeof m?.pubKey === 'string' && m.pubKey) keys.add(m.pubKey);
    }
    for (const k of Array.isArray(selfKeys) ? selfKeys : []) {
      if (typeof k === 'string' && k) keys.add(k);
    }
    // Our own address is our own signing key under one derivation (L2); adding it costs nothing if
    // that is ever answered otherwise, because then `selfKeys` carries the real one.
    keys.add(ownAddress);
    // Fewer than two keys means we found nobody but ourselves — the same "the read failed" shape.
    if (keys.size < 2) return 0;
    byOwnAddress.set(ownAddress, { circleId: circleId ?? null, keys });
    if (circleId) addressOfCircle.set(circleId, ownAddress);
    warnedUnknown.delete(ownAddress);
    return keys.size;
  }

  /** Drop a circle's roster — it was left. Idempotent. */
  function forgetCircleSenders(circleId) {
    const address = addressOfCircle.get(circleId);
    if (!address) return false;
    addressOfCircle.delete(circleId);
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
    refusedStrangers += 1;
    try { onRefused?.({ ownAddress, circleId: entry.circleId, senderKey, from }); }
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
    snapshotFor(ownAddress) {
      const entry = byOwnAddress.get(ownAddress);
      return entry ? { circleId: entry.circleId, keys: [...entry.keys] } : null;
    },
  };
}
