/**
 * basis v2 — REMOVING someone from ONE circle, and LEAVING one, without touching any other (B4).
 *
 * ── What was broken ─────────────────────────────────────────────────────────────────────────────
 * Removal was global where it should have been local, and inert where it should have bitten:
 *
 *   • **global** — the substrate's `removeMember` deleted the member from the ONE per-device
 *     `MemberMap`, which carries no circle on a row. Tidying up circle A dropped that person's
 *     identity in every circle you shared with them. Fixed in the substrate
 *     (`apps/stoop/src/lib/circleExits.js` replaces the cache deletion with a per-circle exit).
 *   • **inert** — the `group-removal` audit item was read by nothing, so the removed member stayed
 *     on the circle's roster, stayed in the fan-out, and — the part that matters — stayed in the
 *     **boundary-authentication snapshot**. Their key was still in `recordCircleRoster`'s allowed
 *     set, so they could still SPEAK into the circle they had just been removed from. Removing them
 *     from the member list without that step would have been a UI change wearing a security label.
 *
 * ── What this module is ─────────────────────────────────────────────────────────────────────────
 * The two operations, once, for both shells (invariant 1 + 2). Each ends by re-running
 * `bindCircleAddressKeysFor`, which re-reads the roster and re-records the authorize snapshot **from
 * that same read** — the same one-read discipline B2 established, and the reason removal now reaches
 * the thing that decides who may speak.
 *
 * Leaving is the mirror image, on the leaver's device: the circle stops being a circle you are in,
 * so its snapshot is dropped entirely (`forgetCircleSenders`) rather than refreshed, and every
 * member's per-circle address is unbound. Their CANONICAL key mapping is deliberately left alone in
 * both cases — a former co-member may still be a contact, and forgetting that would break an
 * unrelated conversation. Backward secrecy is the key rotation, not the unbinding.
 */

import { bindCircleAddressKeysFor } from './householdRosterPairing.js';
import { forgetCircleAddressKeys } from './circleAddressKeys.js';

/**
 * Read one circle's raw roster rows (`{pubKey, circleAddress, …}`), best-effort.
 *
 * The rendered member lists on both shells go through `normalizeCircleMembers`, which strips the raw
 * key fields — so a caller holding a rendered row cannot supply the departing member's per-circle
 * address, and has to read for it. That read must happen BEFORE the removal, while they are still on
 * the roster.
 */
async function rawRoster({ callSkill, circleId }) {
  if (typeof callSkill !== 'function' || !circleId) return [];
  try {
    const res = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    return Array.isArray(res?.members) ? res.members : [];
  } catch { return []; }
}

/**
 * The skill seam, resolved once.
 *
 * `callSkill` is separate from `agent` on purpose: the substrate ops must work even where the shell's
 * security agent is not (yet) captured — web boots its peer agent asynchronously, and a removal that
 * started failing whenever that had not landed would be a regression dressed as a security fix. The
 * agent is needed only for the security steps, which are skipped (and reported as zero) without it.
 */
const skillSeam = (agent, callSkill) =>
  (typeof callSkill === 'function' ? callSkill
    : (typeof agent?.callSkill === 'function' ? (a, o, args) => agent.callSkill(a, o, args) : null));

/**
 * Remove ONE member from ONE circle — and make the removal reach everything that acts on membership.
 *
 * Order matters and is the whole point:
 *   1. read the roster while the member is still on it, to learn their per-circle address;
 *   2. ask the substrate to remove them from THIS circle (it records the exit + rotates the circle's
 *      content key through the per-circle control agent);
 *   3. stop being able to seal to their per-circle address;
 *   4. **re-read the roster and re-record the authorize snapshot from that read** — without this the
 *      removed member's key stays in the allowed set and they can still speak into the circle.
 *
 * Step 4 is not a refresh-for-tidiness: it is the step that makes 2 a security change. A caller that
 * skips it has changed a list.
 *
 * @param {object} a
 * @param {object} a.agent                     host agent (`forgetPeerAddress` + the roster seams)
 * @param {string} a.circleId
 * @param {Function} [a.callSkill]             `(app, op, args)`; defaults to `agent.callSkill`
 * @param {string} [a.memberWebid]
 * @param {string} [a.memberStableId]
 * @param {'graceful'|'ban'} [a.policy]
 * @returns {Promise<{ok: boolean, error?: string, removalId?: string, unbound: number, rosterKeys: number, remaining: number}>}
 */
export async function removeCircleMember({
  agent = null, callSkill = null, circleId, memberWebid = null, memberStableId = null, policy = 'graceful',
} = {}) {
  const out = { ok: false, unbound: 0, rosterKeys: 0, remaining: 0 };
  const skill = skillSeam(agent, callSkill);
  if (!skill || !circleId || (!memberWebid && !memberStableId)) {
    out.error = 'missing-args';
    return out;
  }

  // 1 — capture the departing member's per-circle address while the roster still names them.
  const before = await rawRoster({ callSkill: skill, circleId });
  const goneRow = before.find((m) => (memberWebid && m?.webid === memberWebid)
    || (memberStableId && m?.stableId === memberStableId)) ?? null;
  const goneAddress = typeof goneRow?.circleAddress === 'string' ? goneRow.circleAddress : null;

  // 2 — the substrate op. Per circle since 2026-08-02: it records an exit for THIS groupId, which the
  // roster projection honours, and routes the key rotation to THIS circle's producer.
  let res;
  try {
    res = await skill('stoop', 'removeMember', {
      groupId: circleId,
      ...(memberWebid ? { memberWebid } : {}),
      ...(memberStableId ? { memberStableId } : {}),
      policy,
    });
  } catch (err) { res = { error: err?.message ?? 'remove-failed' }; }
  if (res?.error) { out.error = res.error; return out; }
  out.ok = true;
  out.removalId = res?.removalId;

  // 3 — stop being able to seal to their per-circle address. Hygiene, not the protection.
  if (goneAddress && agent) {
    try {
      out.unbound = forgetCircleAddressKeys({
        addresses: [goneAddress],
        forgetPeerAddress: (addr) => agent.forgetPeerAddress?.(addr),
      }).forgotten;
    } catch { /* best-effort — the removal already stands */ }
  }

  // 4 — THE security half. One read, two uses: the sealing bindings and the authorize snapshot.
  try {
    const rebound = await bindCircleAddressKeysFor({ agent, circleId });
    out.remaining = Array.isArray(rebound?.members) ? rebound.members.length : 0;
    out.rosterKeys = rebound?.bound ?? 0;
  } catch { /* the removal stands; the snapshot refreshes again at the next boot/priming */ }

  return out;
}

/**
 * Leave ONE circle — and prune that circle on THIS device.
 *
 * The substrate half already existed (`leaveGroup`: an audit marker + the pod-side revoke). What did
 * not exist is the local prune: the leaver's device kept the circle's authorize snapshot and every
 * member's per-circle address binding, so a circle you had left still had a live list of who may
 * speak to you and a live set of addresses you could seal to. Nothing dangerous flowed from it — but
 * "I left" and "my device still holds this circle's membership state" is precisely the drift that
 * makes a later question ("who can reach me?") unanswerable.
 *
 * `unregisterCircleAddresses` is NOT called here: it needs a transport handle, which is the one thing
 * that genuinely differs per shell. Each shell passes its own `unregister` callback.
 *
 * @param {object} a
 * @param {object} a.agent
 * @param {string} a.circleId
 * @param {Function} [a.callSkill]     `(app, op, args)`; defaults to `agent.callSkill`
 * @param {() => any} [a.unregister]   shell-supplied transport de-registration (best-effort)
 * @returns {Promise<{ok: boolean, error?: string, unbound: number, snapshotDropped: boolean}>}
 */
export async function leaveCircleLocally({ agent = null, callSkill = null, circleId, unregister = null } = {}) {
  const out = { ok: false, unbound: 0, snapshotDropped: false };
  const skill = skillSeam(agent, callSkill);
  if (!skill || !circleId) { out.error = 'missing-args'; return out; }

  // Read the roster BEFORE leaving — after it, the circle's members are (correctly) no longer ours
  // to enumerate, and the addresses we need to unbind would be gone with them.
  const members = await rawRoster({ callSkill: skill, circleId });

  let res;
  try { res = await skill('stoop', 'leaveGroup', { groupId: circleId, confirm: true }); }
  catch (err) { res = { error: err?.message ?? 'leave-failed' }; }
  if (res?.error) { out.error = res.error; return out; }
  out.ok = true;

  try {
    out.unbound = forgetCircleAddressKeys({
      addresses: members,
      forgetPeerAddress: (addr) => agent?.forgetPeerAddress?.(addr),
    }).forgotten;
  } catch { /* best-effort */ }

  // The authorize snapshot for a circle you are no longer in. Dropping it is right in both
  // directions: nothing should still be arriving at that per-circle address, and if something does,
  // the honest answer is "no roster recorded for this address" rather than a stale allow-list.
  try { out.snapshotDropped = agent?.forgetCircleSenders?.(circleId) === true; }
  catch { /* best-effort */ }

  if (typeof unregister === 'function') {
    try { await unregister(); } catch { /* a dead socket no-ops; the next boot simply won't re-register */ }
  }
  return out;
}
