/**
 * basis v2 — assemble every circle's security state AT BOOT, from one authoritative list.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────────────
 * Boundary-authentication decisions 4 and 1 each landed with the same hole, found independently by the two
 * agents that built them: **the state that decides whether traffic is accepted was assembled by whichever
 * parts of the UI a person happened to open.**
 *
 *   • Decision 4 (per-circle signing identities) installed from a list, but web's came from `circlesCache`
 *     and mobile's from the substrate — two shells, two different ideas of "my circles".
 *   • Decision 1 (the roster that authorizes senders) was fed ONLY by `feedHouseholdRoster`, whose every
 *     caller was a SCREEN. A circle you had not opened this run had no roster recorded, so its traffic was
 *     accepted **unchecked** — warned once, counted in `unknownRosterAllowances`, but accepted.
 *
 * That failure mode is the bad kind: it degrades **open**, it is invisible to tests (which construct the
 * state directly) and invisible to a walk (you open the circle you are testing). Two independent security
 * decisions acquiring it in one day says the shape of the app invites it, so the fix is one shared entry
 * point rather than two more call sites.
 *
 * ── What it guarantees, and what it does not ─────────────────────────────────────────────────────────────
 * Guarantees: for every circle the SUBSTRATE knows about, the signing identity is installed and the roster
 * snapshot is recorded, before anything depends on either — and identically on both shells, because both
 * call this and nothing else.
 *
 * Does not guarantee: freshness. A member added after this ran is not in the snapshot until something feeds
 * it again (a screen opening the circle, a post-join hook, the next boot). That is the same best-effort
 * property the roster always had; what changes is that the FLOOR is no longer "whatever you happened to
 * look at".
 */

import { bindCircleAddressKeysFor } from './householdRosterPairing.js';
import { announceOwnCircleAddressIfChanged } from './circleAddressAnnounce.js';

/**
 * Ask the substrate which circles this device is in.
 *
 * The authoritative answer, not a cache: web previously primed from `circlesCache`, which is a rendering
 * convenience and can be empty on a cold boot — exactly when priming matters most.
 *
 * @returns {Promise<string[]>}
 */
export async function knownCircleIds({ agent } = {}) {
  if (typeof agent?.callSkill !== 'function') return [];
  try {
    const res = await agent.callSkill('stoop', 'listMyBuurts', {});
    return (Array.isArray(res?.buurts) ? res.buurts : [])
      .map((b) => (typeof b === 'string' ? b : b?.id))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Install signing identities and record roster snapshots for every circle.
 *
 * @param {object}   a
 * @param {object}   a.agent
 * @param {string[]} [a.circleIds]  explicit list; when omitted, asks the substrate. When given, it is
 *                                  UNIONED with the substrate's answer rather than replacing it — a caller
 *                                  passing "the circles I just rendered" must not narrow the floor.
 * @param {Function} [a.onWarn]     `(message, err)` — defaults to console.warn.
 *
 * Announcing our OWN address is deliberately NOT here — see `announceCircleAddresses` below, which must
 * run after the alias is bound.
 * @returns {Promise<{circleIds: string[], identitiesInstalled: boolean, rostersFed: number, rosterFailures: number}>}
 */
export async function primeCircleSecurity({ agent, circleIds = null, onWarn = null } = {}) {
  const warn = typeof onWarn === 'function'
    ? onWarn
    : (msg, err) => console.warn(`[circle-security] ${msg}`, err?.message ?? err ?? '');

  const fromSubstrate = await knownCircleIds({ agent });
  const ids = [...new Set([
    ...fromSubstrate,
    ...(Array.isArray(circleIds) ? circleIds.filter(Boolean) : []),
  ])];

  const out = {
    circleIds: ids, identitiesInstalled: false, rostersFed: 0, rosterFailures: 0,
  };
  if (!ids.length) return out;

  // 1. Signing identities first. Without one, nothing sent to that circle's address can be OPENED — so a
  //    circle with a roster and no identity is deafer than one with neither.
  try {
    await agent?.installCircleIdentities?.(ids);
    out.identitiesInstalled = true;
  } catch (err) {
    warn('signing identities failed', err);
  }

  // 2. Then the rosters — who may speak.
  //
  //    `bindCircleAddressKeysFor`, NOT `feedHouseholdRoster`. The two differ in a way that matters here:
  //    `feedHouseholdRoster` returns early unless `agent.addHouseholdPeer` exists, so the authorize
  //    snapshot — which lives inside it — was a PASSENGER on household sync and silently did not happen
  //    for any agent without it. Security state must not be gated behind an unrelated capability.
  //    `bindCircleAddressKeysFor` needs exactly what the job needs: `callSkill` + `registerPeerAddress`.
  //
  //    Concurrently: each is an independent substrate read, and a slow or broken one must not hold up the
  //    others. `allSettled`, because a circle whose members cannot be read falls back to accepting its
  //    traffic unchecked — reported, never thrown.
  const results = await Promise.allSettled(
    ids.map((circleId) => bindCircleAddressKeysFor({ agent, circleId })),
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.rostersFed += 1;
    else {
      out.rosterFailures += 1;
      warn(`roster snapshot failed for ${ids[i]} — its traffic will be accepted unchecked`, r.reason);
    }
  });

  // 3. …and say where WE answer (B2) — but ONLY when the caller says our alias is already bound.
  //
  //    ⚠ ORDER MATTERS, and getting it wrong is silent. An announcement sent before the per-circle alias
  //    is bound to the transport goes out signed by our CANONICAL key ("asked to send as … which this
  //    transport does not hold — falling back to the primary address"), and since per-circle signing
  //    became enforced every recipient refuses it as
  //    `a-members-canonical-key-where-they-sign-per-circle`. Measured in the three-party run: a joiner's
  //    announcement was refused by all recipients, and the fan reported success.
  //
  //    Both shells used to call this primer BEFORE `registerCircleAddresses` (which binds the alias), so
  //    every joiner hit it. They now pass `announce: true` on the later call instead.
  //
  //    This is the general re-announce trigger, and it lives here for the same reason the roster
  //    snapshot does: it must not depend on which screen someone opened. It is DIFF-GATED against
  //    the rows step 2 just read — an unchanged address announces nothing, so the steady state is
  //    silence and the only devices that speak are the ones whose address the circle does not yet
  //    know (a fresh join, a restored profile, a device whose derivation changed). Best-effort:
  //    an announcement that fails is a member still reached the old way, not a broken boot.
  return out;
}

/**
 * Say where WE answer, in every circle (B2). **Call this only once the per-circle ALIAS is bound.**
 *
 * Separate from the primer rather than a flag on it, because the two run at different moments: the primer
 * runs before the transport has our aliases, this runs after `registerCircleAddresses`. Folding it in as
 * an option meant calling the whole primer twice per boot and repeating every substrate read — which
 * showed up as load, not as a bug, which is the sort of cost that survives review.
 *
 * @returns {Promise<{announced: number, circleIds: string[]}>}
 */
export async function announceCircleAddresses({ agent, circleIds = null, onWarn = null } = {}) {
  const warn = typeof onWarn === 'function'
    ? onWarn
    : (msg, err) => console.warn(`[circle-security] ${msg}`, err?.message ?? err ?? '');

  const ids = Array.isArray(circleIds) && circleIds.length
    ? [...new Set(circleIds.filter(Boolean))]
    : await knownCircleIds({ agent });
  const out = { announced: 0, circleIds: ids };
  if (!ids.length) return out;

  const announces = await Promise.allSettled(
    ids.map((circleId) => announceOwnCircleAddressIfChanged({ agent, circleId, onWarn: warn })),
  );
  for (const a of announces) {
    if (a.status === 'fulfilled' && a.value?.announced) out.announced += 1;
  }
  return out;
}
